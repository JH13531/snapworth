import { describe, it, expect } from 'vitest'
import { recentCalendarMonths, allMonths } from '../money'
import { addMonths, monthRange, prevMonth, nextMonth, breakMonthGaps } from '../date'
import type { Snapshot } from '@/types'

function snap(month: string): Snapshot {
  return { id: `s-${month}`, account_id: 'a', month, balance: '100', created_at: '', updated_at: '' }
}

describe('recentCalendarMonths', () => {
  it('returns continuous calendar months, not just the last N records', () => {
    // 缺 2026-03 与 2026-06：slice(-6) 会跨到 2025-10，实际跨度 8 个月
    const months = ['2025-10', '2026-01', '2026-02', '2026-04', '2026-05', '2026-07']
    const result = recentCalendarMonths(months, 6)
    expect(result).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])
  })

  it('ends at the latest month that has data', () => {
    const months = ['2025-01', '2025-03', '2025-05']
    expect(recentCalendarMonths(months, 12)).toEqual([
      '2025-01', '2025-02', '2025-03', '2025-04', '2025-05',
    ])
  })

  it('does not pad empty months before the first record', () => {
    const months = ['2026-07', '2026-08']
    expect(recentCalendarMonths(months, 12)).toEqual(['2026-07', '2026-08'])
  })

  it('handles year boundaries', () => {
    const months = ['2025-11', '2026-01']
    expect(recentCalendarMonths(months, 3)).toEqual(['2025-11', '2025-12', '2026-01'])
  })

  it('returns empty when there is no data', () => {
    expect(recentCalendarMonths([], 12)).toEqual([])
  })

  it('derives months from snapshots', () => {
    const snapshots = [snap('2026-08'), snap('2026-06'), snap('2026-08')]
    expect(allMonths(snapshots)).toEqual(['2026-06', '2026-08'])
    expect(recentCalendarMonths(allMonths(snapshots), 3)).toEqual(['2026-06', '2026-07', '2026-08'])
  })
})

describe('month arithmetic', () => {
  it('adds and subtracts months across years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-09', -11)).toBe('2025-10')
  })

  it('agrees with prevMonth/nextMonth', () => {
    expect(addMonths('2026-03', -1)).toBe(prevMonth('2026-03'))
    expect(addMonths('2026-03', 1)).toBe(nextMonth('2026-03'))
  })

  it('builds inclusive ranges and guards reversed input', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthRange('2026-02', '2026-01')).toEqual([])
  })
})

describe('breakMonthGaps', () => {
  it('returns input unchanged when months are consecutive', () => {
    expect(breakMonthGaps(['2026-01', '2026-02', '2026-03'])).toEqual([
      '2026-01', '2026-02', '2026-03',
    ])
  })

  it('inserts a placeholder month at year boundaries (Dec → Jan) is NOT a gap', () => {
    expect(breakMonthGaps(['2025-12', '2026-01'])).toEqual(['2025-12', '2026-01'])
  })

  it('inserts the missing month when there is a 1-month gap', () => {
    expect(breakMonthGaps(['2026-01', '2026-03'])).toEqual([
      '2026-01', '2026-02', '2026-03',
    ])
  })

  it('inserts only the immediate next month for a long gap (one break point is enough to sever the line)', () => {
    // 2025-07 → 2026-09：在 2025-07 之后插入 2025-08 作为断点
    expect(breakMonthGaps(['2025-07', '2026-09'])).toEqual([
      '2025-07', '2025-08', '2026-09',
    ])
  })

  it('handles multiple gaps by inserting one placeholder at each', () => {
    // 2025-01 → 2025-03：插入 2025-02
    // 2025-03 → 2025-04：连续，无插入
    // 2025-04 → 2025-07：插入 2025-05（2 个月断档只插一个占位即可断开折线）
    expect(breakMonthGaps(['2025-01', '2025-03', '2025-04', '2025-07'])).toEqual([
      '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-07',
    ])
  })

  it('passes through empty / single-element input', () => {
    expect(breakMonthGaps([])).toEqual([])
    expect(breakMonthGaps(['2026-05'])).toEqual(['2026-05'])
  })
})
