/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 置 true 后状态只能按 statuses 的固定次序逐格推进，插队（跳格/回退）一律不认。
  ordered?: boolean
  // 终态以外的状态算待处理；不填时沿用「最后一个状态为终态」的旧约定。
  terminalStatuses?: string[]
}

// 经费下达登记提交：下达文号必填，空值按无效退回；其余项可由表单给出。
export type FundingSubmit = {
  下达文号: string
  经费批次: string
  拨付金额: number | string
  所属工程: string
  下达日期?: string
  拨付进度?: number | string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
