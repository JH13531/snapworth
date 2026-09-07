import EChart from '@/components/EChart'
import { useMemo, useState } from 'react'
import type { Account, SubAccount, Snapshot, ExchangeRate } from '@/types'
import { summarizeMonthByCategory, summarizeAccountMonth, summarizeAccountCategoryMonth, formatMoney, allMonths } from '@/lib/money'
import { formatMonthShort } from '@/lib/date'
import { categoryLabel } from '@/types'
import { useTranslation } from '@/lib/i18n'
import { formatCompact } from '@/lib/i18n-locale'
import Decimal from 'decimal.js'

interface Props {
  accounts: Account[]
  subAccounts?: SubAccount[]
  snapshots: Snapshot[]
  rates: ExchangeRate[]
  base: string
  hide: boolean
  type: 'asset' | 'liability'
  focusCat?: string | null // 空 = 全部分类
  focusAccount?: string | null // 空 = 全部账户
}

const CAT_COLORS: Record<string, string> = {
  cash: '#3b82f6',
  savings: '#10b981',
  investment: '#f59e0b',
  alternative: '#8b5cf6',
  real_estate: '#ef4444',
  insurance: '#06b6d4',
  receivable: '#f97316',
  other_asset: '#64748b',
  credit_card: '#ec4899',
  mortgage: '#6366f1',
  car_loan: '#14b8a6',
  consumer_loan: '#84cc16',
  payable: '#eab308',
  other_liability: '#94a3b8',
}

export default function CategoryTrendChart({ accounts, subAccounts = [], snapshots, rates, base, hide, type, focusCat, focusAccount }: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'value' | 'percent'>('value')

  const catKey = focusCat || null
  const accId = focusAccount || null
  const accFocus = accId ? accounts.find((a) => a.id === accId) ?? null : null

  const months = useMemo(() => allMonths(snapshots), [snapshots])

  // 每个月在各分类上的合计（用于堆叠图与"占比"计算）
  const monthCatData = useMemo(() => {
    const map = new Map<string, Map<string, Decimal>>()
    for (const m of months) {
      map.set(m, summarizeMonthByCategory(accounts, snapshots, rates, m, base, type, subAccounts))
    }
    return map
  }, [accounts, subAccounts, snapshots, rates, base, type, months])

  // 出现过且按总值排序的分类
  const sortedCats = useMemo(() => {
    const catTotals = new Map<string, Decimal>()
    for (const m of months) {
      monthCatData.get(m)?.forEach((v, cat) => {
        catTotals.set(cat, (catTotals.get(cat) ?? new Decimal(0)).add(v))
      })
    }
    return [...catTotals.keys()].sort((a, b) => catTotals.get(b)!.minus(catTotals.get(a)!).toNumber())
  }, [monthCatData, months])

  // 占比仅在「未聚焦到具体账户」时可用（聚焦账户后只有一条线，占比无意义）
  const shareEnabled = !accFocus
  const effectiveMode: 'value' | 'percent' = shareEnabled ? mode : 'value'

  const option = useMemo(() => {
    if (months.length === 0) return null

    const makeLine = (name: string, color: string, values: Decimal[], area = false) => ({
      name,
      type: 'line' as const,
      stack: area ? 'total' : undefined,
      areaStyle: area ? { opacity: 0.85 } : { opacity: 0.12 },
      emphasis: { focus: 'series' as const },
      lineStyle: { width: area ? 1 : 2.5, color },
      itemStyle: { color },
      symbol: 'none',
      smooth: true,
      data: values.map((v, i) => {
        if (effectiveMode === 'percent') {
          const monthTotal = monthCatData.get(months[i]) ?? new Map<string, Decimal>()
          const sum = [...monthTotal.values()].reduce((s, x) => s.add(x), new Decimal(0))
          return sum.isZero() ? 0 : v.div(sum).mul(100).toNumber()
        }
        return v.toNumber()
      }),
    })

    let series: ReturnType<typeof makeLine>[] = []

    if (!catKey && !accFocus) {
      // 全部分类堆叠
      series = sortedCats.map((cat) => {
        const color = CAT_COLORS[cat] ?? '#64748b'
        const name = categoryLabel(cat)
        const values = months.map((m) => monthCatData.get(m)?.get(cat) ?? new Decimal(0))
        return makeLine(name, color, values, true)
      })
    } else if (accFocus && !catKey) {
      // 单个账户全程
      const color = accFocus.color
      const name = accFocus.name
      const values = months.map((m) => summarizeAccountMonth(accFocus, subAccounts, snapshots, rates, m, base))
      series = [makeLine(name, color, values, true)]
    } else if (!accFocus && catKey) {
      // 单个分类
      const color = CAT_COLORS[catKey] ?? '#64748b'
      const name = categoryLabel(catKey)
      const values = months.map((m) => monthCatData.get(m)?.get(catKey) ?? new Decimal(0))
      series = [makeLine(name, color, values, true)]
    } else {
      // 账户 ∩ 分类：该账户在指定分类内的走势
      const color = accFocus!.color
      const name = `${accFocus!.name} · ${categoryLabel(catKey!)}`
      const values = months.map((m) => summarizeAccountCategoryMonth(accFocus!, subAccounts, snapshots, rates, m, base, catKey!))
      series = [makeLine(name, color, values, true)]
    }

    if (series.length === 0) return null

    const yFormatter = effectiveMode === 'percent'
      ? (v: number) => `${v.toFixed(0)}%`
      : (v: number) => hide ? '****' : formatCompact(v)

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          if (!params.length) return ''
          const lines = params.map((p) => {
            const val = effectiveMode === 'percent'
              ? `${p.value.toFixed(1)}%`
              : (hide ? '****' : formatMoney(p.value, base))
            return `<span style="color:${p.color}">●</span> ${p.seriesName}: ${val}`
          })
          return `<b>${params[0].axisValue}</b><br/>${lines.join('<br/>')}`
        },
      },
      legend: {
        data: series.map((s) => s.name),
        bottom: 0,
        textStyle: { color: '#94a3b8', fontSize: 10 },
        itemWidth: 10,
        itemHeight: 8,
        type: 'scroll',
      },
      grid: { left: 10, right: 10, top: 10, bottom: 36, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: months.map(formatMonthShort),
        axisLine: { lineStyle: { color: '#94a3b8' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#94a3b8', fontSize: 11, formatter: yFormatter },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } },
      },
      series,
    }
  }, [accounts, subAccounts, snapshots, rates, base, hide, type, mode, t, catKey, accFocus, months, monthCatData, sortedCats, effectiveMode])

  if (!option || option.series.length === 0) {
    return <div className="text-center text-slate-400 text-sm py-8">{t('category_trend.empty')}</div>
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-2 gap-2">
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setMode('value')}
            disabled={!shareEnabled}
            className={`px-2 py-0.5 rounded ${!shareEnabled ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed' : mode === 'value' ? 'bg-brand-100 dark:bg-brand-900 text-brand-600' : 'text-slate-400'}`}
            >{t('category_trend.amount')}</button>
          <button
            onClick={() => setMode('percent')}
            disabled={!shareEnabled}
            className={`px-2 py-0.5 rounded ${!shareEnabled ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed' : mode === 'percent' ? 'bg-brand-100 dark:bg-brand-900 text-brand-600' : 'text-slate-400'}`}
            >{t('category_trend.share')}</button>
        </div>
      </div>
      <EChart option={option} style={{ height: 280 }} />
    </div>
  )
}
