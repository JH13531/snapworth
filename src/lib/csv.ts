import type { Account, SubAccount, Snapshot, ExchangeRate, Settings, AccountType } from '@/types'
import { categoryLabel, subAccountName } from '@/types'
import { tl } from '@/lib/i18n-locale'
import { inferAccountMeta } from '@/lib/presets'
import { rateFor } from '@/lib/money'
import Decimal from 'decimal.js'
import Papa from 'papaparse'
import type { ExportData } from '@/lib/crypto'
import { downloadFile } from '@/lib/crypto'

export function esc(value: string | number | boolean | undefined): string {
  if (value === undefined || value === null) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function accountsToCsv(accounts: Account[]): string {
  const header = ['id', 'name', 'type', 'category', 'currency', 'include_in_networth', 'archived', 'hidden', 'note']
  const rows = accounts.map((a) => [
    a.id, a.name, a.type, a.category, a.currency,
    a.include_in_networth, a.archived, a.hidden, a.note ?? '',
  ].map(esc).join(','))
  return [header.join(','), ...rows].join('\n')
}

export function snapshotsToCsvWide(accounts: Account[], snapshots: Snapshot[]): string {
  const months = [...new Set(snapshots.map((s) => s.month))].sort()
  const header = ['account_id', 'account_name', 'type', 'category', 'currency', ...months]
  const rows = accounts.map((a) => {
    const vals = months.map((m) => {
      const snap = snapshots.find((s) => s.account_id === a.id && s.month === m)
      return snap?.balance ?? ''
    })
    return [a.id, a.name, a.type, categoryLabel(a.category), a.currency, ...vals].map(esc).join(',')
  })
  return [header.join(','), ...rows].join('\n')
}

/** 导出矩阵里的一列：一个账户，或一个子账户。 */
export interface CsvColumn {
  header: string
  account: Account
  sub?: SubAccount
  /** 该列是否代表账户的唯一记账单元（用于兼容没有子账户的历史快照） */
  soleUnit: boolean
}

/**
 * 把「账户 + 子账户」摊平成 CSV 的列。
 *
 * v7 之后余额记在子账户上，只按账户导出会让一个账户下的多笔资金被挤成一列、
 * 甚至丢数据。规则：
 *   - 没有子账户（历史数据）：一列 = 一个账户
 *   - 只有一个子账户：列名仍是账户名，保持和旧版导出一致（可原样导回）
 *   - 多个子账户：每子账户一列，列名「账户 子账户」
 */
export function buildCsvColumns(accounts: Account[], subAccounts: SubAccount[]): CsvColumn[] {
  const sorted = [...accounts].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const byAccount = new Map<string, SubAccount[]>()
  for (const sa of subAccounts) {
    if (!byAccount.has(sa.account_id)) byAccount.set(sa.account_id, [])
    byAccount.get(sa.account_id)!.push(sa)
  }
  for (const list of byAccount.values()) list.sort((a, b) => a.sort_order - b.sort_order)

  const cols: CsvColumn[] = []
  for (const a of sorted) {
    const subs = byAccount.get(a.id) ?? []
    if (subs.length === 0) {
      cols.push({ header: a.name, account: a, soleUnit: true })
    } else if (subs.length === 1) {
      cols.push({ header: a.name, account: a, sub: subs[0], soleUnit: true })
    } else {
      for (const s of subs) {
        cols.push({ header: `${a.name} ${subAccountName(s)}`, account: a, sub: s, soleUnit: false })
      }
    }
  }
  return cols
}

/** 按 "accountId|month|subId" 建立索引，避免逐月 .find() 的 O(n*m)。 */
function buildBalanceIndex(snapshots: Snapshot[]): Map<string, Snapshot> {
  const map = new Map<string, Snapshot>()
  for (const s of snapshots) {
    if (s.sub_account_id) map.set(`${s.account_id}|${s.month}|${s.sub_account_id}`, s)
    else map.set(`${s.account_id}|${s.month}|`, s)
  }
  return map
}

/** 取某列某月的原始快照（含币种信息，供合计折算与币种覆盖判断使用）。 */
function snapOf(idx: Map<string, Snapshot>, col: CsvColumn, month: string): Snapshot | undefined {
  if (!col.sub) {
    return idx.get(`${col.account.id}|${month}|`) ?? idx.get(`${col.account.id}|${month}|${col.account.id}`)
  }
  return idx.get(`${col.account.id}|${month}|${col.sub.id}`)
    // 子账户建立之前的旧快照挂在账户上；只有唯一记账单元时才兜底，避免多子账户重复计入
    ?? (col.soleUnit ? idx.get(`${col.account.id}|${month}|`) : undefined)
}

/** 导出内容的四个逻辑区块（二维数组，含各自表头，不含区块标记行）。CSV 与 xlsx 导出共用。 */
export interface ExportSections {
  amounts: string[][]
  accountsInfo: string[][]
  rates: { marker: string; rows: string[][] } | null
  overrides: string[][] | null
  /** 区块标记文本（xlsx 里作为各 sheet 的标题行/sheet 名） */
  markers: { amounts: string; accounts: string; overrides: string }
}

/**
 * 构建导出的全部区块数据：
 *
 *   1. 金额表：月份 × 账户/子账户列，给人看，保持纯净（只有数字，无元数据行）。
 *      余额输出原始字符串，不做 toFixed，保证导出→导入不丢精度。
 *      末尾三列合计按基准币种折算（缺汇率的列跳过，与应用内汇总口径一致）。
 *   2. 「账户信息」区：每列的父账户/子账户/币种/类型/分类等元数据，
 *      导入时据此精确重建账户结构（不猜名字）。
 *   3. 「汇率(基准:X)」区：完整汇率表。基准币不同导致导入时基准不一致的，
 *      导入方会按区间汇率换算。
 *   4. 「币种覆盖」区（按需）：改过币种的列，历史快照币种与列币种不一致的
 *      单元格逐一登记（月份 + 列号 → 币种）。
 */
export function buildExportSections(
  accounts: Account[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  settings: Settings,
  subAccounts: SubAccount[] = [],
): ExportSections {
  const columns = buildCsvColumns(accounts, subAccounts)
  const base = settings.base_currency
  const markers = {
    amounts: tl('csv.sheet_amounts'),
    accounts: tl('csv.section_accounts'),
    overrides: tl('csv.section_overrides'),
  }

  if (columns.length === 0) {
    return {
      amounts: [[tl('csv.month'), tl('csv.total_assets'), tl('csv.total_liabilities'), tl('csv.net_worth')]],
      accountsInfo: [],
      rates: null,
      overrides: null,
      markers,
    }
  }

  const months = [...new Set(snapshots.map((s) => s.month))].sort()
  const idx = buildBalanceIndex(snapshots)
  const header = [tl('csv.month'), ...columns.map((c) => c.header), tl('csv.total_assets'), tl('csv.total_liabilities'), tl('csv.net_worth')]

  const dataRows = months.map((month) => {
    const values = columns.map((c) => {
      const snap = snapOf(idx, c, month)
      return snap && snap.balance !== '' && snap.balance != null ? snap.balance : ''
    })

    // 合计：每一列独立判断是否计入（归档月及之后不计入），按基准币种折算
    let totalAssets = new Decimal(0)
    let totalLiabilities = new Decimal(0)
    for (const c of columns) {
      const unit = c.sub ?? c.account
      if (unit.archived || !unit.include_in_networth) continue
      if (unit.archived_at && month >= unit.archived_at) continue
      const snap = snapOf(idx, c, month)
      if (!snap || snap.balance === '' || snap.balance == null) continue
      const currency = snap.currency ?? unit.currency
      const rate = rateFor(rates, currency, month, base)
      if (!rate) continue
      const converted = new Decimal(snap.balance).mul(rate)
      if (unit.type === 'asset') totalAssets = totalAssets.add(converted)
      else totalLiabilities = totalLiabilities.add(converted.abs())
    }

    return [
      month,
      ...values,
      totalAssets.toFixed(2),
      totalLiabilities.toFixed(2),
      totalAssets.sub(totalLiabilities).toFixed(2),
    ]
  })

  const yes = tl('csv.yes')
  const no = tl('csv.no')

  // 区块 1：账户信息
  const accountsInfo: string[][] = [[
    tl('csv.col_index'), tl('csv.col_parent'), tl('csv.col_sub'), tl('csv.col_currency'),
    tl('csv.col_type'), tl('csv.col_category'), tl('csv.col_in_networth'),
    tl('csv.archived_status'), tl('csv.col_archived_month'), tl('csv.col_hidden'),
    tl('csv.col_icon'), tl('csv.col_color'), tl('csv.col_note'),
  ]]
  columns.forEach((c, i) => {
    const unit = c.sub ?? c.account
    accountsInfo.push([
      String(i + 1),
      c.account.name,
      c.sub?.name ?? '',
      unit.currency,
      unit.type,
      unit.category,
      unit.include_in_networth ? yes : no,
      unit.archived ? yes : no,
      unit.archived_at ?? '',
      c.account.hidden ? yes : no,
      c.sub?.icon ?? c.account.icon,
      c.sub?.color ?? c.account.color,
      c.sub?.note ?? c.account.note ?? '',
    ])
  })

  // 区块 2：汇率（标注导出时的基准币种，导入方基准不同会换算）
  // 「备注」列标明手动填写的汇率（无报价日期），避免用户看到空日期疑惑
  let ratesSection: ExportSections['rates'] = null
  if (rates.length > 0) {
    const rows: string[][] = [[tl('csv.month'), tl('csv.col_currency'), tl('csv.col_rate'), tl('csv.col_date'), tl('csv.col_note')]]
    const sorted = [...rates].sort((a, b) =>
      a.month === b.month ? (a.currency < b.currency ? -1 : 1) : (a.month < b.month ? -1 : 1))
    for (const r of sorted) {
      rows.push([r.month, r.currency, r.rate_to_base, r.rate_date ?? '', r.rate_date ? '' : tl('csv.rate_manual')])
    }
    ratesSection = { marker: `${tl('csv.section_rates')}(${tl('csv.base_tag')}:${base})`, rows }
  }

  // 区块 3：币种覆盖（快照币种 ≠ 列币种的单元格，仅改过节币种的列会有）
  // 用列名指认（如「招商银行 信用卡」），比列号更直观；导入端同时兼容旧文件的列号写法
  let overridesSection: string[][] | null = null
  const overrideRows: string[][] = []
  columns.forEach((c) => {
    const colCurrency = (c.sub ?? c.account).currency
    for (const month of months) {
      const snap = snapOf(idx, c, month)
      if (snap?.currency && snap.currency !== colCurrency) {
        overrideRows.push([month, c.header, snap.currency])
      }
    }
  })
  if (overrideRows.length > 0) {
    overridesSection = [[tl('csv.month'), tl('csv.col_name'), tl('csv.col_currency')], ...overrideRows]
  }

  return { amounts: [header, ...dataRows], accountsInfo, rates: ratesSection, overrides: overridesSection, markers }
}

/**
 * 导出完整 CSV（分区格式）：金额表 + 空行分隔的「账户信息 / 汇率 / 币种覆盖」区块。
 *
 * 旧格式（无区块、归档状态行在金额表内）的 CSV 导入时仍按猜测逻辑兼容。
 */
export function exportFullCsv(
  accounts: Account[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  settings: Settings,
  subAccounts: SubAccount[] = [],
): string {
  const s = buildExportSections(accounts, snapshots, rates, settings, subAccounts)
  const lines: string[] = s.amounts.map((row) => row.map(esc).join(','))

  if (s.accountsInfo.length > 0) {
    lines.push('', s.markers.accounts)
    for (const row of s.accountsInfo) lines.push(row.map(esc).join(','))
  }
  if (s.rates) {
    lines.push('', s.rates.marker)
    for (const row of s.rates.rows) lines.push(row.map(esc).join(','))
  }
  if (s.overrides) {
    lines.push('', s.markers.overrides)
    for (const row of s.overrides) lines.push(row.map(esc).join(','))
  }
  return lines.join('\n')
}

type CsvFormat = 'snapshot-wide' | 'snapshot-transposed' | 'transaction'
export type { CsvFormat }

function detectCsvFormat(header: string[], rows: string[][]): CsvFormat | null {
  const firstCol = header[0]?.toLowerCase().trim() || ''

  // 归档状态行：第二行第一列为"归档状态"或"archived"
  const isArchivedRow = (row: string[] | undefined) =>
    row && (row[0]?.trim() === '归档状态' || row[0]?.toLowerCase().trim() === 'archived')

  // 找到第一个数据行（跳过归档状态等元数据行）
  const firstDataRow = rows.find((r, i) => i > 0 && r[0]?.trim() && !isArchivedRow(r))

  // Check if it's a snapshot format (row=month, column=account)
  // First column may be "月份", "日期", "时间", "month", "date" etc.
  const isDateFirstCol = firstCol === '月份' || firstCol === 'month' ||
    DATE_PATTERNS.some((p) => firstCol === p || firstCol.includes(p))

  if (isDateFirstCol && firstDataRow) {
    const firstDataValue = firstDataRow[0]?.trim() || ''
    // Check if the first data value looks like a month/date
    if (isMonthOrDateValue(firstDataValue)) {
      // Confirm it's snapshot-wide: remaining columns should be account names (not all numeric)
      const accountLikeColumns = header.slice(1).filter((h) => h.trim() && !isNumericValue(h.trim()))
      if (accountLikeColumns.length >= 2) {
        return 'snapshot-wide'
      }
    }
  }

  // Check if it's transposed snapshot (row=account, column=month)
  // First column should be "account" or "账户", and first row should contain months
  if (firstCol === '账户' || firstCol === 'account' || firstCol === '账户名称') {
    // Check if header contains months
    const hasMonthInHeader = header.slice(1).some((h) => /^\d{4}-\d{2}$/.test(h.trim()))
    if (hasMonthInHeader) {
      return 'snapshot-transposed'
    }
  }

  // Check if it's transaction format (each row is a transaction)
  const headerLower = header.map((h) => h.toLowerCase().trim())
  const dateIdx = findColumnIndex(headerLower, DATE_PATTERNS)

  // If no date column by name, check if the first column contains date-like values
  if (dateIdx === -1 && rows.length > 1) {
    const sampleValues = rows.slice(1, Math.min(6, rows.length)).map((r) => r[0]?.trim() || '')
    if (sampleValues.some((v) => isDateValue(v))) {
      return 'transaction'
    }
  }

  // Check for date column + at least one amount-like column
  if (dateIdx !== -1) {
    const hasAmount = findColumnIndex(headerLower, AMOUNT_PATTERNS) !== -1
    const hasIncome = findColumnIndex(headerLower, INCOME_PATTERNS) !== -1
    const hasExpense = findColumnIndex(headerLower, EXPENSE_PATTERNS) !== -1
    if (hasAmount || hasIncome || hasExpense) {
      return 'transaction'
    }
  }

  // Check for amount-like columns even without date (assume all entries are current month)
  const hasAmount = findColumnIndex(headerLower, AMOUNT_PATTERNS) !== -1
  const hasAccount = findColumnIndex(headerLower, ACCOUNT_PATTERNS) !== -1
  if (hasAmount && hasAccount) {
    return 'transaction'
  }

  // Cannot determine format
  return null
}

// Column name patterns for detection
const DATE_PATTERNS = ['日期', '时间', '记账日期', '交易日期', '发生日期', 'date', 'time', '日期时间']
const AMOUNT_PATTERNS = ['金额', '交易金额', '发生金额', '变动金额', 'amount', '余额变动', '发生额']
const INCOME_PATTERNS = ['收入', '收入金额', '存入', '贷方', 'income', 'credit']
const EXPENSE_PATTERNS = ['支出', '支出金额', '取出', '借方', 'expense', 'debit']
const ACCOUNT_PATTERNS = ['账户', '账户名称', '账号', '卡号', '账户名', 'account', '银行卡', '账本']

function findColumnIndex(headerLower: string[], patterns: string[]): number {
  for (const pattern of patterns) {
    const idx = headerLower.findIndex((h) => h === pattern || h.includes(pattern))
    if (idx !== -1) return idx
  }
  return -1
}

function isDateValue(value: string): boolean {
  if (!value) return false
  // YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYY-MM, YYYY/MM
  return /^\d{4}[-/\.]\d{1,2}([-\./]\d{1,2})?/.test(value)
}

function isMonthOrDateValue(value: string): boolean {
  if (!value) return false
  // Standard: YYYY-MM, YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
  if (/^\d{4}[-/\.]\d{1,2}([-\./]\d{1,2})?/.test(value)) return true
  // Chinese: 2025年12月, 2025年1月
  if (/^\d{4}年\d{1,2}月/.test(value)) return true
  return false
}

function isNumericValue(value: string): boolean {
  return /^-?[\d,]+\.?\d*$/.test(value.trim())
}

function normalizeMonth(value: string | undefined): string | undefined {
  if (!value) return undefined
  const v = value.trim()
  // Already YYYY-MM
  if (/^\d{4}-\d{2}$/.test(v)) return v
  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD → extract YYYY-MM
  const stdMatch = v.match(/^(\d{4})[-/\.](\d{1,2})/)
  if (stdMatch) return `${stdMatch[1]}-${stdMatch[2].padStart(2, '0')}`
  // Chinese: 2025年12月 → 2025-12
  const cnMatch = v.match(/^(\d{4})年(\d{1,2})月/)
  if (cnMatch) return `${cnMatch[1]}-${cnMatch[2].padStart(2, '0')}`
  return undefined
}

export function parseCsvWide(csvText: string, baseCurrency: string): ExportData {
  const result = Papa.parse(csvText.trim(), {
    header: false,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  })

  // Only throw on fatal errors (non-empty data means parsing succeeded despite warnings)
  if (result.errors.length > 0 && (!result.data || (result.data as string[][]).length === 0)) {
    throw new Error(`CSV 解析失败：${result.errors[0].message}`)
  }

  const rows = result.data as string[][]
  if (rows.length < 2) {
    throw new Error('CSV 文件为空或只有表头')
  }

  const header = rows[0]
  const format = detectCsvFormat(header, rows)

  if (!format) {
    const err = new Error('CSV 格式无法识别')
    ;(err as any).code = 'CSV_FORMAT_UNKNOWN'
    throw err
  }

  if (format === 'snapshot-wide') {
    return parseSnapshotWide(header, rows, baseCurrency)
  } else if (format === 'snapshot-transposed') {
    return parseSnapshotTransposed(header, rows, baseCurrency)
  } else {
    return parseTransactionFormat(header, rows, baseCurrency)
  }
}

/** 把 CSV 的行切成「金额表 + 各区块」。旧格式没有区块标记，整份都是金额表。 */
function splitSections(rows: string[][]): {
  amountRows: string[][]
  accounts?: string[][]
  rates?: { marker: string; rows: string[][] }
  overrides?: string[][]
} {
  const markers = [
    { key: 'accounts', re: /^(账户信息|account info)$/i },
    { key: 'rates', re: /^(汇率|exchange rates)/i },
    { key: 'overrides', re: /^(币种覆盖|currency overrides)/i },
  ] as const
  const cuts: { idx: number; key: string; marker: string }[] = []
  rows.forEach((r, idx) => {
    const first = r[0]?.trim() ?? ''
    for (const m of markers) {
      if (m.re.test(first)) {
        cuts.push({ idx, key: m.key, marker: first })
        break
      }
    }
  })
  const amountRows = cuts.length ? rows.slice(0, cuts[0].idx) : rows
  const section = (key: string) => {
    const i = cuts.findIndex((c) => c.key === key)
    if (i === -1) return undefined
    const start = cuts[i].idx
    const end = i + 1 < cuts.length ? cuts[i + 1].idx : rows.length
    return { marker: cuts[i].marker, rows: rows.slice(start + 1, end) }
  }
  const accountsSec = section('accounts')
  const ratesSec = section('rates')
  const overridesSec = section('overrides')
  return { amountRows, accounts: accountsSec?.rows, rates: ratesSec, overrides: overridesSec?.rows }
}

function parseBool(v: string | undefined): boolean | undefined {
  const s = v?.trim().toLowerCase()
  if (s === '是' || s === 'yes' || s === 'true') return true
  if (s === '否' || s === 'no' || s === 'false') return false
  return undefined
}

function parseType(v: string | undefined, fallback: AccountType): AccountType {
  const s = v?.trim().toLowerCase()
  if (s === 'asset' || s === '资产') return 'asset'
  if (s === 'liability' || s === '负债') return 'liability'
  return fallback
}

/** 解析汇率区块。标记行里带导出方基准币种（如「汇率(基准:CNY)」），与导入方基准不同时按区间汇率换算。 */
function parseRatesSection(marker: string, rows: string[][], importBase: string): ExchangeRate[] {
  const m = marker.match(/[:：]\s*([A-Za-z]{3})\s*[)）]/)
  const csvBase = m ? m[1].toUpperCase() : importBase

  const raw: { month: string; currency: string; rate: Decimal; rate_date?: string }[] = []
  for (const r of rows) {
    const month = normalizeMonth(r[0]?.trim())
    const currency = r[1]?.trim().toUpperCase()
    const rateStr = r[2]?.trim()
    if (!month || !currency || !rateStr) continue
    let rate: Decimal
    try { rate = new Decimal(rateStr) } catch { continue }
    raw.push({ month, currency, rate, rate_date: r[3]?.trim() || undefined })
  }

  const now = new Date().toISOString()
  const make = (month: string, currency: string, rateToBase: string, rate_date?: string): ExchangeRate => ({
    month, currency, rate_to_base: rateToBase, rate_date, created_at: now, updated_at: now,
  })

  if (csvBase === importBase) {
    return raw.map((r) => make(r.month, r.currency, r.rate.toString(), r.rate_date))
  }

  // 基准不同：new(C) = old(C) / old(导入方基准)；旧基准自身的汇率隐含为 1。
  // 某月缺少换算锚点（导入方基准在旧表里的汇率）时，该月记录跳过。
  const byMonthCur = new Map(raw.map((r) => [`${r.month}|${r.currency}`, r]))
  const oldRateOf = (month: string, cur: string): Decimal | null => {
    if (cur === csvBase) return new Decimal(1)
    return byMonthCur.get(`${month}|${cur}`)?.rate ?? null
  }
  const convert = (rate: Decimal, anchor: Decimal) =>
    rate.div(anchor).toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
  const result: ExchangeRate[] = []
  for (const r of raw) {
    if (r.currency === importBase) continue // 新基准隐含为 1，无需记录
    const anchor = oldRateOf(r.month, importBase)
    if (!anchor || anchor.isZero()) continue
    result.push(make(r.month, r.currency, convert(r.rate, anchor), r.rate_date))
  }
  // 旧基准自身也要补发一行（old=1 → new=1/anchor），否则以旧基准计价的资产在新基准下无汇率可折算
  const emitted = new Set(result.map((r) => `${r.month}|${r.currency}`))
  for (const month of [...new Set(raw.map((r) => r.month))]) {
    if (emitted.has(`${month}|${csvBase}`)) continue
    const anchorRec = byMonthCur.get(`${month}|${importBase}`)
    if (!anchorRec || anchorRec.rate.isZero()) continue
    result.push(make(month, csvBase, convert(new Decimal(1), anchorRec.rate), anchorRec.rate_date))
  }
  return result
}

/** 解析币种覆盖区块的原始行。ref 可能是列名（新格式）或列号（旧格式，从 1 计）。 */
function parseOverridesSection(rows: string[][]): { month: string; ref: string; currency: string }[] {
  const list: { month: string; ref: string; currency: string }[] = []
  for (const r of rows) {
    const month = normalizeMonth(r[0]?.trim())
    const ref = r[1]?.trim()
    const currency = r[2]?.trim().toUpperCase()
    if (month && ref && currency) list.push({ month, ref, currency })
  }
  return list
}

interface ColumnMeta {
  parent: string
  sub: string
  currency: string
  type: AccountType
  category: string
  include: boolean
  archived: boolean
  archivedAt?: string
  hidden: boolean
  icon: string
  color: string
  note: string
}

/**
 * 带「账户信息」区块的结构化重建：每列 = 一个子账户，按父账户名归组出账户。
 * 账户的属性（类型/分类/币种/图标/颜色/备注）取该组第一列，与应用内
 * 「账户属性同步首个子账户」的口径一致。
 */
function buildExportDataWithMeta(
  accountColumns: { name: string; index: number; archived: boolean }[],
  dataRows: string[][],
  accountsSection: string[][],
  overridesSection: string[][],
  rates: ExchangeRate[],
  baseCurrency: string,
): ExportData {
  const now = new Date().toISOString()

  // 列号（从 1 计）→ 元数据
  const metaByOrdinal = new Map<number, ColumnMeta>()
  for (const r of accountsSection) {
    const ordinal = parseInt(r[0]?.trim() ?? '', 10)
    if (isNaN(ordinal)) continue // 跳过区块表头等非数据行
    const parent = r[1]?.trim() ?? ''
    if (!parent) continue
    const inferred = inferAccountMeta(parent)
    metaByOrdinal.set(ordinal, {
      parent,
      sub: r[2]?.trim() ?? '',
      currency: r[3]?.trim().toUpperCase() || baseCurrency,
      type: parseType(r[4], inferred.type),
      category: r[5]?.trim() || inferred.category,
      include: parseBool(r[6]) ?? true,
      archived: parseBool(r[7]) ?? false,
      archivedAt: normalizeMonth(r[8]?.trim()) || undefined,
      hidden: parseBool(r[9]) ?? false,
      icon: r[10]?.trim() || inferred.icon,
      color: r[11]?.trim() || inferred.color,
      note: r[12] ?? '',
    })
  }

  // 币种覆盖：新格式按列名解析成列号，旧格式（纯数字列号）原样兼容
  const ordinalByName = new Map(accountColumns.map((c, i) => [c.name, i + 1]))
  const overrides = new Map<string, string>()
  for (const o of parseOverridesSection(overridesSection)) {
    const ordinal = /^\d+$/.test(o.ref) ? parseInt(o.ref, 10) : ordinalByName.get(o.ref)
    if (ordinal !== undefined) overrides.set(`${o.month}|${ordinal}`, o.currency)
  }

  // 兜底：某列缺元数据时退回按名字猜测（容忍手工删减过的文件）
  const metaOf = (ordinal: number, col: { name: string; archived: boolean }): ColumnMeta => {
    const hit = metaByOrdinal.get(ordinal)
    if (hit) return hit
    const inferred = inferAccountMeta(col.name)
    return {
      parent: col.name, sub: '', currency: baseCurrency,
      type: inferred.type, category: inferred.category,
      include: true, archived: col.archived, hidden: false,
      icon: inferred.icon, color: inferred.color, note: '',
    }
  }

  const accounts: Account[] = []
  const accountByParent = new Map<string, Account>()
  const subCountByAccount = new Map<string, number>()
  const subByOrdinal = new Map<number, SubAccount>()
  const metaByOrdinalResolved = new Map<number, ColumnMeta>()

  accountColumns.forEach((col, i) => {
    const ordinal = i + 1
    const meta = metaOf(ordinal, col)
    metaByOrdinalResolved.set(ordinal, meta)

    let account = accountByParent.get(meta.parent)
    if (!account) {
      account = {
        id: crypto.randomUUID(),
        name: meta.parent,
        icon: meta.icon,
        color: meta.color,
        type: meta.type,
        category: meta.category,
        currency: meta.currency,
        include_in_networth: meta.include,
        archived: meta.archived,
        archived_at: meta.archivedAt,
        hidden: meta.hidden,
        sort_order: accounts.length,
        note: meta.note || undefined,
        created_at: now,
        updated_at: now,
      }
      accountByParent.set(meta.parent, account)
      accounts.push(account)
    }

    const sortIdx = subCountByAccount.get(account.id) ?? 0
    subCountByAccount.set(account.id, sortIdx + 1)
    subByOrdinal.set(ordinal, {
      id: crypto.randomUUID(),
      account_id: account.id,
      name: meta.sub,
      type: meta.type,
      category: meta.category,
      currency: meta.currency,
      include_in_networth: meta.include,
      archived: meta.archived,
      archived_at: meta.archivedAt,
      sort_order: sortIdx,
      icon: meta.icon || undefined,
      color: meta.color || undefined,
      note: meta.note || undefined,
      created_at: now,
      updated_at: now,
    })
  })

  const snapshots: Snapshot[] = []
  for (const row of dataRows) {
    if (!row || row.length === 0) continue
    const month = normalizeMonth(row[0]?.trim())
    if (!month || !/^\d{4}-\d{2}$/.test(month)) continue

    for (let i = 0; i < accountColumns.length; i++) {
      const ordinal = i + 1
      const valueStr = row[accountColumns[i].index]?.trim()
      if (valueStr === undefined || valueStr === '') continue
      // 去千分位逗号，否则 "55,000" 会被 parseFloat 截断成 55
      const value = parseFloat(valueStr.replace(/,/g, ''))
      if (isNaN(value)) continue

      const sub = subByOrdinal.get(ordinal)!
      const meta = metaByOrdinalResolved.get(ordinal)!
      snapshots.push({
        id: crypto.randomUUID(),
        account_id: sub.account_id,
        sub_account_id: sub.id,
        month,
        balance: value.toString(),
        currency: overrides.get(`${month}|${ordinal}`) ?? meta.currency,
        created_at: now,
        updated_at: now,
      })
    }
  }

  return {
    schema_version: 1,
    settings: {
      id: 'singleton',
      base_currency: baseCurrency,
      theme: 'system',
      privacy_mode: false,
      invert_change_color: false,
      book_name: 'Imported',
      schema_version: 1,
      onboarded: true,
      updated_at: now,
    },
    accounts,
    sub_accounts: [...subByOrdinal.values()],
    snapshots,
    exchange_rates: rates,
    monthly_reviews: [],
    tombstones: [],
  }
}

function parseSnapshotWide(header: string[], rows: string[][], baseCurrency: string): ExportData {
  if (header.length < 4) {
    throw new Error('CSV 格式错误：列数不足')
  }

  // 切出各区块，避免区块里的数据行（如汇率行的 2025-01 开头）混进金额表
  const sections = splitSections(rows)
  const amountRows = sections.amountRows

  // 找归档状态行（旧格式：在金额表内；新格式已挪入「账户信息」区块）
  const archivedRow = amountRows.find((r) => r[0]?.trim() === '归档状态' || r[0]?.toLowerCase().trim() === 'archived')

  // Identify account columns (skip first column which is the date/month column)
  // Also skip trailing summary columns (资产合计, 负债合计, 净资产)
  const accountColumns: { name: string; index: number; archived: boolean }[] = []
  const lastH = header[header.length - 1]
  const thirdLastH = header[header.length - 3]
  const isSummaryTrailer = (v: string | undefined) => v === '净资产' || v === 'Net Worth' || v === '资产合计' || v === 'Total Assets'
  const endIdx = header.length >= 4 && (isSummaryTrailer(lastH) || isSummaryTrailer(thirdLastH))
    ? header.length - 3
    : header.length

  for (let i = 1; i < endIdx; i++) {
    if (header[i]) {
      const archived = archivedRow ? archivedRow[i]?.trim() === '是' || archivedRow[i]?.toLowerCase().trim() === 'true' || archivedRow[i]?.toLowerCase().trim() === 'yes' : false
      accountColumns.push({ name: header[i].trim(), index: i, archived })
    }
  }

  if (accountColumns.length === 0) {
    throw new Error('CSV 格式错误：没有找到账户列')
  }

  // 过滤掉归档状态等元数据行，只保留实际数据行
  const dataRows = amountRows.slice(1).filter((r) => {
    const firstCol = r[0]?.trim()
    if (!firstCol) return false
    if (firstCol === '归档状态') return false
    if (firstCol.toLowerCase() === 'archived') return false
    return true
  })

  // 汇率区块（新格式才有）
  const rates = sections.rates
    ? parseRatesSection(sections.rates.marker, sections.rates.rows, baseCurrency)
    : []

  // 新格式：有「账户信息」区块，按元数据精确重建账户/子账户结构
  if (sections.accounts) {
    return buildExportDataWithMeta(
      accountColumns, dataRows, sections.accounts, sections.overrides ?? [], rates, baseCurrency,
    )
  }

  // 旧格式：按账户名猜测类型/分类
  const exportData = buildExportData(accountColumns, dataRows, baseCurrency, (row) => normalizeMonth(row[0]?.trim()))

  // 应用归档状态
  accountColumns.forEach((col, i) => {
    if (col.archived && exportData.accounts[i]) {
      exportData.accounts[i].archived = true
    }
  })
  exportData.exchange_rates = rates

  return exportData
}

function parseSnapshotTransposed(header: string[], rows: string[][], baseCurrency: string): ExportData {
  // First column is account name, rest are months
  const months = header.slice(1).map((h) => h.trim()).filter((h) => /^\d{4}-\d{2}$/.test(h))

  if (months.length === 0) {
    throw new Error('CSV 格式错误：没有找到月份列（应为 YYYY-MM 格式）')
  }

  // Build account columns from rows
  const accountColumns: { name: string; index: number }[] = []
  const accountData = new Map<string, string[]>() // account name -> array of balances

  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]
    const accountName = row[0]?.trim()
    if (!accountName) continue

    accountColumns.push({ name: accountName, index: rowIdx })
    accountData.set(accountName, row.slice(1))
  }

  if (accountColumns.length === 0) {
    throw new Error('CSV 格式错误：没有找到账户行')
  }

  // Transform to standard format: rows = months, columns = accounts
  const transformedRows: string[][] = []
  for (let monthIdx = 0; monthIdx < months.length; monthIdx++) {
    const month = months[monthIdx]
    const row: string[] = [month]

    for (const accCol of accountColumns) {
      const balances = accountData.get(accCol.name)
      const value = balances?.[monthIdx] ?? ''
      row.push(value)
    }

    transformedRows.push(row)
  }

  return buildExportData(accountColumns, transformedRows, baseCurrency, (row) => row[0]?.trim())
}

