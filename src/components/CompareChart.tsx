import { useMemo } from 'react'
import EChart from '@/components/EChart'
import { formatMoney } from '@/lib/money'
import { formatCompact } from '@/lib/i18n-locale'

interface MetricRow {
  name: string
  from: number
  to: number
}

interface Props {
  metrics: MetricRow[]
  fromLabel: string
  toLabel: string
  base: string
  hide: boolean
}

/**
 * 两月对比的柱状图：横轴为「净资产 / 资产 / 负债」三项指标，
 * 每个指标两根柱子（起始月 vs 截止月）。纯展示，无交互。
 */
export default function CompareChart({ metrics, fromLabel, toLabel, base, hide }: Props) {
  const option = useMemo(() => {
    return {
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      legend: {
        data: [fromLabel, toLabel],
        top: 0,
        textStyle: { color: '#94a3b8', fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: { name: string; seriesName: string; value: number }[]) => {
          const lines = params
            .filter((p) => p.value !== null && p.value !== undefined)
            .map((p) => {
              const color = p.seriesName === fromLabel ? '#3b82f6' : '#8b5cf6'
              return `<span style="color:${color}">●</span> ${p.seriesName}: ${hide ? '****' : formatMoney(p.value as number, base)}`
            })
          return `<b>${params[0]?.name ?? ''}</b><br/>${lines.join('<br/>')}`
        },
      },
      xAxis: {
        type: 'category',
        data: metrics.map((m) => m.name),
        axisLine: { lineStyle: { color: '#94a3b8' } },
        axisTick: { show: false },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          formatter: (v: number) => (hide ? '****' : formatCompact(v)),
        },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } },
      },
      series: [
        {
          name: fromLabel,
          type: 'bar',
          data: metrics.map((m) => m.from),
          itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] },
          barWidth: '32%',
        },
        {
          name: toLabel,
          type: 'bar',
          data: metrics.map((m) => m.to),
          itemStyle: { color: '#8b5cf6', borderRadius: [4, 4, 0, 0] },
          barWidth: '32%',
        },
      ],
    }
  }, [metrics, fromLabel, toLabel, base, hide])

  return <EChart option={option} style={{ height: 240 }} />
}
