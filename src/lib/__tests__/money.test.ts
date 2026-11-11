import { describe, it, expect } from 'vitest'
import { summarizeMonth, rateFor, pctChange, formatMoney, snapCurrency, nearestPriorMonth, latestSnapshotByAccount, summarizeAccountMonth, buildSnapshotMap, summarizeMonthByCategory, summarizeMonthByCategoryAndAccount, accountNetChanges } from '../money'
import type { Account, Snapshot, ExchangeRate, SubAccount } from '@/types'
import Decimal from 'decimal.js'

function makeAccount(over: Partial<Account>): Account {
  return {
    id: 'a', name: 'Test', icon: 'wallet', color: '#000', type: 'asset',
    category: 'cash', currency: 'CNY', include_in_networth: true,
    hidden: false, archived: false, sort_order: 0,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
  }
}

function makeSnap(over: Partial<Snapshot>): Snapshot {
  return {
    id: 's', account_id: 'a', month: '2026-08', balance: '1000',
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', ...over,
  }
}

describe('summarizeMonth', () => {
  it('calculates net worth as assets minus liabilities', () => {
    const accounts = [
      makeAccount({ id: 'a1', type: 'asset' }),
      makeAccount({ id: 'a2', type: 'liability' }),
    ]
    const snapshots = [
      makeSnap({ id: 's1', account_id: 'a1', balance: '10000' }),
      makeSnap({ id: 's2', account_id: 'a2', balance: '3000' }),
    ]
    const result = summarizeMonth(accounts, snapshots, [], '2026-08', 'CNY')
    expect(result.assets.toNumber()).toBe(10000)
    expect(result.liabilities.toNumber()).toBe(3000)
    expect(result.networth.toNumber()).toBe(7000)
  })

  it('converts foreign currency with rate', () => {
    const accounts = [makeAccount({ id: 'a1', currency: 'USD' })]
    const snapshots = [makeSnap({ id: 's1', account_id: 'a1', balance: '100' })]
    const rates: ExchangeRate[] = [{
      month: '2026-08', currency: 'USD', rate_to_base: '7.15',
      created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    }]
    const result = summarizeMonth(accounts, snapshots, rates, '2026-08', 'CNY')
    expect(result.networth.toNumber()).toBe(715)
  })

  it('falls back to prior month rate', () => {
    const r = rateFor(
      [{ month: '2026-07', currency: 'USD', rate_to_base: '7.0', created_at: '', updated_at: '' }],
      'USD', '2026-08', 'CNY',
    )
    expect(r?.toNumber()).toBe(7)
  })

  it('returns null when no rate exists at all instead of 1:1', () => {
    const r = rateFor([], 'USD', '2026-08', 'CNY')
    expect(r).toBeNull()
  })

  it('excludes archived accounts', () => {
    const accounts = [makeAccount({ id: 'a1', archived: true })]
    const snapshots = [makeSnap({ id: 's1' })]
    const result = summarizeMonth(accounts, snapshots, [], '2026-08', 'CNY')
    expect(result.networth.toNumber()).toBe(0)
  })

  it('uses the currency frozen on the snapshot, not the current account currency', () => {
    const accounts = [makeAccount({ id: 'a1', currency: 'CNY' })]
    const snapshots = [makeSnap({ id: 's1', account_id: 'a1', balance: '100', currency: 'USD' })]
    const rates: ExchangeRate[] = [{
      month: '2026-08', currency: 'USD', rate_to_base: '7.0',
      created_at: '', updated_at: '',
    }]
    const result = summarizeMonth(accounts, snapshots, rates, '2026-08', 'CNY')
    expect(result.networth.toNumber()).toBe(700)
  })
})


  it('does NOT fall back to account-level snapshot when sub-accounts exist', () => {
    const accounts = [makeAccount({ id: 'a1', type: 'asset' })]
    const subAccounts: SubAccount[] = [
      {
        id: 's1', account_id: 'a1', name: '', type: 'asset', category: 'cash',
        currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0,
        created_at: '', updated_at: '',
      },
      {
        id: 's2', account_id: 'a1', name: '', type: 'asset', category: 'cash',
        currency: 'CNY', include_in_networth: true, archived: false, sort_order: 1,
        created_at: '', updated_at: '',
      },
    ]
    // Only account-level snapshot exists (no sub_account_id)
    const snapshots = [
      makeSnap({ id: 'snap1', account_id: 'a1', balance: '10000' }),
    ]
    const result = summarizeMonth(accounts, snapshots, [], '2026-08', 'CNY', subAccounts)
    // New sub-accounts without their own snapshots should NOT inherit account-level balance
    expect(result.networth.toNumber()).toBe(0)
  })

  it('uses sub-account level snapshots when available', () => {
    const accounts = [makeAccount({ id: 'a1', type: 'asset' })]
    const subAccounts: SubAccount[] = [
      {
        id: 's1', account_id: 'a1', name: '', type: 'asset', category: 'cash',
        currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0,
        created_at: '', updated_at: '',
      },
    ]
    const snapshots = [
      makeSnap({ id: 'snap1', account_id: 'a1', sub_account_id: 's1', balance: '5000' }),
    ]
    const result = summarizeMonth(accounts, snapshots, [], '2026-08', 'CNY', subAccounts)
    expect(result.networth.toNumber()).toBe(5000)
  })