function parseTransactionFormat(header: string[], rows: string[][], baseCurrency: string): ExportData {
  // Find column indices using broad pattern matching
  const headerLower = header.map((h) => h.toLowerCase().trim())
  const dateIdx = findColumnIndex(headerLower, DATE_PATTERNS)
  const accountIdx = findColumnIndex(headerLower, ACCOUNT_PATTERNS)
  const amountIdx = findColumnIndex(headerLower, AMOUNT_PATTERNS)
  const incomeIdx = findColumnIndex(headerLower, INCOME_PATTERNS)
  const expenseIdx = findColumnIndex(headerLower, EXPENSE_PATTERNS)

  // Must have at least some amount-like column
  if (amountIdx === -1 && incomeIdx === -1 && expenseIdx === -1) {
    throw new Error('CSV 格式错误：找不到金额相关列（需要"金额"、"收入"或"支出"列）')
  }

  // If no date column, check if first column contains date-like values
  let effectiveDateIdx = dateIdx
  if (effectiveDateIdx === -1 && rows.length > 1) {
    const sampleValues = rows.slice(1, Math.min(6, rows.length)).map((r) => r[0]?.trim() || '')
    if (sampleValues.some((v) => isDateValue(v))) {
      effectiveDateIdx = 0
    }
  }

  const defaultMonth = new Date().toISOString().slice(0, 7) // YYYY-MM of current month
  const defaultAccount = tl('csv.default_account')

  // Parse transactions
  const transactions: { date: string; account: string; amount: number }[] = []
  const accountSet = new Set<string>()

  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]

    // Parse date
    let month = defaultMonth
    if (effectiveDateIdx !== -1) {
      const dateStr = row[effectiveDateIdx]?.trim()
      if (!dateStr) continue
      // Support YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYY-MM
      const dateMatch = dateStr.match(/^(\d{4})[-/\.](\d{1,2})([-/\.]\d{1,2})?/)
      if (!dateMatch) continue
      month = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}`
    }

    // Parse account
    const account = accountIdx !== -1 ? (row[accountIdx]?.trim() || defaultAccount) : defaultAccount

    // Parse amount (support single amount column or income/expense split)
    let amount = 0
    if (amountIdx !== -1) {
      const amountStr = row[amountIdx]?.trim().replace(/,/g, '')
      const parsed = parseFloat(amountStr)
      if (!isNaN(parsed)) amount += parsed
    }
    if (incomeIdx !== -1) {
      const incomeStr = row[incomeIdx]?.trim().replace(/,/g, '')
      const parsed = parseFloat(incomeStr)
      if (!isNaN(parsed)) amount += parsed
    }
    if (expenseIdx !== -1) {
      const expenseStr = row[expenseIdx]?.trim().replace(/,/g, '')
      const parsed = parseFloat(expenseStr)
      if (!isNaN(parsed)) amount -= parsed
    }

    if (!account && amount === 0) continue

    transactions.push({ date: month, account, amount })
    accountSet.add(account)
  }

  if (transactions.length === 0) {
    throw new Error('CSV 格式错误：没有找到有效的交易记录')
  }

  // Group transactions by account and month, calculate cumulative balance
  const accountMonths = new Map<string, Map<string, number>>()
  for (const account of accountSet) {
    accountMonths.set(account, new Map())
  }

  for (const tx of transactions) {
    const monthMap = accountMonths.get(tx.account)!
    const current = monthMap.get(tx.date) ?? 0
    monthMap.set(tx.date, current + tx.amount)
  }

  // Convert to snapshots (cumulative balance per month)
  const accountColumns: { name: string; index: number }[] = []
  const allMonths = [...new Set(transactions.map((tx) => tx.date))].sort()

  const accountNames = [...accountSet]
  for (let i = 0; i < accountNames.length; i++) {
    accountColumns.push({ name: accountNames[i], index: i })
  }

  // Build rows with cumulative balances
  const transformedRows: string[][] = []
  let cumulativeByAccount = new Map<string, number>()
  for (const account of accountNames) {
    cumulativeByAccount.set(account, 0)
  }

  for (const month of allMonths) {
    const row: string[] = [month]

    for (const account of accountNames) {
      const monthAmount = accountMonths.get(account)?.get(month) ?? 0
      const cumulative = (cumulativeByAccount.get(account) ?? 0) + monthAmount
      cumulativeByAccount.set(account, cumulative)
      row.push(cumulative.toString())
    }

    transformedRows.push(row)
  }

  return buildExportData(accountColumns, transformedRows, baseCurrency, (row) => row[0]?.trim())
}

function buildExportData(
  accountColumns: { name: string; index: number }[],
  dataRows: string[][],
  baseCurrency: string,
  getMonth: (row: string[]) => string | undefined,
): ExportData {
  const accountsByName = new Map<string, Account>()
  const newAccounts: Account[] = []

  for (const col of accountColumns) {
    // 按账户名推断类型/分类/图标/颜色，避免一律被录成「现金」
    const meta = inferAccountMeta(col.name)
    const account: Account = {
      id: crypto.randomUUID(),
      name: col.name,
      icon: meta.icon,
      color: meta.color,
      type: meta.type,
      category: meta.category,
      currency: baseCurrency,
      include_in_networth: true,
      archived: false,
      hidden: false,
      sort_order: col.index,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    newAccounts.push(account)
    accountsByName.set(col.name, account)
  }

  const snapshots: Snapshot[] = []
  for (const row of dataRows) {
    if (!row || row.length === 0) continue

    const month = getMonth(row)
    if (!month || !/^\d{4}-\d{2}$/.test(month)) continue

    for (let i = 0; i < accountColumns.length; i++) {
      const col = accountColumns[i]
      const valueStr = row[i + 1]?.trim()
      if (valueStr === undefined || valueStr === '') continue

      // 去掉千分位逗号，与交易流水路径保持一致，否则 "55,000" 会被 parseFloat 截断成 55
      const value = parseFloat(valueStr.replace(/,/g, ''))
      if (isNaN(value)) continue

      const account = accountsByName.get(col.name)
      if (!account) continue

      snapshots.push({
        id: crypto.randomUUID(),
        account_id: account.id,
        month,
        balance: value.toString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  return {
    schema_version: 1,
    settings: {
      id: 'singleton',
      base_currency: baseCurrency,
      theme: 'system',
      privacy_mode: false,
      invert_change_color: false,
      book_name: 'Imported',
      schema_version: 1,
      onboarded: true,
      updated_at: new Date().toISOString(),
    },
    accounts: newAccounts,
    snapshots,
    exchange_rates: [],
    monthly_reviews: [],
    tombstones: [],
  }
}

const SAMPLE_CSV: Record<CsvFormat, string> = {
  'snapshot-wide': [
    '月份,招商银行,支付宝,现金,资产合计,负债合计,净资产',
    '2025-01,50000,12000,3000,65000,5000,60000',
    '2025-02,52000,11000,2500,65500,4000,61500',
    '2025-03,55000,13000,2000,70000,3000,67000',
  ].join('\n'),
  'snapshot-transposed': [
    '账户,2025-01,2025-02,2025-03',
    '招商银行,50000,52000,55000',
    '支付宝,12000,11000,13000',
    '现金,3000,2500,2000',
  ].join('\n'),
  'transaction': [
    '日期,账户,金额',
    '2025-01-05,招商银行,50000',
    '2025-01-10,支付宝,12000',
    '2025-01-20,招商银行,-3000',
    '2025-02-03,招商银行,2000',
    '2025-02-15,支付宝,1500',
  ].join('\n'),
}

export function downloadSampleCsv(format: CsvFormat) {
  const names: Record<CsvFormat, string> = {
    'snapshot-wide': '示例-月度快照',
    'snapshot-transposed': '示例-账户快照',
    'transaction': '示例-交易流水',
  }
  downloadFile(`${names[format]}.csv`, SAMPLE_CSV[format], 'text/csv')
}
