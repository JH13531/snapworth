import { describe, it, expect } from 'vitest'
import { summarizeMonth, rateFor, pctChange, formatMoney, snapCurrency, nearestPriorMonth, latestSnapshotByAccount, summarizeAccountMonth } from '../money'
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