describe('snapCurrency', () => {
  it('prefers snapshot currency and falls back to account currency', () => {
    const acc = makeAccount({ currency: 'CNY' })
    expect(snapCurrency(makeSnap({ currency: 'USD' }), acc)).toBe('USD')
    expect(snapCurrency(makeSnap({}), acc)).toBe('CNY')
  })
})

describe('nearestPriorMonth', () => {
  it('returns the most recent month before the given one', () => {
    const snaps = [
      makeSnap({ id: '1', month: '2026-01' }),
      makeSnap({ id: '2', month: '2026-03' }),
      makeSnap({ id: '3', month: '2026-02' }),
    ]
    expect(nearestPriorMonth(snaps, '2026-03')).toBe('2026-02')
    expect(nearestPriorMonth(snaps, '2026-06')).toBe('2026-03')
  })

  it('skips the current month and returns null when nothing before', () => {
    expect(nearestPriorMonth([makeSnap({ month: '2026-08' })], '2026-08')).toBeNull()
    expect(nearestPriorMonth([], '2026-08')).toBeNull()
  })
})

describe('latestSnapshotByAccount', () => {
  it('returns the most recent snapshot per account strictly before the month', () => {
    const snaps = [
      makeSnap({ id: '1', account_id: 'a', month: '2026-01', balance: '1' }),
      makeSnap({ id: '2', account_id: 'a', month: '2026-03', balance: '3' }),
      makeSnap({ id: '3', account_id: 'b', month: '2026-02', balance: '2' }),
    ]
    const map = latestSnapshotByAccount(snaps, '2026-03')
    expect(map.get('a')?.balance).toBe('1')
    expect(map.get('b')?.balance).toBe('2')
  })
})

describe('pctChange', () => {
  it('returns null when previous is zero', () => {
    expect(pctChange(new Decimal(100), new Decimal(0))).toBeNull()
  })
  it('calculates percentage', () => {
    const r = pctChange(new Decimal(110), new Decimal(100))
    expect(r?.toNumber()).toBe(10)
  })
})

describe('formatMoney', () => {
  it('masks when hide is true', () => {
    expect(formatMoney('1000', 'CNY', true)).toBe('****')
  })
  it('formats with currency symbol', () => {
    expect(formatMoney('1000', 'CNY')).toBe('¥1,000.00')
  })
  it('负数把负号放在货币符号之前', () => {
    expect(formatMoney('-3000', 'CNY')).toBe('-¥3,000.00')
  })
})

