import { useRef, useEffect, type CSSProperties } from 'react'
import echarts from '@/lib/echarts'

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  option: Record<string, any>
  style?: CSSProperties
  className?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvents?: Record<string, (params: any) => void>
  /** 图表实例就绪时回调，用于高级操作（如 ZRender 事件） */
  onChartReady?: (chart: echarts.ECharts) => void
}

/**
 * 轻量 ECharts React wrapper，直接使用 echarts/core 按需引入，
 * 替代 echarts-for-react（它会静态 import 完整 echarts，无法 tree-shake）。
 */
export default function EChart({ option, style, className, onEvents, onChartReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = echarts.init(containerRef.current)
    chartRef.current = chart
    onChartReady?.(chart)

    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onEvents) return
    for (const [event, handler] of Object.entries(onEvents)) {
      chart.on(event, handler)
    }
    return () => {
      if (!chart) return
      for (const [event, handler] of Object.entries(onEvents)) {
        chart.off(event, handler)
      }
    }
  }, [onEvents])

  return <div ref={containerRef} style={style} className={className} />
}
