import { format, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale/zh-CN'
import { enUS } from 'date-fns/locale/en-US'
import { getCurrentLang } from '@/lib/i18n-locale'

export function currentMonth(): string {
  return format(new Date(), 'yyyy-MM')
}

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return format(d, 'yyyy-MM')
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 1)
  return format(d, 'yyyy-MM')
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return format(d, 'yyyy-MM')
}

/** [start, end] 闭区间内的连续自然月（含无数据的月份）。 */
export function monthRange(start: string, end: string): string[] {
  const out: string[] = []
  if (start > end) return out
  let cur = start
  while (cur <= end) {
    out.push(cur)
    cur = nextMonth(cur)
  }
  return out
}

/**
 * 在相邻月份之间检测断档（> 1 个月间隔），在断档处插入一个占位月份，
 * 用于让折线图在断档处断开（占位月份的数值传 null）。
 * 占位月份本身不在 hasData 集合里。
 */
export function breakMonthGaps(months: string[]): string[] {
  if (months.length < 2) return months
  const out: string[] = [months[0]]
  for (let i = 1; i < months.length; i++) {
    const expected = nextMonth(months[i - 1])
    if (months[i] !== expected) out.push(expected)
    out.push(months[i])
  }
  return out
}

/** end - start，以自然月为单位（可为负）。 */
export function monthDiff(start: string, end: string): number {
  const [ys, ms] = start.split('-').map(Number)
  const [ye, me] = end.split('-').map(Number)
  return (ye - ys) * 12 + (me - ms)
}

/**
 * 在 [start, end] 区间内返回「没有任何记录」的月份。
 * start/end 省略时取 monthsWithData 的首尾月。
 * 用于给断档月提供补录入口。
 */
export function missingMonths(monthsWithData: string[], start?: string, end?: string): string[] {
  if (monthsWithData.length === 0) return []
  const sorted = [...monthsWithData].sort()
  const from = start ?? sorted[0]
  const to = end ?? sorted[sorted.length - 1]
  if (to < from) return []
  const has = new Set(sorted)
  return monthRange(from, to).filter((m) => !has.has(m))
}

export function formatMonth(month: string): string {
  const isEn = getCurrentLang() === 'en'
  return format(parseISO(`${month}-01`), isEn ? 'MMM yyyy' : 'yyyy年M月', { locale: isEn ? enUS : zhCN })
}

export function formatMonthShort(month: string): string {
  const isEn = getCurrentLang() === 'en'
  return format(parseISO(`${month}-01`), isEn ? 'MMM' : 'M月', { locale: isEn ? enUS : zhCN })
}

export function monthLabel(month: string): string {
  return format(parseISO(`${month}-01`), 'yyyy-MM')
}

export function isCurrentOrFuture(month: string): boolean {
  return month >= currentMonth()
}
