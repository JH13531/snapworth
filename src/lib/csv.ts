import type { Account, SubAccount, Snapshot, ExchangeRate, Settings } from '@/types'
import { categoryLabel, subAccountName } from '@/types'
import { tl } from '@/lib/i18n-locale'
import { inferAccountMeta } from '@/lib/presets'
import Papa from 'papaparse'
import type { ExportData } from '@/lib/crypto'
import { downloadFile } from '@/lib/crypto'

function esc(value: string | number | boolean | undefined): string {
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

function balanceOf(idx: Map<string, Snapshot>, col: CsvColumn, month: string): string {
  if (!col.sub) {
    const snap = idx.get(`${col.account.id}|${month}|`) ?? idx.get(`${col.account.id}|${month}|${col.account.id}`)
    return fmtBalance(snap)
  }
  const snap = idx.get(`${col.account.id}|${month}|${col.sub.id}`)
    // 子账户建立之前的旧快照挂在账户上；只有唯一记账单元时才兜底，避免多子账户重复计入
    ?? (col.soleUnit ? idx.get(`${col.account.id}|${month}|`) : undefined)
  return fmtBalance(snap)
}

function fmtBalance(snap: Snapshot | undefined): string {
  if (!snap || snap.balance === '' || snap.balance == null) return ''
  return parseFloat(snap.balance).toFixed(2)
}

export function exportFullCsv(
  accounts: Account[],
  snapshots: Snapshot[],
  _rates: ExchangeRate[],
  _settings: Settings,
  subAccounts: SubAccount[] = [],
): string {
  const columns = buildCsvColumns(accounts, subAccounts)

  if (columns.length === 0) {
    return [tl('csv.month'), tl('csv.total_assets'), tl('csv.total_liabilities'), tl('csv.net_worth')].join(',')
  }

  // Collect all unique months from snapshots
  const months = [...new Set(snapshots.map((s) => s.month))].sort()

  const headers = columns.map((c) => c.header)
  // 首行标注每一列的归档状态（归档后不再计入合计）
  const archivedRow = [tl('csv.archived_status'), ...columns.map((c) => (c.sub ? c.sub.archived : c.account.archived) ? tl('csv.yes') : tl('csv.no')), '', '', '']

  if (months.length === 0) {
    const header = [tl('csv.month'), ...headers, tl('csv.total_assets'), tl('csv.total_liabilities'), tl('csv.net_worth')]
    return [header, archivedRow].map((r) => r.map(esc).join(',')).join('\n')
  }

  const header = [tl('csv.month'), ...headers, tl('csv.total_assets'), tl('csv.total_liabilities'), tl('csv.net_worth')]
  const idx = buildBalanceIndex(snapshots)

  const dataRows = months.map((month) => {
    const values = columns.map((c) => balanceOf(idx, c, month))

    // 合计：每一列独立判断是否计入（归档月及之后不计入）
    let totalAssets = 0
    let totalLiabilities = 0
    for (const c of columns) {
      const unit = c.sub ?? c.account
      if (unit.archived || !unit.include_in_networth) continue
      if (unit.archived_at && month >= unit.archived_at) continue
      const raw = balanceOf(idx, c, month)
      if (raw === '') continue
      const balance = parseFloat(raw)
      if (unit.type === 'asset') totalAssets += balance
      else totalLiabilities += Math.abs(balance)
    }
    const netWorth = totalAssets - totalLiabilities

    return [
      month,
      ...values,
      totalAssets.toFixed(2),
      totalLiabilities.toFixed(2),
      netWorth.toFixed(2),
    ]
  })

  return [header, archivedRow, ...dataRows].map((row) => row.map(esc).join(',')).join('\n')
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

function parseSnapshotWide(header: string[], rows: string[][], baseCurrency: string): ExportData {
  if (header.length < 4) {
    throw new Error('CSV 格式错误：列数不足')
  }

  // 找归档状态行
  const archivedRow = rows.find((r) => r[0]?.trim() === '归档状态' || r[0]?.toLowerCase().trim() === 'archived')

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
  const dataRows = rows.slice(1).filter((r) => {
    const firstCol = r[0]?.trim()
    if (!firstCol) return false
    if (firstCol === '归档状态') return false
    if (firstCol.toLowerCase() === 'archived') return false
    return true
  })

  const exportData = buildExportData(accountColumns, dataRows, baseCurrency, (row) => normalizeMonth(row[0]?.trim()))

  // 应用归档状态
  accountColumns.forEach((col, i) => {
    if (col.archived && exportData.accounts[i]) {
      exportData.accounts[i].archived = true
    }
  })

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
