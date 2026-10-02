import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, FundingSubmit, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 拨付进度（百分比）只由状态驱动：收到下达/财务复核均为 0，拨付到位记 100，多处取数也只是这一份。
const FUNDING_KEY = 'funding'
const FUNDING_DONE = '拨付到位'
const PROJECT_KEY = 'project'
const PROJECT_PENDING_AUDIT = '待核拨付'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 终态集合：配置了 terminalStatuses 用配置，否则沿用「最后一个状态为终态」。
function terminalStatuses(meta: ModuleMeta): string[] {
  return meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
}

function isTerminal(meta: ModuleMeta, status: string): boolean {
  return terminalStatuses(meta).includes(status)
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 固定次序模块（经费台账）：只接受「当前状态的下一格」，插队（跳格/回退）一律不认。
  if (meta.ordered) {
    const currentIndex = meta.statuses.indexOf(current)
    const targetIndex = meta.statuses.indexOf(target)
    if (currentIndex < 0 || targetIndex !== currentIndex + 1) {
      return {
        ok: false,
        message: `状态只能按固定次序推进（${meta.statuses.join('→')}），「${current}」不能直接「${action}」，插队不认`,
      }
    }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !isTerminal(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 经费台账：拨付进度与状态同源，到位即记 100；同时往治理工程台账挂一条待核拨付。
  if (key === FUNDING_KEY) {
    updated['拨付进度'] = target === FUNDING_DONE ? 100 : Number(updated['拨付进度'] ?? 0) || 0
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (key === FUNDING_KEY && target === FUNDING_DONE) {
    appendProjectPendingAudit(updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 拨付到位后把结果落到治理工程台账：同文号+批次只挂一条，重复到位不重复挂。
function appendProjectPendingAudit(fundingRow: EntryRow): void {
  const docNo = String(fundingRow['下达文号'] ?? '')
  const batch = String(fundingRow['经费批次'] ?? '')
  const projects = listRows(PROJECT_KEY)
  const exists = projects.some(
    (row) => String(row['拨付文号'] ?? '') === docNo && String(row['经费批次'] ?? '') === batch,
  )
  if (exists) {
    return
  }
  const nextId = projects.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const relatedProject = String(fundingRow['所属工程'] ?? '')
  const record: EntryRow = {
    id: nextId,
    status: PROJECT_PENDING_AUDIT,
    pending: true,
    abnormal: false,
    工程编号: relatedProject || `待核-${docNo}`,
    所属隐患点: '经费拨付待核',
    工程类型: '防治经费拨付',
    批复日期: String(fundingRow['下达日期'] ?? ''),
    批复金额: fundingRow['拨付金额'],
    承建单位: '—',
    完工日期: '—',
    工程状态: PROJECT_PENDING_AUDIT,
    // 保留来源，便于复核与去重。
    拨付文号: docNo,
    经费批次: batch,
  }
  saveRows(PROJECT_KEY, [...projects, record])
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function extractYear(text: string): string | null {
  const matched = text.match(/(?:〔|（|\()\s*(\d{4})\s*(?:〕|）|\))/) ?? text.match(/(\d{4})/)
  return matched ? matched[1] : null
}

// 文号与批次对不上时按业务判定：文号是上级下达的法定凭据、效力更高，
// 批次年份向文号看齐（保留批次原序号），拨付金额多处取数时也以这份提交为准。
function normalizeBatch(docNo: string, batch: string): { batch: string; corrected: boolean } {
  const docYear = extractYear(docNo)
  const batchYear = extractYear(batch)
  if (!docYear || !batchYear || docYear === batchYear) {
    return { batch, corrected: false }
  }
  const withoutYear = batch
    .replace(/(?:〔|（|\()\s*\d{4}\s*(?:〕|）|\))/, '')
    .replace(/\d{4}\s*年?/, '')
    .trim()
  const seq = withoutYear.replace(/^第?/, '第').replace(/批$/, '批')
  return { batch: `${docYear}年${seq}`, corrected: true }
}

// 多处取数时拨付金额只保留同一份：统一解析成数字（万元），非正数一律退回。
function parseAmount(value: number | string | undefined): number | null {
  if (value === undefined || value === null) {
    return null
  }
  const text = String(value).replace(/,/g, '').replace(/万元?/g, '').trim()
  if (text === '') {
    return null
  }
  const amount = Number(text)
  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }
  return Math.round(amount * 100) / 100
}

// 收到下达：登记入口。文号为空按无效值退回重填；重复提交（同文号+批次）只认先到的一份。
export function submitFunding(input: FundingSubmit): ActionResult {
  const docNo = String(input['下达文号'] ?? '').trim()
  if (!docNo) {
    return { ok: false, message: '下达文号为空，按无效值处理，请补充文号后退回重填' }
  }
  const rawBatch = String(input['经费批次'] ?? '').trim()
  if (!rawBatch) {
    return { ok: false, message: '经费批次为空，无法登记，请补充批次后重填' }
  }
  const amount = parseAmount(input['拨付金额'])
  if (amount === null) {
    return { ok: false, message: '拨付金额无效或为空，请填写正数金额（万元）后重填' }
  }
  const relatedProject = String(input['所属工程'] ?? '').trim()
  const issueDate = String(input['下达日期'] ?? '').trim() || new Date().toISOString().slice(0, 10)
  const { batch, corrected } = normalizeBatch(docNo, rawBatch)

  const rows = listRows(FUNDING_KEY)
  const duplicated = rows.some(
    (row) => String(row['下达文号'] ?? '') === docNo && String(row['经费批次'] ?? '') === batch,
  )
  if (duplicated) {
    return { ok: false, message: `下达文号 ${docNo}、批次 ${batch} 已登记过，重复提交只认先到的一份` }
  }

  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const record: EntryRow = {
    id: nextId,
    status: '收到下达',
    pending: true,
    abnormal: false,
    下达文号: docNo,
    经费批次: batch,
    拨付金额: amount,
    所属工程: relatedProject || '—',
    下达日期: issueDate,
    // 新收下达一律 0，拨付进度只随状态推进，不允许提交时直接报到位。
    拨付进度: 0,
    经费状态: '收到下达',
  }
  saveRows(FUNDING_KEY, [...rows, record])
  return {
    ok: true,
    message: corrected
      ? `已登记「收到下达」：文号与批次年份对不上，按业务以文号为准，批次已校正为 ${batch}；拨付金额 ${amount} 万元（多处取数同一份）`
      : `已登记「收到下达」：${docNo} / ${batch}，拨付金额 ${amount} 万元`,
  }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
