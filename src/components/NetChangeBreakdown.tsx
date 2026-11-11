import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react'
import Decimal from 'decimal.js'
import type { Account, AccountType, SubAccount, Snapshot, ExchangeRate } from '@/types'
import { CATEGORIES, categoryLabel } from '@/types'
import { formatMoney, summarizeMonth, summarizeMonthByCategoryAndAccount } from '@/lib/money'
import { formatMonth } from '@/lib/date'
import { Icon } from '@/components/Icon'
import DivergingBar from '@/components/DivergingBar'
import { useTranslation } from '@/lib/i18n'

interface Props {
  accounts: Account[]
  subAccounts?: SubAccount[]
  snapshots: Snapshot[]
  rates: ExchangeRate[]
  /** 期末月份 */
  month: string
  /** 期初月份（通常是最近的上一个有效月份） */
  priorMonth: string
  base: string
  hide: boolean
  invert: boolean
  /** 首屏最多显示几个分类，其余折叠成「其他 N 项」 */
  maxRows?: number
}

type AccountMove = { id: string; from: Decimal; to: Decimal; delta: Decimal }
type CatMove = {
  category: string
  type: AccountType
  from: Decimal
  to: Decimal
  /** 对净资产的贡献：分类资产增减 − 分类负债增减 */
  delta: Decimal
  accounts: AccountMove[]
}

const ZERO = new Decimal(0)

function sumMap(m?: Map<string, Decimal>): Decimal {
  if (!m) return ZERO
  let s = ZERO
  for (const v of m.values()) s = s.add(v)
  return s
}

/**
 * 净增额分解：把「净资产从 A 月到 B 月变了多少」拆成各分类的贡献，
 * 各项之和恒等于净资产变化，可逐项核对；点击分类可下钻到账户级。
 */
