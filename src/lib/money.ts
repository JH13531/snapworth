import Decimal from 'decimal.js'
import { addMonths, monthRange } from '@/lib/date'
import type { Account, SubAccount, Snapshot, ExchangeRate, AccountType } from '@/types'
import { tl } from '@/lib/i18n-locale'

/**
 * 一条余额所属的币种。
 * 新快照在录入时会冻结当时的账户币种到 Snapshot.currency；
 * 旧数据没有该字段时回退到账户当前币种。
 */
export function snapCurrency(snap: Snapshot, account: Account): string {
  return snap.currency ?? account.currency
}

export function rateFor(rates: ExchangeRate[], currency: string, month: string, base: string): Decimal | null {
  if (currency === base) return new Decimal(1)
  const exact = rates.find((r) => r.currency === currency && r.month === month)
  if (exact) return new Decimal(exact.rate_to_base)
  const prior = rates
    .filter((r) => r.currency === currency && r.month <= month)
    .sort((a, b) => (a.month < b.month ? 1 : -1))[0]
  if (prior) return new Decimal(prior.rate_to_base)
  return null
}

/**
 * 将快照列表按 "accountId|month" 建立 Map 索引。
 * 避免在循环中反复 .find() 导致 O(n*m) 退化为 O(n+m)。
 */
export function buildSnapshotMap(snapshots: Snapshot[]): Map<string, Snapshot> {
  const map = new Map<string, Snapshot>()
  // 按 账户|月份 分组子账户快照，用于生成聚合主账户键
  const groups = new Map<string, Snapshot[]>()
  for (const s of snapshots) {
    // 子账户快照：account_id|month|sub_account_id
    // 主账户快照（旧数据）：account_id|month
    if (s.sub_account_id) {
      map.set(`${s.account_id}|${s.month}|${s.sub_account_id}`, s)
      const gk = `${s.account_id}|${s.month}`
      const g = groups.get(gk)
      if (g) g.push(s)
      else groups.set(gk, [s])
    } else {
      // 兼容旧格式
      map.set(`${s.account_id}|${s.month}`, s)
    }
  }
  // 主账户键 = 该账户当月各子账户余额之和（合成快照），替代旧的「后写入的
  // 子账户覆盖主账户键」行为——后者会让按主账户取数的调用方只看到一个子账户。
  // 仅在所有子账户同币种时聚合：跨币种直接相加没有意义，此时主账户键保持缺失，
  // 调用方应改用按子账户折算汇率的 summarizeAccountMonth。
  for (const [gk, snaps] of groups) {
    const currencies = new Set(snaps.map((s) => s.currency ?? ''))
    if (currencies.size > 1) continue
    let sum = new Decimal(0)
    let counted = 0
    let valid = true
    for (const s of snaps) {
      if (s.balance === '' || s.balance == null) continue
      try {
        sum = sum.add(new Decimal(s.balance))
        counted++
      } catch {
        valid = false
        break
      }
    }
    if (!valid || counted === 0) continue
    map.set(gk, { ...snaps[0], id: `__agg__${gk}`, sub_account_id: undefined, balance: sum.toString() })
  }
  return map
}

/** 将汇率列表按 "currency|month" 建立 Map 索引。 */
export function buildRateMap(rates: ExchangeRate[]): Map<string, ExchangeRate> {
  const map = new Map<string, ExchangeRate>()
  for (const r of rates) map.set(`${r.currency}|${r.month}`, r)
  return map
}

export interface MonthSummary {
  month: string
  assets: Decimal
  liabilities: Decimal
  networth: Decimal
  missingRates: string[]
}

export interface SummaryUnit {
  id: string
  account_id: string
  sub_account_id?: string
  type: AccountType
  category: string
  currency: string
  include_in_networth: boolean
  archived: boolean
  archived_at?: string
}

/**
 * 构建用于汇总的单元列表。
 * 优先使用子账户（v7+），如果没有子账户则回退到账户（旧数据兼容）。
 */
export function buildSummaryUnits(
  accounts: Account[],
  subAccounts: SubAccount[],
): SummaryUnit[] {
  if (subAccounts.length > 0) {
    return subAccounts.map((s) => ({
      id: s.id,
      account_id: s.account_id,
      sub_account_id: s.id,
      type: s.type,
      category: s.category,
      currency: s.currency,
      include_in_networth: s.include_in_networth,
      archived: s.archived,
      archived_at: s.archived_at,
    }))
  }
  // 兼容旧数据
  return accounts.map((a) => ({
    id: a.id,
    account_id: a.id,
    type: a.type,
    category: a.category,
    currency: a.currency,
    include_in_networth: a.include_in_networth,
    archived: a.archived,
    archived_at: a.archived_at,
  }))
}

