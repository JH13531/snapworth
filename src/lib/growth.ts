import Decimal from 'decimal.js'
import { monthDiff } from '@/lib/date'

/**
 * 年化增速（CAGR, Compound Annual Growth Rate）计算。
 *
 * CAGR = (end / start)^(1/years) - 1，其中 years = 月份跨度 / 12。
 * 这是「几何平均」口径，比把月度平均简单乘 12 更严谨——它能正确反映
 * 复利效应，也不会被中间的剧烈波动带偏。
 *
 * 全部是纯函数，方便单测覆盖各种边界（负值、零跨度、正负穿越等）。
 */

export type CagrReason = 'ok' | 'invalid_base' | 'zero_span' | 'sign_flip'

export interface CagrResult {
  /** 年化小数速率，如 0.1234 = 12.34%；无法计算时为 null */
  rate: number | null
  reason: CagrReason
  /** 跨度折算的年数（months / 12） */
  years: number
}

/**
 * 计算从 start 到 end、跨 months 个自然月的年化增速。
 *
 * 边界处理（净资产可能为负或为零，不能套用普通比率公式）：
 * - months <= 0：跨度非法，返回 zero_span
 * - start <= 0：基数非正，ratio 无意义，返回 invalid_base
 * - end / start <= 0：股本由正转负或相反（穿越零轴），返回 sign_flip
 */
export function calcCAGR(start: Decimal, end: Decimal, months: number): CagrResult {
  if (months <= 0) return { rate: null, reason: 'zero_span', years: 0 }
  const years = months / 12
  if (start.lte(0)) return { rate: null, reason: 'invalid_base', years }
  const ratio = end.div(start)
  if (ratio.lte(0)) return { rate: null, reason: 'sign_flip', years }
  const rate = Math.pow(ratio.toNumber(), 1 / years) - 1
  return { rate, reason: 'ok', years }
}

/** 把年化速率格式化为带符号的百分比字符串，如 +12.3% / -4.0%。 */
export function formatRate(rate: number, decimals = 1): string {
  const sign = rate >= 0 ? '+' : ''
  return `${sign}${(rate * 100).toFixed(decimals)}%`
}

/**
 * 把一串「月 → 净值」序列折算成全程年化增速（首个有数据的月 → 最后一个月）。
 * 序列不足 2 点或首月净值为非正时返回 null。
 */
export function overallCAGR(
  points: { month: string; networth: Decimal }[],
): { rate: number | null; reason: CagrReason; firstMonth: string; lastMonth: string; months: number } | null {
  if (points.length < 2) return null
  const sorted = [...points].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const months = monthDiff(first.month, last.month)
  const cagr = calcCAGR(first.networth, last.networth, months)
  return { rate: cagr.rate, reason: cagr.reason, firstMonth: first.month, lastMonth: last.month, months }
}
