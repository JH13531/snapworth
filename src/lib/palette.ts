/**
 * 图表配色：分类构成（饼图 / 堆叠条）共用一套，避免同一分类在不同图表里颜色不一致。
 * 颜色按下标取，用色顺序由调用方决定（通常是占比降序）。
 */
export const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
  '#6366f1', '#14b8a6', '#84cc16', '#64748b',
]

export function chartColorAt(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]
}
