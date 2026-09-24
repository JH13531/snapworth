import EChart from '@/components/EChart'
import { useMemo, useRef, useEffect } from 'react'
import type { Account, SubAccount, Snapshot, ExchangeRate } from '@/types'
import { summarizeMonth, allMonths, resolveChartRange, formatMoney } from '@/lib/money'
import { formatMonthShort, formatMonth, breakMonthGaps, nextMonth } from '@/lib/date'
import { formatCompact } from '@/lib/i18n-locale'
import { useTranslation } from '@/lib/i18n'
import echarts from '@/lib/echarts'

interface Props {
  accounts: Account[]
  subAccounts?: SubAccount[]
  snapshots: Snapshot[]
  rates: ExchangeRate[]
  base: string
  hide: boolean
  invertColor: boolean
  range?: number | 'year'
  onMonthClick?: (month: string) => void
  /** 点击「未记录」的月份时触发（用于补录）。不传则点击无效。 */
  onMonthFill?: (month: string) => void
  /** 未记录月份的提示文案，出现在 tooltip 里。 */
  fillHint?: string
}

export default function NetWorthChart({
  accounts,
  subAccounts = [],
  snapshots,
  rates,
  base,
  hide,
  invertColor,
  range,
  onMonthClick,
  onMonthFill,
  fillHint,
}: Props) {
  const { t } = useTranslation()
  const monthsRef = useRef<string[]>([])
  const hasDataRef = useRef<Set<string>>(new Set())
  const chartRef = useRef<echarts.ECharts | null>(null)

  const option = useMemo(() => {
    const months = allMonths(snapshots)
    const hasData = new Set(months)
    let shown: string[] = resolveChartRange(months, range)
    // 「今年 / 全部」视图里，如果月份之间有断档，插入占位月份让折线断开
    // （数字范围视图里 shown 已经是连续的，不需要再处理）
    if (range === 'year' || range === undefined) {
      shown = breakMonthGaps(shown)
    }
    monthsRef.current = shown
    hasDataRef.current = hasData

    const sNet = t('chart.networth')
    const sAsset = t('chart.asset')
    const sLiab = t('chart.liability')
    const fillText = fillHint ?? t('chart.fill')

    // 未记账的月份置 null：折线在此断开，避免把「没记录」画成 0 或直接跨过去
    const netValues: (number | null)[] = []
    const assetValues: (number | null)[] = []
    const liabValues: (number | null)[] = []

    for (const m of shown) {
      if (!hasData.has(m)) {
        netValues.push(null)
        assetValues.push(null)
        liabValues.push(null)
        continue
      }
      const s = summarizeMonth(accounts, snapshots, rates, m, base, subAccounts)
      netValues.push(s.networth.toNumber())
      assetValues.push(s.assets.toNumber())
      liabValues.push(-s.liabilities.toNumber())
    }


    return {
      legend: {
        data: [sNet, sAsset, sLiab],
        bottom: 0,
        textStyle: { color: '#94a3b8', fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8,
      },
      grid: { left: 10, right: 10, top: 20, bottom: 36, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: (params: { dataIndex: number; seriesName: string; value: number | null }[]) => {
          if (!params.length) return ''
          const m = shown[params[0].dataIndex]
          if (!m) return ''
          const lines = params
            .filter((p) => p.value !== null && p.value !== undefined)
            .map((p) => {
              const color = p.seriesName === sNet ? '#3b82f6' : p.seriesName === sAsset ? '#22c55e' : '#ef4444'
              return `<span style="color:${color}">●</span> ${p.seriesName}: ${hide ? '****' : formatMoney(p.value as number, base)}`
            })
          if (!lines.length) {
            // 该月没有任何记录：折线在这里是断开的
            const hint = onMonthFill ? `<br/><span style="color:#3b82f6">${fillText}</span>` : ''
            return `<b>${formatMonth(m)}</b><br/><span style="color:#94a3b8">${t('chart.not_recorded')}</span>${hint}`
          }
          return `<b>${formatMonth(m)}</b><br/>${lines.join('<br/>')}`
        },
      },
      xAxis: {
        type: 'category',
        data: shown.map(formatMonthShort),
        axisLine: { lineStyle: { color: '#94a3b8' } },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          // 在以下情况显示完整年月，避免跨年数据只看到「7月 → 9月」误以为相邻：
          //   - 第一个月
          //   - 紧跟在断档（占位月）之后
          //   - 一月份（年首）
          // 占位月份本身不显示标签
          formatter: (_value: string, index: number) => {
            const m = shown[index]
            if (!m) return ''
            if (!hasData.has(m)) return ''
            const prev = index > 0 ? shown[index - 1] : null
            const isFirst = index === 0
            const afterGap = prev !== null && (!hasData.has(prev) || nextMonth(prev) !== m)
            const isJanuary = m.endsWith('-01')
            return isFirst || afterGap || isJanuary ? formatMonth(m) : formatMonthShort(m)
          },
        },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          formatter: (v: number) => hide ? '****' : formatCompact(v),
        },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } },
      },
      series: [
        {
          name: sAsset,
          type: 'line',
          data: assetValues,
          lineStyle: { opacity: 0.4, width: 1 },
          itemStyle: { color: '#22c55e' },
          areaStyle: { opacity: 0.08, color: '#22c55e' },
          symbol: 'none',
          smooth: true,
        },
        {
          name: sLiab,
          type: 'line',
          data: liabValues,
          lineStyle: { opacity: 0.4, width: 1 },
          itemStyle: { color: '#ef4444' },
          areaStyle: { opacity: 0.08, color: '#ef4444' },
          symbol: 'none',
          smooth: true,
        },
        {
          name: sNet,
          type: 'line',
          data: netValues,
          lineStyle: { width: 2.5, color: '#3b82f6' },
          itemStyle: { color: '#3b82f6' },
          areaStyle: {
            opacity: 0.1,
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
              { offset: 0, color: 'rgba(59,130,246,0.3)' }, { offset: 1, color: 'rgba(59,130,246,0)' },
            ]},
          },
          symbol: 'circle',
          symbolSize: 6,
          smooth: true,
        },
      ],
    }
  }, [accounts, subAccounts, snapshots, rates, base, hide, invertColor, range, t, fillHint])

  // 使用 ZRender 点击事件 — 点击图表网格任意位置都能触发，而非仅在数据点上
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onMonthClick) return
    const zr = chart.getZr()
    const handler = (params: { offsetX: number; offsetY: number }) => {
      const point: [number, number] = [params.offsetX, params.offsetY]
      const xVal = chart.convertFromPixel({ seriesIndex: 2 }, point)
      if (!xVal || typeof xVal[0] !== 'number') return
      const idx = Math.round(xVal[0])
      const m = monthsRef.current[idx]
      if (!m) return
      if (hasDataRef.current.has(m)) {
        // 有数据：跳到当月复盘
        onMonthClick(m)
      } else {
        // 断档月：跳到该月记账页补录
        onMonthFill?.(m)
      }
    }
    zr.on('click', handler)
    return () => { zr.off('click', handler) }
  }, [onMonthClick, onMonthFill])

  return <EChart option={option} style={{ height: 250, cursor: onMonthClick ? 'pointer' : 'default' }} onChartReady={(c) => { chartRef.current = c }} />
}
