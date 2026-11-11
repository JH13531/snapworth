/**
 * 零轴分叉条：从中心向左右延伸，正负一眼可辨。
 * 「变动」类图表的统一画法（净增额分解、分析页排行、对比页共用）。
 */
export default function DivergingBar({
  value,
  maxAbs,
  color,
  className = '',
}: {
  value: number
  /** 用于归一化的最大绝对值 */
  maxAbs: number
  color: string
  className?: string
}) {
  // 极小的变动也要留一点可见宽度，否则和「无变化」区分不开
  const pct = maxAbs <= 0 ? 0 : Math.max((Math.abs(value) / maxAbs) * 50, 1.2)

  return (
    <div className={`relative h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden ${className}`}>
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300 dark:bg-slate-600" />
      <div
        className="absolute inset-y-0 rounded-full transition-[width] duration-300"
        style={
          value >= 0
            ? { left: '50%', width: `${pct}%`, backgroundColor: color }
            : { right: '50%', width: `${pct}%`, backgroundColor: color }
        }
      />
    </div>
  )
}
