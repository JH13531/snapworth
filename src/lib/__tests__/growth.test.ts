import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { calcCAGR, formatRate, overallCAGR } from '../growth'

describe('calcCAGR', () => {
  it('正常计算年化增速', () => {
    // 100 → 200，跨 12 个月 → 年化 100%
    const r = calcCAGR(new Decimal(100), new Decimal(200), 12)
    expect(r.reason).toBe('ok')
    expect(r.rate).toBeCloseTo(1.0, 5)
    expect(r.years).toBe(1)
  })

  it('跨 24 个月翻倍 → 年化约 41.4%', () => {
    // (200/100)^(1/2) - 1 ≈ 0.4142
    const r = calcCAGR(new Decimal(100), new Decimal(200), 24)
    expect(r.reason).toBe('ok')
    expect(r.rate!).toBeCloseTo(0.4142, 3)
  })

  it('零跨度返回 zero_span', () => {
    expect(calcCAGR(new Decimal(100), new Decimal(120), 0).reason).toBe('zero_span')
  })

  it('基数非正返回 invalid_base', () => {
    expect(calcCAGR(new Decimal(0), new Decimal(100), 12).reason).toBe('invalid_base')
    expect(calcCAGR(new Decimal(-50), new Decimal(100), 12).reason).toBe('invalid_base')
  })

  it('穿越零轴（正负翻转）返回 sign_flip', () => {
    // 100 → -100：基数为正，ratio 为负 → sign_flip
    expect(calcCAGR(new Decimal(100), new Decimal(-100), 12).reason).toBe('sign_flip')
    // -100 → 100：基线为负，ratio 无意义 → invalid_base（先于 sign_flip 判定）
    expect(calcCAGR(new Decimal(-100), new Decimal(100), 12).reason).toBe('invalid_base')
  })

  it('下跌时返回负速率', () => {
    const r = calcCAGR(new Decimal(200), new Decimal(100), 12)
    expect(r.reason).toBe('ok')
    expect(r.rate!).toBeCloseTo(-0.5, 5)
  })
})

describe('formatRate', () => {
  it('带符号百分比', () => {
    expect(formatRate(0.1234)).toBe('+12.3%')
    expect(formatRate(-0.04)).toBe('-4.0%')
    expect(formatRate(0)).toBe('+0.0%')
  })
})

describe('overallCAGR', () => {
  function series(pairs: [string, number][]): { month: string; networth: Decimal }[] {
    return pairs.map(([m, v]) => ({ month: m, networth: new Decimal(v) }))
  }

  it('不足两点返回 null', () => {
    expect(overallCAGR(series([['2026-01', 100]]))).toBeNull()
    expect(overallCAGR([])).toBeNull()
  })

  it('首月净额非正返回 invalid_base', () => {
    const r = overallCAGR(series([['2026-01', 0], ['2026-12', 100]]))!
    expect(r.reason).toBe('invalid_base')
    expect(r.rate).toBeNull()
  })

  it('全程翻倍 = 年化 100%', () => {
    // 2026-01 → 2027-01：跨 12 个月，翻倍 → 年化 100%
    const r = overallCAGR(series([['2026-01', 100], ['2027-01', 200]]))!
    expect(r.reason).toBe('ok')
    expect(r.rate!).toBeCloseTo(1.0, 5)
    expect(r.firstMonth).toBe('2026-01')
    expect(r.lastMonth).toBe('2027-01')
    expect(r.months).toBe(12)
  })
})
