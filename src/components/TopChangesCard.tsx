import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Account, SubAccount, Snapshot, ExchangeRate } from '@/types'
import { rateFor, buildSnapshotMap, formatMoney } from '@/lib/money'
import { CATEGORIES, categoryLabel, subAccountName } from '@/types'
import { Icon } from '@/components/Icon'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import Decimal from 'decimal.js'

interface Props {
  title?: string
  subtitle?: string
  accounts: Account[]
  subAccounts?: SubAccount[]
  snapshots: Snapshot[]
  rates: ExchangeRate[]
  month: string
  priorMonth: string | null
  base: string
  hide: boolean
  invert: boolean
  maxCategories?: number
}

type UnitDiff = { unit: SubAccount | Account; account: Account; diff: Decimal; isSub: boolean }

export default function TopChangesCard({
  title,
  subtitle,
  accounts,
  subAccounts = [],
  snapshots,
  rates,
  month,
  priorMonth,
  base,
  hide,
  invert,
  maxCategories = 3,
}: Props) {
  const { t } = useTranslation()
  const heading = title ?? t('top_changes.title')
  const [drillCat, setDrillCat] = useState<string | null>(null)

  const accountMap = useMemo(() => {
    const m = new Map<string, Account>()
    for (const a of accounts) m.set(a.id, a)
    return m
  }, [accounts])

  const categoryChanges = useMemo(() => {
    if (!priorMonth) return []
    const snapMap = buildSnapshotMap(snapshots)
    const diffs: UnitDiff[] = []

    const hasSubs = subAccounts.length > 0

    if (hasSubs) {
      for (const sa of subAccounts) {
        if (sa.archived || !sa.include_in_networth) continue
        const account = accountMap.get(sa.account_id)
        if (!account || account.archived) continue
        const curKey = `${sa.account_id}|${month}|${sa.id}`
        const prevKey = `${sa.account_id}|${priorMonth}|${sa.id}`
        const cur = snapMap.get(curKey)
        const prev = snapMap.get(prevKey)
        if (!cur && !prev) continue
        const curRate = cur ? rateFor(rates, cur.currency ?? sa.currency, month, base) : null
        const prevRate = prev ? rateFor(rates, prev.currency ?? sa.currency, priorMonth, base) : null
        const curB = cur && curRate ? new Decimal(cur.balance).mul(curRate) : new Decimal(0)
        const prevB = prev && prevRate ? new Decimal(prev.balance).mul(prevRate) : new Decimal(0)
        if (curB.isZero() && prevB.isZero()) continue
        const raw = curB.sub(prevB)
        const diff = sa.type === 'asset' ? raw : raw.neg()
        if (diff.isZero()) continue
        diffs.push({ unit: sa, account, diff, isSub: true })
      }
    } else {
      for (const acc of accounts) {
        if (acc.archived || !acc.include_in_networth) continue
        const cur = snapMap.get(`${acc.id}|${month}`)
        const prev = snapMap.get(`${acc.id}|${priorMonth}`)
        if (!cur && !prev) continue
        const curRate = cur ? rateFor(rates, cur.currency ?? acc.currency, month, base) : null
        const prevRate = prev ? rateFor(rates, prev.currency ?? acc.currency, priorMonth, base) : null
        const curB = cur && curRate ? new Decimal(cur.balance).mul(curRate) : new Decimal(0)
        const prevB = prev && prevRate ? new Decimal(prev.balance).mul(prevRate) : new Decimal(0)
        if (curB.isZero() && prevB.isZero()) continue
        const raw = curB.sub(prevB)
        const diff = acc.type === 'asset' ? raw : raw.neg()
        if (diff.isZero()) continue
        diffs.push({ unit: acc, account: acc, diff, isSub: false })
      }
    }

    const catMap = new Map<string, { diff: Decimal; items: UnitDiff[] }>()
    for (const d of diffs) {
      const cat = d.unit.category
      if (!catMap.has(cat)) catMap.set(cat, { diff: new Decimal(0), items: [] })
      const entry = catMap.get(cat)!
      entry.diff = entry.diff.add(d.diff)
      entry.items.push(d)
    }

    return [...catMap.entries()]
      .map(([cat, { diff, items }]) => ({
        category: cat,
        diff,
        items: items.sort((a, b) => b.diff.abs().minus(a.diff.abs()).toNumber()),
      }))
      .sort((a, b) => b.diff.abs().minus(a.diff.abs()).toNumber())
      .slice(0, maxCategories)
  }, [accounts, subAccounts, accountMap, snapshots, rates, month, priorMonth, base, maxCategories])

  if (categoryChanges.length === 0) return null

  if (drillCat) {
    const catEntry = categoryChanges.find((c) => c.category === drillCat)
    const total = catEntry?.items.reduce((s, x) => s.add(x.diff.abs()), new Decimal(0)) ?? new Decimal(0)

    return (
      <div>
        <button
          onClick={() => setDrillCat(null)}
          className="flex items-center gap-1 text-sm text-brand-600 mb-3 -ml-1"
        >
          <ChevronLeft size={16} /> {categoryLabel(drillCat)}
        </button>
        {catEntry && (
          <div className="max-h-60 overflow-y-auto -mx-1 px-1 space-y-2.5">
            {catEntry.items.map(({ unit, account, diff, isSub }) => {
              const pct = total.isZero() ? 0 : (diff.abs().div(total).mul(100)).toNumber()
              const displayName = isSub
                ? subAccountName(unit as SubAccount, account.name)
                : unit.name
              const subLabel = isSub ? account.name : ''
              const catDef = CATEGORIES.find((c) => c.key === unit.category)
              return (
                <Link
                  key={unit.id}
                  to={`/accounts/${account.id}`}
                  className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0"
                    style={{ backgroundColor: catDef?.type === 'liability' ? '#ef4444' : account.color }}
                  >
                    <Icon name={catDef?.icon ?? 'circle-dot'} size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{displayName}</div>
                    {subLabel && <div className="text-[10px] text-slate-400 truncate">{subLabel}</div>}
                    <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full mt-1 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: account.color,
                        }}
                      />
                    </div>
                  </div>
                  <div className={`text-sm font-medium tabular-nums shrink-0 ${
                    diff.gte(0) ? (invert ? 'text-green-500' : 'text-red-500') : (invert ? 'text-red-500' : 'text-green-500')
                  }`}>
                    {diff.gte(0) ? '+' : ''}{formatMoney(diff, base, hide)}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
        {catEntry?.items.length === 0 && (
          <div className="text-center text-slate-400 text-sm py-4">{t('top_changes.no_accounts')}</div>
        )}
      </div>
    )
  }

  return (
    <div>
      <h2 className="font-semibold mb-1">{heading}</h2>
      {subtitle && <p className="text-xs text-slate-400 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      <div className="space-y-2.5">
        {categoryChanges.map(({ category, diff }) => {
          const catDef = CATEGORIES.find((c) => c.key === category)
          return (
            <button
              key={category}
              onClick={() => setDrillCat(category)}
              className="flex items-center gap-3 w-full text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-2 px-2 py-1.5 rounded-lg transition-colors"
            >
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800 shrink-0">
                <Icon name={catDef?.icon ?? 'circle-dot'} size={18} className="text-slate-600 dark:text-slate-400" />
              </div>
              <div className="flex-1 text-sm">{categoryLabel(category)}</div>
              <div className={`text-sm font-medium tabular-nums ${
                diff.gte(0) ? (invert ? 'text-green-500' : 'text-red-500') : (invert ? 'text-red-500' : 'text-green-500')
              }`}>
                {diff.gte(0) ? '+' : ''}{formatMoney(diff, base, hide)}
              </div>
              <ChevronRight size={14} className="text-slate-300" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
