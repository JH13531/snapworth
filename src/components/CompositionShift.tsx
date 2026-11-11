import { useMemo, useState } from 'react'
import Decimal from 'decimal.js'
import type { Account, SubAccount, Snapshot, ExchangeRate } from '@/types'
import { categoryLabel } from '@/types'
import { summarizeMonthByCategory, formatMoney } from '@/lib/money'
import { formatMonth } from '@/lib/date'
import { chartColorAt } from '@/lib/palette'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

interface Props {
  accounts: Account[]
  subAccounts?: SubAccount[]
  snapshots: Snapshot[]
  rates: ExchangeRate[]
  month: string
  priorMonth: string
  base: string
  hide: boolean
  /** 首屏列出的分类数，其余折叠成「其他 N 项」 */
  maxRows?: number
}

type Row = {
  category: string
  thisPct: number
  prevPct: number
  /** 占比变化，单位为百分点 */
  deltaPct: number
}

const ZERO = new Decimal(0)

function sumMap(m: Map<string, Decimal>): Decimal {
  let s = ZERO
  for (const v of m.values()) s = s.add(v)
  return s
}

type Seg = Row & { pct: number }

/** 100% 堆叠条：用 flex-basis 0 + flex-grow 按占比分配宽度，避免百分比舍入留缝 */
function StackedBar({
  items,
  colorMap,
}: {
  items: Seg[]
  colorMap: Map<string, string>
}) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      {items.map((it) => (
        <div
          key={it.category}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{ flexGrow: it.pct, flexBasis: 0, backgroundColor: colorMap.get(it.category) }}
          title={`${categoryLabel(it.category)} ${it.pct.toFixed(1)}%`}
        />
      ))}
    </div>
  )
}


/**
 * 资产结构变化：上月/本月两条 100% 堆叠条 + 各分类占比变化（百分点）。
 * 与「净增额去向」互补——后者讲增量贡献，这个讲存量占比的挪动。
 */
export default function CompositionShift({
  accounts,
  subAccounts = [],
  snapshots,
  rates,
  month,
  priorMonth,
  base,
  hide,
  maxRows = 5,
}: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const { rows, thisTotal, prevTotal } = useMemo(() => {
    const thisMap = summarizeMonthByCategory(accounts, snapshots, rates, month, base, 'asset', subAccounts)
    const prevMap = summarizeMonthByCategory(accounts, snapshots, rates, priorMonth, base, 'asset', subAccounts)
    const thisTotal = sumMap(thisMap)
    const prevTotal = sumMap(prevMap)

    const keys = new Set<string>([...thisMap.keys(), ...prevMap.keys()])
    const out: Row[] = []
    for (const category of keys) {
      const cur = thisMap.get(category) ?? ZERO
      const prev = prevMap.get(category) ?? ZERO
      const thisPct = thisTotal.isZero() ? 0 : cur.div(thisTotal).mul(100).toNumber()
      const prevPct = prevTotal.isZero() ? 0 : prev.div(prevTotal).mul(100).toNumber()
      // 两个月都不到 0.05% 的分类不占一行，否则全是 0.0% 的噪声
      if (thisPct < 0.05 && prevPct < 0.05) continue
      out.push({ category, thisPct, prevPct, deltaPct: thisPct - prevPct })
    }
    // 按占比挪动幅度排序 —— 这张图要回答的是「结构变了多少」，不是「谁最大」
    out.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    return { rows: out, thisTotal, prevTotal }
  }, [accounts, subAccounts, snapshots, rates, month, priorMonth, base])

  // 颜色按「本月占比」降序分配，两个月共用同一套，保证同一分类上下颜色一致
  const colorMap = useMemo(() => {
    const order = [...rows].sort((a, b) => b.thisPct - a.thisPct).map((r) => r.category)
    const m = new Map<string, string>()
    order.forEach((c, i) => m.set(c, chartColorAt(i)))
    return m
  }, [rows])

  const prevSegs: Seg[] = rows
    .filter((r) => r.prevPct > 0.05)
    .map((r) => ({ ...r, pct: r.prevPct }))
  const thisSegs: Seg[] = rows
    .filter((r) => r.thisPct > 0.05)
    .map((r) => ({ ...r, pct: r.thisPct }))

  const visible = expanded ? rows : rows.slice(0, maxRows)
  const rest = expanded ? [] : rows.slice(maxRows)
  const restThis = rest.reduce((s, r) => s + r.thisPct, 0)
  const restDelta = rest.reduce((s, r) => s + r.deltaPct, 0)

  const deltaText = (d: number) => {
    const v = Math.abs(d) < 0.05 ? 0 : d
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}${t('composition_shift.pp')}`
  }

  return (
    <div>
      <h2 className="font-semibold text-sm">{t('composition_shift.title')}</h2>
      <p className="text-xs text-slate-400 mt-0.5 mb-3">{t('composition_shift.subtitle')}</p>

      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-400">{t('composition_shift.no_data')}</div>
      ) : (
        <>
          <div className="flex items-baseline justify-between text-[11px] text-slate-400 mb-1 tabular-nums">
            <span>{formatMonth(priorMonth)}</span>
            <span>{formatMoney(prevTotal, base, hide)}</span>
          </div>
          <StackedBar items={prevSegs} colorMap={colorMap} />

          <div className="flex items-baseline justify-between text-[11px] text-slate-500 mb-1 mt-2 tabular-nums">
            <span>{formatMonth(month)}</span>
            <span>{formatMoney(thisTotal, base, hide)}</span>
          </div>
          <StackedBar items={thisSegs} colorMap={colorMap} />

          <div className="mt-3 space-y-1.5">
            {visible.map((r) => {
              const up = r.deltaPct > 0
              return (
                <div key={r.category} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: colorMap.get(r.category) ?? '#94a3b8' }}
                  />
                  <span className="flex-1 truncate text-slate-600 dark:text-slate-300">
                    {categoryLabel(r.category)}
                  </span>
                  <span className="tabular-nums text-slate-500 w-11 text-right">{r.thisPct.toFixed(1)}%</span>
                  <span
                    className={`tabular-nums w-16 text-right ${
                      Math.abs(r.deltaPct) < 0.05
                        ? 'text-slate-400'
                        : up
                          ? 'text-slate-700 dark:text-slate-200'
                          : 'text-slate-400'
                    }`}
                    title={t('composition_shift.pp_hint')}
                  >
                    {deltaText(r.deltaPct)}
                  </span>
                </div>
              )
            })}

            {rest.length > 0 && (
              <button
                onClick={() => setExpanded(true)}
                className="flex items-center gap-2 text-xs w-full text-left hover:opacity-75 transition-opacity"
              >
                <span className="w-2 h-2 rounded-full shrink-0 bg-slate-300 dark:bg-slate-600" />
                <span className="flex-1 truncate text-slate-500">
                  {t('composition_shift.other', { count: rest.length })}
                </span>
                <span className="tabular-nums text-slate-400 w-11 text-right">{restThis.toFixed(1)}%</span>
                <span className="tabular-nums text-slate-400 w-16 text-right">{deltaText(restDelta)}</span>
                <ChevronDown size={12} className="text-slate-300 shrink-0" />
              </button>
            )}

            {expanded && rows.length > maxRows && (
              <button
                onClick={() => setExpanded(false)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <ChevronUp size={12} /> {t('composition_shift.collapse')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