export default function NetChangeBreakdown({
  accounts,
  subAccounts = [],
  snapshots,
  rates,
  month,
  priorMonth,
  base,
  hide,
  invert,
  maxRows = 5,
}: Props) {
  const { t } = useTranslation()
  const [drilled, setDrilled] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const accountMap = useMemo(() => {
    const m = new Map<string, Account>()
    for (const a of accounts) m.set(a.id, a)
    return m
  }, [accounts])

  const { rows, fromNet, toNet } = useMemo(() => {
    const fromA = summarizeMonthByCategoryAndAccount(accounts, snapshots, rates, priorMonth, base, 'asset', subAccounts)
    const fromL = summarizeMonthByCategoryAndAccount(accounts, snapshots, rates, priorMonth, base, 'liability', subAccounts)
    const toA = summarizeMonthByCategoryAndAccount(accounts, snapshots, rates, month, base, 'asset', subAccounts)
    const toL = summarizeMonthByCategoryAndAccount(accounts, snapshots, rates, month, base, 'liability', subAccounts)

    const keys = new Set<string>([...fromA.keys(), ...fromL.keys(), ...toA.keys(), ...toL.keys()])
    const out: CatMove[] = []

    for (const category of keys) {
      const fa = fromA.get(category)
      const fl = fromL.get(category)
      const ta = toA.get(category)
      const tl = toL.get(category)

      const fromAsset = sumMap(fa)
      const fromLiab = sumMap(fl)
      const toAsset = sumMap(ta)
      const toLiab = sumMap(tl)
      const from = fromAsset.sub(fromLiab)
      const to = toAsset.sub(toLiab)
      const delta = to.sub(from)
      if (delta.isZero()) continue

      // 账户级明细：同一套嵌套 map 相减，故其和必然等于该分类的 delta
      const accIds = new Set<string>([
        ...(fa?.keys() ?? []),
        ...(fl?.keys() ?? []),
        ...(ta?.keys() ?? []),
        ...(tl?.keys() ?? []),
      ])
      const accMoves: AccountMove[] = []
      for (const id of accIds) {
        const accFrom = (fa?.get(id) ?? ZERO).sub(fl?.get(id) ?? ZERO)
        const accTo = (ta?.get(id) ?? ZERO).sub(tl?.get(id) ?? ZERO)
        const accDelta = accTo.sub(accFrom)
        if (accDelta.isZero()) continue
        accMoves.push({ id, from: accFrom, to: accTo, delta: accDelta })
      }
      accMoves.sort((a, b) => b.delta.abs().minus(a.delta.abs()).toNumber())

      const def = CATEGORIES.find((c) => c.key === category)
      const type: AccountType =
        def?.type ?? (fromAsset.add(toAsset).gte(fromLiab.add(toLiab)) ? 'asset' : 'liability')

      out.push({ category, type, from, to, delta, accounts: accMoves })
    }

    out.sort((a, b) => b.delta.abs().minus(a.delta.abs()).toNumber())

    return {
      rows: out,
      fromNet: summarizeMonth(accounts, snapshots, rates, priorMonth, base, subAccounts).networth,
      toNet: summarizeMonth(accounts, snapshots, rates, month, base, subAccounts).networth,
    }
  }, [accounts, subAccounts, snapshots, rates, priorMonth, month, base])

  const total = rows.reduce((s, r) => s.add(r.delta), ZERO)
  const maxAbs = rows.reduce((m, r) => (r.delta.abs().gt(m) ? r.delta.abs() : m), ZERO)

  const tone = (v: Decimal) => {
    if (v.isZero()) return { text: 'text-slate-400', bar: '#94a3b8' }
    // 默认 A 股习惯：涨红跌绿；开启 invert 时反转
    const warm = invert ? v.lt(0) : v.gt(0)
    return warm ? { text: 'text-red-500', bar: '#ef4444' } : { text: 'text-green-500', bar: '#10b981' }
  }

  /** 分类/账户的「上月 → 本月」余额。
   *  负债类展示为欠款绝对值并加「负债」前缀：写「-¥1,400,000 → -¥1,388,000」会让人以为余额是负数。 */
  function balanceRange(from: Decimal, to: Decimal, isLiability: boolean) {
    if (isLiability) {
      return `${t('breakdown.liability')} ${formatMoney(from.abs(), base, hide)} → ${formatMoney(to.abs(), base, hide)}`
    }
    return `${formatMoney(from, base, hide)} → ${formatMoney(to, base, hide)}`
  }

  const period = `${formatMonth(priorMonth)} → ${formatMonth(month)}`

  // ── 下钻：某个分类下的账户明细 ──
  if (drilled) {
    const row = rows.find((r) => r.category === drilled)
    const c = tone(row?.delta ?? ZERO)
    return (
      <div>
        <button
          onClick={() => setDrilled(null)}
          className="flex items-center gap-1 text-sm text-brand-600 mb-3 -ml-1"
        >
          <ChevronLeft size={16} /> {categoryLabel(drilled)}
        </button>
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-xs text-slate-400">{t('breakdown.category_contribution')}</span>
          <span className={`text-sm font-medium tabular-nums ${c.text}`}>
            {(row?.delta.gte(0) ?? true) ? '+' : ''}
            {formatMoney(row?.delta ?? ZERO, base, hide)}
          </span>
        </div>
        <div className="space-y-3">
          {row?.accounts.map((am) => {
            const acc = accountMap.get(am.id)
            const t2 = tone(am.delta)
            return (
              <Link key={am.id} to={`/accounts/${am.id}`} className="block hover:opacity-75 transition-opacity">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0"
                    style={{ backgroundColor: acc?.color ?? '#64748b' }}
                  >
                    <Icon name={acc?.icon ?? 'circle-dot'} size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm truncate">{acc?.name ?? am.id}</span>
                      <span className={`text-sm font-medium tabular-nums shrink-0 ${t2.text}`}>
                        {am.delta.gte(0) ? '+' : ''}
                        {formatMoney(am.delta, base, hide)}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 tabular-nums truncate">
                      {balanceRange(am.from, am.to, row?.type === 'liability')}
                    </div>
                    <DivergingBar value={am.delta.toNumber()} maxAbs={maxAbs.toNumber()} color={t2.bar} className="mt-1.5" />
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
        {row && row.accounts.length === 0 && (
          <div className="py-4 text-center text-sm text-slate-400">{t('breakdown.no_accounts')}</div>
        )}
      </div>
    )
  }

  // ── 分类级：首屏 Top N，其余折叠成「其他 N 项」（仍计入合计） ──
  const visible = expanded ? rows : rows.slice(0, maxRows)
  const rest = expanded ? [] : rows.slice(maxRows)
  const restSum = rest.reduce((s, r) => s.add(r.delta), ZERO)
  const restTone = tone(restSum)
  const totalTone = tone(total)

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-semibold text-sm">
          {total.gte(0) ? t('breakdown.title') : t('breakdown.title_down')}
        </h2>
        <span className="text-[11px] text-slate-400 tabular-nums">{period}</span>
      </div>
      <p className="text-xs text-slate-400 mb-1">
        {t('breakdown.subtitle', {
          from: formatMoney(fromNet, base, hide),
          to: formatMoney(toNet, base, hide),
        })}
      </p>

      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-400">{t('breakdown.no_change')}</div>
      ) : (
        <>
          <div className="space-y-3 mt-3">
            {visible.map((row) => {
              const def = CATEGORIES.find((c) => c.key === row.category)
              const c = tone(row.delta)
              return (
                <button
                  key={row.category}
                  onClick={() => setDrilled(row.category)}
                  className="block w-full text-left hover:opacity-75 transition-opacity"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800 shrink-0">
                      <Icon
                        name={def?.icon ?? 'circle-dot'}
                        size={14}
                        className="text-slate-500 dark:text-slate-400"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm truncate">{categoryLabel(row.category)}</span>
                        <span className={`text-sm font-medium tabular-nums shrink-0 ${c.text}`}>
                          {row.delta.gte(0) ? '+' : ''}
                          {formatMoney(row.delta, base, hide)}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 tabular-nums truncate">
                        {balanceRange(row.from, row.to, row.type === 'liability')}
                      </div>
                      <DivergingBar value={row.delta.toNumber()} maxAbs={maxAbs.toNumber()} color={c.bar} className="mt-1.5" />
                    </div>
                  </div>
                </button>
              )
            })}

            {rest.length > 0 && (
              <button
                onClick={() => setExpanded(true)}
                className="block w-full text-left hover:opacity-75 transition-opacity"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800 shrink-0">
                    <Icon name="circle-dot" size={14} className="text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm truncate text-slate-500">
                        {t('breakdown.other', { count: rest.length })}
                      </span>
                      <span className={`text-sm font-medium tabular-nums shrink-0 ${restTone.text}`}>
                        {restSum.gte(0) ? '+' : ''}
                        {formatMoney(restSum, base, hide)}
                      </span>
                    </div>
                    <DivergingBar value={restSum.toNumber()} maxAbs={maxAbs.toNumber()} color={restTone.bar} className="mt-1.5" />
                  </div>
                  <ChevronDown size={14} className="text-slate-300 shrink-0" />
                </div>
              </button>
            )}

            {expanded && rows.length > maxRows && (
              <button
                onClick={() => setExpanded(false)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <ChevronUp size={12} /> {t('breakdown.collapse')}
              </button>
            )}
          </div>

          {/* 合计：恒等于净资产变化，供逐项核对 */}
          <div className="flex items-baseline justify-between mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs text-slate-500">{t('breakdown.total')}</span>
            <span className={`text-sm font-semibold tabular-nums ${totalTone.text}`}>
              {total.gte(0) ? '+' : ''}
              {formatMoney(total, base, hide)}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