export function summarizeMonth(
  accounts: Account[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  month: string,
  base: string,
  subAccounts?: SubAccount[],
): MonthSummary {
  let assets = new Decimal(0)
  let liabilities = new Decimal(0)
  const missingRates = new Set<string>()
  const snapMap = buildSnapshotMap(snapshots)
  const rateMap = buildRateMap(rates)
  const units = buildSummaryUnits(accounts, subAccounts ?? [])

  for (const unit of units) {
    if (!unit.include_in_networth) continue
    // 归档账户：归档月份之前仍计入，归档月及之后不计入
    if (unit.archived && unit.archived_at && month >= unit.archived_at) continue
    const snapKey = unit.sub_account_id
      ? `${unit.account_id}|${month}|${unit.sub_account_id}`
      : `${unit.id}|${month}`
    const snap = unit.sub_account_id
      ? snapMap.get(snapKey)
      : snapMap.get(snapKey) ?? snapMap.get(`${unit.account_id}|${month}`)
    if (!snap) continue
    if (snap.balance === '' || snap.balance == null) continue
    const balance = new Decimal(snap.balance)
    const currency = snap.currency ?? unit.currency
    const rate = rateFor(rates, currency, month, base)
    if (currency !== base) {
      const exact = rateMap.get(`${currency}|${month}`)
      if (!exact) missingRates.add(currency)
    }
    if (!rate) continue
    const converted = balance.mul(rate)
    if (unit.type === 'asset') assets = assets.add(converted)
    else liabilities = liabilities.add(converted)
  }

  return { month, assets, liabilities, networth: assets.sub(liabilities), missingRates: [...missingRates] }
}

export function allMonths(snapshots: Snapshot[]): string[] {
  const set = new Set(snapshots.map((s) => s.month))
  return [...set].sort()
}

/**
 * 取最近 count 个「自然月」——截至最后一个有数据的月份。
 *
 * 与 allMonths(...).slice(-count) 的区别：后者取的是最近 count 条记录，
 * 中间漏记的月份会被跳过，导致区间实际跨度大于 count 个月。
 * 历史不足 count 个月时从最早一个月开始，不会向左补空月份。
 */
export function recentCalendarMonths(monthsWithData: string[], count: number): string[] {
  if (monthsWithData.length === 0) return []
  const sorted = [...monthsWithData].sort()
  const end = sorted[sorted.length - 1]
  const start = addMonths(end, -(count - 1))
  return monthRange(start > sorted[0] ? start : sorted[0], end)
}

/**
 * 把图表的时间范围选项解析成「有数据的月份列表」。
 * 抽出来是为了让图表和页面（比如断档补录提示）用的是同一套区间定义，
 * 免得两边各写一份 slice 逻辑后悄悄跑偏。
 */
export function resolveChartRange(monthsWithData: string[], range?: number | 'year'): string[] {
  if (range === 'year') {
    const year = new Date().getFullYear().toString()
    return monthsWithData.filter((m) => m.startsWith(year))
  }
  if (typeof range === 'number') return recentCalendarMonths(monthsWithData, range)
  return monthsWithData
}

/**
 * 返回 month 之前最近一个存在快照的月份（不含 month 本身）。
 * 用户记账不规律时，用它作为对比基准而非死板的上月。
 */
export function nearestPriorMonth(snapshots: Snapshot[], month: string): string | null {
  let result: string | null = null
  for (const m of allMonths(snapshots)) {
    if (m < month) result = m
  }
  return result
}

/** 每个账户最近一次（month 之前）的快照，用于“填入最近余额”。 */
export function latestSnapshotByAccount(
  snapshots: Snapshot[],
  beforeMonth: string,
): Map<string, Snapshot> {
  const map = new Map<string, Snapshot>()
  for (const s of snapshots) {
    if (s.month >= beforeMonth) continue
    const cur = map.get(s.account_id)
    if (!cur || s.month > cur.month) map.set(s.account_id, s)
  }
  return map
}

export function formatMoney(value: Decimal | string | number, currency = 'CNY', hide = false): string {
  if (hide) return '****'
  const d = new Decimal(value)
  const symbols: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥', HKD: 'HK$' }
  const sym = symbols[currency] ?? ''
  const decimals = currency === 'JPY' ? 0 : 2
  // 用 toFixed 而非 toNumber().toLocaleString()，避免大金额（>2^53）丢失精度
  const fixed = d.toFixed(decimals)
  // 负号要放在货币符号之前（"-¥3,000.00"），否则读起来像「¥ 负 3000」
  const negative = fixed.startsWith('-')
  const abs = negative ? fixed.slice(1) : fixed
  const dotIndex = abs.indexOf('.')
  const intPart = dotIndex >= 0 ? abs.slice(0, dotIndex) : abs
  const decPart = dotIndex >= 0 ? abs.slice(dotIndex + 1) : ''
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${sym}${withCommas}${decPart ? '.' + decPart : ''}`
}

export function pctChange(current: Decimal, previous: Decimal): Decimal | null {
  if (previous.isZero()) return null
  return current.sub(previous).div(previous.abs()).mul(100)
}

/**
 * 按「分类 → 账户」两级汇总某月某类型的金额（已折算为基准币种）。
 * 返回 Map<categoryKey, Map<accountId, totalValueInBaseCurrency>>
 *
 * 这是分类汇总的唯一实现：summarizeMonthByCategory 只是把它塌成一层，
 * 因此「分类级合计」与「账户级明细之和」天然相等，可用于加总核对。
 */
function collectByCategoryAccount(
  accounts: Account[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  month: string,
  base: string,
  type: 'asset' | 'liability',
  subAccounts?: SubAccount[],
): Map<string, Map<string, Decimal>> {
  const out = new Map<string, Map<string, Decimal>>()
  const snapMap = buildSnapshotMap(snapshots)
  const units = buildSummaryUnits(accounts, subAccounts ?? [])

  for (const unit of units) {
    if (unit.type !== type || !unit.include_in_networth) continue
    // 归档账户：归档月份之前仍计入，归档月及之后不计入
    if (unit.archived && unit.archived_at && month >= unit.archived_at) continue
    const snapKey = unit.sub_account_id
      ? `${unit.account_id}|${month}|${unit.sub_account_id}`
      : `${unit.id}|${month}`
    const snap = unit.sub_account_id
      ? snapMap.get(snapKey)
      : snapMap.get(snapKey) ?? snapMap.get(`${unit.account_id}|${month}`)
    if (!snap || !snap.balance) continue
    const currency = snap.currency ?? unit.currency
    const rate = rateFor(rates, currency, month, base)
    if (!rate) continue
    const val = new Decimal(snap.balance).mul(rate)
    let byAccount = out.get(unit.category)
    if (!byAccount) {
      byAccount = new Map<string, Decimal>()
      out.set(unit.category, byAccount)
    }
    byAccount.set(unit.account_id, (byAccount.get(unit.account_id) ?? new Decimal(0)).add(val))
  }

  return out
}

/**
 * 按分类汇总某月的资产或负债总值。
 * 返回 Map<categoryKey, totalValueInBaseCurrency>
 */
export function summarizeMonthByCategory(
  accounts: Account[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  month: string,
  base: string,
  type: 'asset' | 'liability',
  subAccounts?: SubAccount[],
): Map<string, Decimal> {
  const nested = collectByCategoryAccount(accounts, snapshots, rates, month, base, type, subAccounts)
  const catMap = new Map<string, Decimal>()
  for (const [category, byAccount] of nested) {
    let total = new Decimal(0)
    for (const v of byAccount.values()) total = total.add(v)
    catMap.set(category, total)
  }
  return catMap
}

/**
 * 按「分类 → 账户」两级汇总某月的资产或负债（已折算为基准币种）。
 * 供净增额分解图做「分类级排序 + 下钻到账户」使用。
 */
export function summarizeMonthByCategoryAndAccount(
  accounts: Account[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  month: string,
  base: string,
  type: 'asset' | 'liability',
  subAccounts?: SubAccount[],
): Map<string, Map<string, Decimal>> {
  return collectByCategoryAccount(accounts, snapshots, rates, month, base, type, subAccounts)
}

/**
 * 各账户在两个月之间的净资产变动额（折算为基准币种）。
 * 资产账户为正贡献、负债账户取反，因此所有账户之和等于净资产变化。
 *
 * category 传入时只统计该分类下的子账户——供分析页「排行跟随分类筛选」使用。
 */
export function accountNetChanges(
  accounts: Account[],
  subAccounts: SubAccount[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  month: string,
  priorMonth: string,
  base: string,
  category?: string,
): Map<string, Decimal> {
  const collect = (m: string) => {
    const out = new Map<string, Decimal>()
    for (const type of ['asset', 'liability'] as const) {
      const nested = summarizeMonthByCategoryAndAccount(accounts, snapshots, rates, m, base, type, subAccounts)
      for (const [cat, byAccount] of nested) {
        if (category && cat !== category) continue
        for (const [accId, val] of byAccount) {
          out.set(accId, (out.get(accId) ?? new Decimal(0)).add(type === 'asset' ? val : val.neg()))
        }
      }
    }
    return out
  }

  const cur = collect(month)
  const prev = collect(priorMonth)
  const ids = new Set<string>([...cur.keys(), ...prev.keys()])
  const result = new Map<string, Decimal>()
  for (const id of ids) {
    const delta = (cur.get(id) ?? new Decimal(0)).sub(prev.get(id) ?? new Decimal(0))
    if (!delta.isZero()) result.set(id, delta)
  }
  return result
}

/**
 * 取某个账户在指定月份的余额（折算为基准币种，按子账户聚合）。
 * 资产/负债都返回其"绝对值量级"（负债存储的即欠款正数），
 * 与 summarizeMonthByCategory 的口径一致，便于在同一张趋势图里直接对比。
 */
export function summarizeAccountMonth(
  account: Account,
  subAccounts: SubAccount[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  month: string,
  base: string,
): Decimal {
  const snapMap = buildSnapshotMap(snapshots)
  const subs = subAccounts.filter((s) => s.account_id === account.id)
  const units = buildSummaryUnits([account], subs)
  let total = new Decimal(0)
  for (const unit of units) {
    if (!unit.include_in_networth) continue
    if (unit.archived && unit.archived_at && month >= unit.archived_at) continue
    const snapKey = unit.sub_account_id
      ? `${unit.account_id}|${month}|${unit.sub_account_id}`
      : `${unit.id}|${month}`
    const snap = unit.sub_account_id
      ? snapMap.get(snapKey)
      : snapMap.get(snapKey) ?? snapMap.get(`${unit.account_id}|${month}`)
    if (!snap || snap.balance === '' || snap.balance == null) continue
    const balance = new Decimal(snap.balance)
    const currency = snap.currency ?? unit.currency
    const rate = rateFor(rates, currency, month, base)
    if (!rate) continue
    total = total.add(balance.mul(rate))
  }
  return total
}

/**
 * 账户 ∩ 分类 的某月折算余额：取该账户下属于指定分类的子账户（无子账户时回退到主账户自身）求和。
 * 供趋势图「分类 + 账户」双筛选的第四种组合（账户在某分类内的走势）使用。
 */
export function summarizeAccountCategoryMonth(
  account: Account,
  subAccounts: SubAccount[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  month: string,
  base: string,
  category: string,
): Decimal {
  const snapMap = buildSnapshotMap(snapshots)
  const subs = subAccounts.filter((s) => s.account_id === account.id && s.category === category)
  const units = buildSummaryUnits([account], subs)
  let total = new Decimal(0)
  for (const unit of units) {
    if (!unit.include_in_networth) continue
    if (unit.archived && unit.archived_at && month >= unit.archived_at) continue
    const snapKey = unit.sub_account_id
      ? `${unit.account_id}|${month}|${unit.sub_account_id}`
      : `${unit.id}|${month}`
    const snap = unit.sub_account_id
      ? snapMap.get(snapKey)
      : snapMap.get(snapKey) ?? snapMap.get(`${unit.account_id}|${month}`)
    if (!snap || snap.balance === '' || snap.balance == null) continue
    const balance = new Decimal(snap.balance)
    const currency = snap.currency ?? unit.currency
    const rate = rateFor(rates, currency, month, base)
    if (!rate) continue
    total = total.add(balance.mul(rate))
  }
  return total
}

export type HealthLevel = 'healthy' | 'warning' | 'danger'

export interface HealthInfo {
  level: HealthLevel
  label: string
  color: string
}

/**
 * 根据负债率判断健康等级。
 * warnThreshold: 低于此值为健康（默认 50%）
 * dangerThreshold: 高于此值为偏高（默认 70%）
 */
export function assessDebtHealth(
  debtRatio: Decimal.Value,
  warnThreshold = 50,
  dangerThreshold = 70,
): HealthInfo {
  const ratio = new Decimal(debtRatio)
  if (ratio.lt(warnThreshold)) {
    return { level: 'healthy', label: tl('health.healthy'), color: 'text-green-500' }
  } else if (ratio.lt(dangerThreshold)) {
    return { level: 'warning', label: tl('health.warning'), color: 'text-yellow-500' }
  } else {
    return { level: 'danger', label: tl('health.danger'), color: 'text-red-500' }
  }
}
