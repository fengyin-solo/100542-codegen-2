// 下达文号登记表（权威口径）：上级下达的经费按文号登记经费批次与拨付金额。
// 经费台账接收下达时一律以本表为准——文号与批次对不上时文号优先，
// 拨付金额多处取数也只认这一份，避免表格传来传去凑不齐。

export type FundCatalogEntry = {
  /** 下达文号 */
  docNo: string
  /** 经费事项名称 */
  docTitle: string
  /** 经费批次（该文号下的权威批次名） */
  batch: string
  /** 拨付金额，单位：万元 */
  amount: number
}

export const FUND_CATALOG: FundCatalogEntry[] = [
  {
    docNo: '黔财资环〔2026〕18号',
    docTitle: '2026年中央地质灾害防治资金',
    batch: '2026年第一批',
    amount: 120,
  },
  {
    docNo: '黔财资环〔2026〕18号',
    docTitle: '2026年中央地质灾害防治资金',
    batch: '2026年第二批',
    amount: 85,
  },
  {
    docNo: '黔自然资防治〔2026〕7号',
    docTitle: '2026年省级地质灾害防治专项',
    batch: '2026年省级专项第一批',
    amount: 60,
  },
  {
    docNo: '安市财建〔2026〕23号',
    docTitle: '2026年市级地质灾害防治补助资金',
    batch: '2026年市级补助',
    amount: 32.5,
  },
]

/** 文号的登记先后顺序，台账分栏按此排列。 */
export const FUND_DOC_ORDER: string[] = [...new Set(FUND_CATALOG.map((item) => item.docNo))]

export function catalogEntriesOf(docNo: string): FundCatalogEntry[] {
  return FUND_CATALOG.filter((item) => item.docNo === docNo)
}

export type ResolvedCatalog = {
  entry: FundCatalogEntry
  /** 为 true 表示上报批次与文号登记口径对不上，已按文号优先归正。 */
  batchCorrected: boolean
}

/**
 * 按业务口径归正一条下达登记：
 * 1. 文号下登记的批次与上报批次完全一致，直接采用；
 * 2. 对不上（含一个文号多个批次时指认不清）时文号优先，取该文号最早登记的批次。
 */
export function resolveCatalog(docNo: string, batchInput: string): ResolvedCatalog | null {
  const entries = catalogEntriesOf(docNo)
  if (entries.length === 0) {
    return null
  }
  const trimmed = batchInput.trim()
  const exact = entries.find((item) => item.batch === trimmed)
  if (exact) {
    return { entry: exact, batchCorrected: false }
  }
  return { entry: entries[0], batchCorrected: trimmed !== '' }
}
