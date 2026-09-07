import Decimal from 'decimal.js'
import { addMonths, monthDiff } from '@/lib/date'

/**
 * 净资产增速推断与目标达成预测。
 *
 * 全部是纯函数，方便单测覆盖各种边界（数据不足、零增长、跨年断档等）。
 */

export interface NetWorthPoint {
  month: string
  networth: Decimal
}

export type ProjectionReason =
  | 'ok'
  /** 有数据的月份不足 2 个，无法推断增速 */
  | 'insufficient_data'
  /** 窗口内净资产没有增长（持平或倒退），按当前速度永远追不上目标 */
  | 'no_growth'
  /** 按当前速度需要超过 MAX_MONTHS 个月，预测已无意义 */
  | 'too_far'

/** 超过这个月数就不再给出预计达成时间（50 年），避免输出「2185 年」这种废话。 */
export const MAX_MONTHS = 600

export interface GrowthRate {
  /** 窗口起点（有数据的月份） */
  windowStart: string
  /** 窗口终点（有数据的月份） */
  windowEnd: string
  /** 窗口跨越的自然月数（含断档的月份） */
  spanMonths: number
  /** 窗口内有数据的月份数 */
  dataPoints: number
  /** 窗口内净资产净增额 */
  netGain: Decimal
  /** 平均每月增量 = 净增额 / 自然月跨度 */
  monthlyRate: Decimal
}

export interface GoalProjection {
  reason: ProjectionReason
  growth: GrowthRate | null
  /** 还需要的月数（null 表示无法给出） */
  monthsNeeded: number | null
  /** 预计达成月份（null 表示无法给出） */
  etaMonth: string | null
}

/**
 * 用最近 windowSize 个有数据的月份推算平均月增速。
 *
 * 关键点：分母是「自然月跨度」而不是「记录条数」。
 * 中间漏记 3 个月时，同样的净资产变化要摊到更长的时间里，
 * 否则会高估增速——这正是「近 12 条」而非「近 12 月」的老毛病。
 */
export function computeGrowthRate(
  points: NetWorthPoint[],
  windowSize = 12,
): GrowthRate | null {
  if (points.length < 2) return null
  const sorted = [...points].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  const window = sorted.slice(-Math.max(2, windowSize))
  const first = window[0]
  const last = window[window.length - 1]
  const spanMonths = monthDiff(first.month, last.month)
  if (spanMonths <= 0) return null

  const netGain = last.networth.sub(first.networth)
  return {
    windowStart: first.month,
    windowEnd: last.month,
    spanMonths,
    dataPoints: window.length,
    netGain,
    monthlyRate: netGain.div(spanMonths),
  }
}

/**
 * 按当前增速预测净资产目标何时达成。
 *
 * @param points  历史净资产序列（每月一个点）
 * @param remaining  距离目标还差多少（为负表示已达成）
 */
export function projectGoal(
  points: NetWorthPoint[],
  remaining: Decimal,
  windowSize = 12,
): GoalProjection {
  const growth = computeGrowthRate(points, windowSize)
  if (!growth) return { reason: 'insufficient_data', growth: null, monthsNeeded: null, etaMonth: null }
  // 增速为 0 或负：目标不可达（除非已经达成）
  if (growth.monthlyRate.lte(0)) {
    return { reason: 'no_growth', growth, monthsNeeded: null, etaMonth: null }
  }
  const monthsNeeded = remaining.div(growth.monthlyRate).ceil().toNumber()
  if (!Number.isFinite(monthsNeeded) || monthsNeeded > MAX_MONTHS) {
    return { reason: 'too_far', growth, monthsNeeded: null, etaMonth: null }
  }
  return {
    reason: 'ok',
    growth,
    monthsNeeded: Math.max(monthsNeeded, 0),
    etaMonth: addMonths(growth.windowEnd, Math.max(monthsNeeded, 0)),
  }
}
