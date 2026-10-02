import { FUND_DOC_ORDER, catalogEntriesOf, resolveCatalog } from '@/data/fund-catalog'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 经费下达与拨付台账：与通用模块同一套本地持久化，但业务规则单独落在这里。

export const FUND_KEY = 'fund'
export const PROJECT_KEY = 'project'

/** 固定次序：收到下达 → 财务复核 → 拨付到位。插队、回退一律不认。 */
export const FUND_STATUSES = ['收到下达', '财务复核', '拨付到位'] as const
export type FundStatus = (typeof FUND_STATUSES)[number]

/** 每个状态只允许推进到紧邻的下一态，没有可执行动作时列表里就是空的。 */
const NEXT_ACTION: Record<FundStatus, { action: string; target: FundStatus } | null> = {
  收到下达: { action: '财务复核', target: '财务复核' },
  财务复核: { action: '拨付到位', target: '拨付到位' },
  拨付到位: null,
}

export type SubmitFundInput = {
  /** 下达文号，空值按无效值处理，退回重填。 */
  docNo: string
  /** 经费批次（上报口径，对不上时按文号登记口径归正）。 */
  batch: string
  /** 上报拨付金额，仅用于与权威口径核对，入账金额以登记表为准。 */
  amountInput?: string | number
  /** 关联治理工程编号，可空。 */
  projectCode?: string
}

export type SubmitFundResult = {
  ok: boolean
  message: string
  /** 归正后入账的经费记录。 */
  fund?: EntryRow
  /** 同时落到治理工程台账的待核拨付记录。 */
  project?: EntryRow
  /** 文号／批次／金额口径归正的提示，页面需要原样展示给填报人。 */
  notices: string[]
}

export type FundColumn = {
  docNo: string
  docTitle: string
  rows: EntryRow[]
  /** 栏内拨付金额合计（万元），金额来自登记表，台账各处同一份。 */
  totalAmount: number
}

export function listFunds(): EntryRow[] {
  return listRows(FUND_KEY)
}

export function statusIndex(status: string): number {
  return FUND_STATUSES.indexOf(status as FundStatus)
}

/** 拨付进度按固定次序折算百分比，进度和状态永远一致。 */
export function progressPercent(status: string): number {
  const index = statusIndex(status)
  if (index < 0) {
    return 0
  }
  return index * 50
}

/** 尚未拨付到位：收到下达、财务复核两笔都算。 */
export function isPendingDisbursement(row: EntryRow): boolean {
  return row.status !== '拨付到位'
}

export function nextFundAction(status: string): { action: string; target: string } | null {
  return NEXT_ACTION[status as FundStatus] ?? null
}

function nowStamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function parseAmount(value: string | number | undefined): number | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null
  }
  const num = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(num) ? num : null
}

/** 同一文号 + 同一归正批次只认先到的那一份，后续提交全部退回。 */
function findDuplicate(rows: EntryRow[], docNo: string, batch: string): EntryRow | undefined {
  return rows.find((row) => row['下达文号'] === docNo && row['经费批次'] === batch)
}

/**
 * 接收一笔上级下达的经费：
 * 1. 文号为空按无效值处理，退回重填；
 * 2. 文号在登记表里查不到，退回核对文号；
 * 3. 批次与文号对不上，文号优先，按登记表归正（提示但不退回）；
 * 4. 金额多处取数只认登记表；上报金额与登记表不符只提示，不改口径；
 * 5. 文号+批次重复提交，只认先到的；
 * 6. 接收成功同时在治理工程台账添一条「待核拨付」。
 */
export function submitFund(input: SubmitFundInput): SubmitFundResult {
  const notices: string[] = []
  const docNo = input.docNo.trim()
  if (docNo === '') {
    return { ok: false, message: '下达文号为空，按无效值处理，请退回重填。', notices }
  }

  const resolved = resolveCatalog(docNo, input.batch)
  if (!resolved) {
    return { ok: false, message: `下达文号「${docNo}」在文号登记表中查不到，请核对文号后重填。`, notices }
  }
  const { entry, batchCorrected } = resolved
  if (batchCorrected) {
    notices.push(
      `经费批次「${input.batch.trim() || '（空）'}」与文号「${docNo}」登记口径不一致，已按文号优先归正为「${entry.batch}」。`,
    )
  }

  const rows = listRows(FUND_KEY)
  const duplicate = findDuplicate(rows, docNo, entry.batch)
  if (duplicate) {
    return {
      ok: false,
      message: `该文号下批次「${entry.batch}」已于 ${duplicate['接收时间']} 先到一份（台账编号 ${duplicate.id}），重复提交只认先到的，本次不收。`,
      notices,
    }
  }

  const reported = parseAmount(input.amountInput)
  if (reported !== null && Math.abs(reported - entry.amount) > 0.001) {
    notices.push(
      `上报拨付金额 ${reported} 万元与文号登记表的 ${entry.amount} 万元不一致，多处取数以登记表为准，按 ${entry.amount} 万元入账。`,
    )
  }

  const stamp = nowStamp()
  const fundId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const fund: EntryRow = {
    id: fundId,
    status: '收到下达',
    pending: true,
    abnormal: false,
    下达文号: docNo,
    经费事项: entry.docTitle,
    经费批次: entry.batch,
    拨付金额: entry.amount,
    拨付进度: '0%',
    关联工程: input.projectCode?.trim() || '',
    接收时间: stamp,
    复核时间: '',
    到位时间: '',
    对账说明: notices.join(' '),
  }
  saveRows(FUND_KEY, [...rows, fund])

  // 落到治理工程台账：新增一条「待核拨付」，金额只存引用，展示时回经费台账取同一份。
  const projects = listRows(PROJECT_KEY)
  const projectId = projects.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const projectCode =
    input.projectCode?.trim() || `PROJ-F${String(fundId).padStart(4, '0')}`
  const project: EntryRow = {
    id: projectId,
    status: '待核拨付',
    pending: true,
    abnormal: false,
    工程编号: projectCode,
    所属隐患点: `随${docNo}拨付`,
    工程类型: '防治经费待核',
    批复日期: stamp.slice(0, 10),
    批复金额: entry.amount,
    承建单位: '',
    完工日期: '',
    工程状态: '待核拨付',
    关联经费编号: fundId,
    拨付文号: docNo,
  }
  saveRows(PROJECT_KEY, [...projects, project])

  return {
    ok: true,
    message: `经费已接收下达：${docNo} / ${entry.batch} / ${entry.amount} 万元；治理工程台账已添「待核拨付」一条。`,
    fund,
    project,
    notices,
  }
}

