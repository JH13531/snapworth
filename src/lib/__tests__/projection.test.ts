import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { computeGrowthRate, projectGoal, MAX_MONTHS, type NetWorthPoint } from '../projection'

function series(pairs: [string, number][]): NetWorthPoint[] {
  return pairs.map(([month, v]) => ({ month, networth: new Decimal(v) }))
}

describe('computeGrowthRate', () => {
  it('数据不足两个月时返回 null', () => {
    expect(computeGrowthRate(series([['2026-01', 100]]))).toBeNull()
    expect(computeGrowthRate([])).toBeNull()
  })

  it('只取最近 windowSize 个月', () => {
    // 24 个月数据，窗口 12 → 起点应是第 13 个月
    const pairs: [string, number][] = []
    for (let i = 0; i < 24; i++) {
      const m = `2025-${String((i % 12) + 1).padStart(2, '0')}`
      pairs.push([i < 12 ? m : `2026-${String((i % 12) + 1).padStart(2, '0')}`, i * 100])
    }
    const g = computeGrowthRate(series(pairs), 12)!
    expect(g.windowEnd).toBe('2026-12')
    expect(g.windowStart).toBe('2026-01')
    expect(g.dataPoints).toBe(12)
  })

  it('分母是自然月跨度，不是记录条数', () => {
    // 3 条记录：1月 0 → 3月 300，中间 2 月漏记
    // 正确：净增 300 / 跨度 2 月 = 150/月（不是 300/2 条 = 150… 这里特意让两者不同）
    const g = computeGrowthRate(series([['2026-01', 0], ['2026-03', 300]]), 12)!
    expect(g.spanMonths).toBe(2)
    expect(g.dataPoints).toBe(2)
    expect(g.monthlyRate.toNumber()).toBe(150)
  })

  it('跨年断档也按自然月算', () => {
    const g = computeGrowthRate(series([['2025-11', 1000], ['2026-02', 1600]]), 12)!
    expect(g.spanMonths).toBe(3)
    expect(g.netGain.toNumber()).toBe(600)
    expect(g.monthlyRate.toNumber()).toBe(200)
  })

  it('净资产下降时增速为负', () => {
    const g = computeGrowthRate(series([['2026-01', 500], ['2026-06', 200]]), 12)!
    expect(g.monthlyRate.toNumber()).toBe(-60)
  })
})

describe('projectGoal', () => {
  it('按平均月增速推算达成月份', () => {
    // 2026-01: 0 → 2026-07: 600，跨度 6 月 → 100/月
    const p = projectGoal(series([['2026-01', 0], ['2026-07', 600]]), new Decimal(300), 12)
    expect(p.reason).toBe('ok')
    expect(p.monthsNeeded).toBe(3)
    expect(p.etaMonth).toBe('2026-10')
  })

  it('不足整月时向上取整', () => {
    // 100/月，还差 250 → 3 个月
    const p = projectGoal(series([['2026-01', 0], ['2026-07', 600]]), new Decimal(250), 12)
    expect(p.monthsNeeded).toBe(3)
  })

  it('数据不足两个月时不给预测', () => {
    const p = projectGoal(series([['2026-01', 100]]), new Decimal(500), 12)
    expect(p.reason).toBe('insufficient_data')
    expect(p.etaMonth).toBeNull()
  })

  it('零增长时不给预测', () => {
    const p = projectGoal(series([['2026-01', 100], ['2026-06', 100]]), new Decimal(500), 12)
    expect(p.reason).toBe('no_growth')
    expect(p.growth).not.toBeNull()
    expect(p.etaMonth).toBeNull()
  })

  it('负增长时不给预测', () => {
    const p = projectGoal(series([['2026-01', 500], ['2026-06', 200]]), new Decimal(500), 12)
    expect(p.reason).toBe('no_growth')
  })

  it('超过 50 年时不给预测', () => {
    // 1/月，还差 MAX_MONTHS+1
    const p = projectGoal(
      series([['2026-01', 0], ['2026-02', 1]]),
      new Decimal(MAX_MONTHS + 1),
      12,
    )
    expect(p.reason).toBe('too_far')
    expect(p.etaMonth).toBeNull()
  })

  it('恰好 600 个月仍给预测', () => {
    const p = projectGoal(series([['2026-01', 0], ['2026-02', 1]]), new Decimal(MAX_MONTHS), 12)
    expect(p.reason).toBe('ok')
    expect(p.monthsNeeded).toBe(MAX_MONTHS)
  })

  it('已达成（remaining 为 0）时预计月份就是窗口终点', () => {
    const p = projectGoal(series([['2026-01', 0], ['2026-07', 600]]), new Decimal(0), 12)
    expect(p.reason).toBe('ok')
    expect(p.monthsNeeded).toBe(0)
    expect(p.etaMonth).toBe('2026-07')
  })
})