describe('summarizeAccountMonth', () => {
  it('aggregates an account across its sub-accounts and converts to base', () => {
    const account = makeAccount({ id: 'a1', currency: 'CNY' })
    const subs: SubAccount[] = [
      { id: 's1', account_id: 'a1', name: '活期', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
      { id: 's2', account_id: 'a1', name: '美元户', type: 'asset', category: 'cash', currency: 'USD', include_in_networth: true, archived: false, sort_order: 1, created_at: '', updated_at: '' },
    ]
    const snapshots: Snapshot[] = [
      makeSnap({ id: 's1', account_id: 'a1', sub_account_id: 's1', month: '2026-08', balance: '1000', currency: 'CNY' }),
      makeSnap({ id: 's2', account_id: 'a1', sub_account_id: 's2', month: '2026-08', balance: '100', currency: 'USD' }),
    ]
    const rates: ExchangeRate[] = [{ currency: 'USD', month: '2026-08', rate_to_base: '7', created_at: '', updated_at: '' }]
    const total = summarizeAccountMonth(account, subs, snapshots, rates, '2026-08', 'CNY')
    // 1000 CNY + 100 USD * 7 = 1700
    expect(total.toNumber()).toBe(1700)
  })

  it('returns zero for months without snapshots', () => {
    const account = makeAccount({ id: 'a1' })
    const total = summarizeAccountMonth(account, [], [], [], '2026-08', 'CNY')
    expect(total.toNumber()).toBe(0)
  })
})

describe('buildSnapshotMap 主账户键聚合', () => {
  it('主账户键 = 各子账户快照之和（同币种），而非最后一个子账户', () => {
    const snapshots = [
      makeSnap({ id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '100.10', currency: 'CNY' }),
      makeSnap({ id: 'n2', account_id: 'a1', sub_account_id: 's2', month: '2026-09', balance: '200.20', currency: 'CNY' }),
    ]
    const map = buildSnapshotMap(snapshots)
    const agg = map.get('a1|2026-09')
    expect(agg?.balance).toBe('300.3')
    expect(agg?.currency).toBe('CNY')
    expect(agg?.sub_account_id).toBeUndefined()
    // 子账户键不受影响
    expect(map.get('a1|2026-09|s1')?.balance).toBe('100.10')
    expect(map.get('a1|2026-09|s2')?.balance).toBe('200.20')
  })

  it('支持负数（如信用卡溢缴款）参与求和', () => {
    const snapshots = [
      makeSnap({ id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '-500', currency: 'CNY' }),
      makeSnap({ id: 'n2', account_id: 'a1', sub_account_id: 's2', month: '2026-09', balance: '200', currency: 'CNY' }),
    ]
    const map = buildSnapshotMap(snapshots)
    expect(map.get('a1|2026-09')?.balance).toBe('-300')
  })

  it('混合币种不生成主账户聚合键（直接相加会失去意义）', () => {
    const snapshots = [
      makeSnap({ id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '1000', currency: 'CNY' }),
      makeSnap({ id: 'n2', account_id: 'a1', sub_account_id: 's2', month: '2026-09', balance: '100', currency: 'USD' }),
    ]
    const map = buildSnapshotMap(snapshots)
    expect(map.has('a1|2026-09')).toBe(false)
  })

  it('旧格式快照（无 sub_account_id）仍直接作为主账户键', () => {
    const snapshots = [
      makeSnap({ id: 'n1', account_id: 'a1', month: '2026-08', balance: '1000', currency: 'CNY' }),
    ]
    const map = buildSnapshotMap(snapshots)
    expect(map.get('a1|2026-08')?.balance).toBe('1000')
  })

  it('同月既有旧格式又有子账户快照时，以子账户聚合为准', () => {
    const snapshots = [
      makeSnap({ id: 'n0', account_id: 'a1', month: '2026-09', balance: '9999', currency: 'CNY' }),
      makeSnap({ id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '100', currency: 'CNY' }),
      makeSnap({ id: 'n2', account_id: 'a1', sub_account_id: 's2', month: '2026-09', balance: '200', currency: 'CNY' }),
    ]
    const map = buildSnapshotMap(snapshots)
    expect(map.get('a1|2026-09')?.balance).toBe('300')
  })
})

describe('summarizeMonthByCategoryAndAccount', () => {
  const subs: SubAccount[] = [
    { id: 's1', account_id: 'a1', name: '活期', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 's2', account_id: 'a2', name: '美股', type: 'asset', category: 'investment', currency: 'USD', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    // 同一分类下的第二个账户，用于验证按账户拆分
    { id: 's3', account_id: 'a3', name: '基金', type: 'asset', category: 'investment', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 's4', account_id: 'a4', name: '信用卡', type: 'liability', category: 'credit_card', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
  ]
  const accounts = [
    makeAccount({ id: 'a1' }),
    makeAccount({ id: 'a2', currency: 'USD', category: 'investment' }),
    makeAccount({ id: 'a3', category: 'investment' }),
    makeAccount({ id: 'a4', type: 'liability', category: 'credit_card' }),
  ]
  const rates: ExchangeRate[] = [{
    month: '2026-08', currency: 'USD', rate_to_base: '7',
    created_at: '', updated_at: '',
  }]
  const snapshots = [
    makeSnap({ id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-08', balance: '1000', currency: 'CNY' }),
    makeSnap({ id: 'n2', account_id: 'a2', sub_account_id: 's2', month: '2026-08', balance: '100', currency: 'USD' }),
    makeSnap({ id: 'n3', account_id: 'a3', sub_account_id: 's3', month: '2026-08', balance: '200', currency: 'CNY' }),
    makeSnap({ id: 'n4', account_id: 'a4', sub_account_id: 's4', month: '2026-08', balance: '500', currency: 'CNY' }),
  ]

  it('账户级明细之和等于分类级汇总（同一口径，可加总核对）', () => {
    const nested = summarizeMonthByCategoryAndAccount(accounts, snapshots, rates, '2026-08', 'CNY', 'asset', subs)
    const flat = summarizeMonthByCategory(accounts, snapshots, rates, '2026-08', 'CNY', 'asset', subs)

    expect([...flat.keys()].sort()).toEqual([...nested.keys()].sort())
    for (const [cat, byAccount] of nested) {
      let sum = new Decimal(0)
      for (const v of byAccount.values()) sum = sum.add(v)
      expect(sum.toNumber()).toBe(flat.get(cat)!.toNumber())
    }
    // 外币按当月汇率折算，人民币账户原样
    expect(nested.get('investment')?.get('a2')?.toNumber()).toBe(700)
    expect(nested.get('investment')?.get('a3')?.toNumber()).toBe(200)
  })

  it('分类合计相减等于净资产变化', () => {
    const assetNested = summarizeMonthByCategoryAndAccount(accounts, snapshots, rates, '2026-08', 'CNY', 'asset', subs)
    const liabNested = summarizeMonthByCategoryAndAccount(accounts, snapshots, rates, '2026-08', 'CNY', 'liability', subs)
    let assetSum = new Decimal(0)
    let liabSum = new Decimal(0)
    for (const m of assetNested.values()) for (const v of m.values()) assetSum = assetSum.add(v)
    for (const m of liabNested.values()) for (const v of m.values()) liabSum = liabSum.add(v)
    expect(assetSum.sub(liabSum).toNumber()).toBe(1400)
  })
})

describe('accountNetChanges', () => {
  const accounts2 = [
    makeAccount({ id: 'a1', category: 'cash' }),
    makeAccount({ id: 'a2', category: 'investment' }),
    makeAccount({ id: 'a3', type: 'liability', category: 'mortgage' }),
  ]
  const subs2: SubAccount[] = [
    { id: 's1', account_id: 'a1', name: '', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 's2', account_id: 'a2', name: '', type: 'asset', category: 'investment', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 's3', account_id: 'a3', name: '', type: 'liability', category: 'mortgage', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
  ]
  // 现金 +500、投资 +600、房贷余额 −100（对净资产 +100）→ 合计 +1200
  const breaks: Snapshot[] = [
    makeSnap({ id: 'b1', account_id: 'a1', sub_account_id: 's1', month: '2026-08', balance: '1000' }),
    makeSnap({ id: 'b2', account_id: 'a2', sub_account_id: 's2', month: '2026-08', balance: '2000' }),
    makeSnap({ id: 'b3', account_id: 'a3', sub_account_id: 's3', month: '2026-08', balance: '500' }),
    makeSnap({ id: 'b4', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '1500' }),
    makeSnap({ id: 'b5', account_id: 'a2', sub_account_id: 's2', month: '2026-09', balance: '2600' }),
    makeSnap({ id: 'b6', account_id: 'a3', sub_account_id: 's3', month: '2026-09', balance: '400' }),
  ]

  it('各账户贡献之和等于净资产变化（可加总核对）', () => {
    const map = accountNetChanges(accounts2, subs2, breaks, [], '2026-09', '2026-08', 'CNY')
    expect(map.get('a1')?.toNumber()).toBe(500)
    expect(map.get('a2')?.toNumber()).toBe(600)
    expect(map.get('a3')?.toNumber()).toBe(100)

    let sum = new Decimal(0)
    for (const v of map.values()) sum = sum.add(v)
    const delta = summarizeMonth(accounts2, breaks, [], '2026-09', 'CNY', subs2)
      .networth.sub(summarizeMonth(accounts2, breaks, [], '2026-08', 'CNY', subs2).networth)
    expect(sum.toNumber()).toBe(delta.toNumber())
  })

  it('传 category 时只统计该分类下的子账户', () => {
    const map = accountNetChanges(accounts2, subs2, breaks, [], '2026-09', '2026-08', 'CNY', 'investment')
    expect([...map.keys()]).toEqual(['a2'])
    expect(map.get('a2')?.toNumber()).toBe(600)
  })
})