/**
 * 推进一笔经费的状态。只允许固定次序的下一步：
 * - 当前已是目标态（重复点击）→ 不认；
 * - 跳到后续状态或回退（插队）→ 不认。
 */
export function advanceFund(id: number, action: string): ActionResult {
  const rows = listRows(FUND_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的经费记录` }
  }
  const current = rows[index]
  const next = nextFundAction(String(current.status))
  if (!next) {
    return { ok: false, message: `该笔经费已「${current.status}」，没有可推进的环节。` }
  }
  if (next.action !== action) {
    return {
      ok: false,
      message: `当前环节为「${current.status}」，固定次序只允许先「${next.action}」，「${action}」插队不予受理。`,
    }
  }

  const stamp = nowStamp()
  const updated: EntryRow = {
    ...current,
    status: next.target,
    拨付进度: `${progressPercent(next.target)}%`,
    pending: next.target !== '拨付到位',
    ...(next.target === '财务复核' ? { 复核时间: stamp } : {}),
    ...(next.target === '拨付到位' ? { 到位时间: stamp } : {}),
  }
  const nextRows = [...rows]
  nextRows[index] = updated
  saveRows(FUND_KEY, nextRows)
  return { ok: true, message: `经费已${action}，当前状态「${next.target}」，拨付进度 ${updated.拨付进度}。` }
}

/** 经费台账分栏：按文号一栏，每栏列出该文号下各批次的金额与进度；登记过但尚无记录的文号也出空栏。 */
export function fundColumns(): FundColumn[] {
  const rows = listRows(FUND_KEY)
  const docNos = [...new Set([...FUND_DOC_ORDER, ...rows.map((row) => String(row['下达文号']))])]
  return docNos.map((docNo) => {
    const inColumn = rows
      .filter((row) => row['下达文号'] === docNo)
      .sort((a, b) => Number(a.id) - Number(b.id))
    return {
      docNo,
      docTitle: String(inColumn[0]?.['经费事项'] ?? catalogEntriesOf(docNo)[0]?.docTitle ?? ''),
      rows: inColumn,
      totalAmount: inColumn.reduce((sum, row) => sum + (Number(row['拨付金额']) || 0), 0),
    }
  })
}

/** 尚未拨付到位的几笔：另列一栏。 */
export function pendingFunds(): EntryRow[] {
  return listRows(FUND_KEY)
    .filter(isPendingDisbursement)
    .sort((a, b) => {
      const gap = statusIndex(String(a.status)) - statusIndex(String(b.status))
      return gap !== 0 ? gap : Number(a.id) - Number(b.id)
    })
}

/** 拨付金额多处取数的唯一口径：治理工程那边始终回经费台账取这一份。 */
export function fundAmountOf(fundId: number | string): number | null {
  if (fundId === '' || fundId === undefined || fundId === null) {
    return null
  }
  const row = listRows(FUND_KEY).find((item) => Number(item.id) === Number(fundId))
  return row ? Number(row['拨付金额']) : null
}

export function fundStats(): { label: string; value: number }[] {
  const rows = listRows(FUND_KEY)
  return [
    { label: '经费批次（笔）', value: rows.length },
    { label: '下达金额合计（万元）', value: rows.reduce((sum, row) => sum + (Number(row['拨付金额']) || 0), 0) },
    { label: '已拨付到位（笔）', value: rows.filter((row) => row.status === '拨付到位').length },
    { label: '尚未拨付到位（笔）', value: rows.filter(isPendingDisbursement).length },
  ]
}

export function exportFunds(): { filename: string; content: string } {
  const header = ['编号', '下达文号', '经费事项', '经费批次', '拨付金额(万元)', '拨付进度', '关联工程', '当前状态', '接收时间', '复核时间', '到位时间']
  const lines = [header.join(',')]
  for (const row of listRows(FUND_KEY)) {
    lines.push(
      [
        row.id,
        row['下达文号'],
        row['经费事项'],
        row['经费批次'],
        row['拨付金额'],
        row['拨付进度'],
        row['关联工程'] || '',
        row.status,
        row['接收时间'] ?? '',
        row['复核时间'] ?? '',
        row['到位时间'] ?? '',
      ].join(','),
    )
  }
  return { filename: '经费下达与拨付台账.csv', content: `﻿${lines.join('\n')}` }
}

export function resetFunds(): EntryRow[] {
  return resetRows(FUND_KEY)
}
