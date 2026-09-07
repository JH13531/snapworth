import { describe, it, expect } from 'vitest'
import { subAccountIcon, subAccountColor, type SubAccount } from '../index'

function makeSub(over: Partial<SubAccount>): SubAccount {
  return {
    id: 's1',
    account_id: 'a1',
    name: '',
    type: 'asset',
    category: 'cash',
    currency: 'CNY',
    include_in_networth: true,
    archived: false,
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

describe('subAccountIcon', () => {
  it('prefers the sub-account own icon', () => {
    expect(subAccountIcon(makeSub({ icon: 'gem' }))).toBe('gem')
  })

  it('falls back to category icon when no own icon set', () => {
    expect(subAccountIcon(makeSub({ category: 'cash' }))).toBe('wallet')
    expect(subAccountIcon(makeSub({ category: 'investment' }))).toBe('trending-up')
  })
})

describe('subAccountColor', () => {
  it('prefers the sub-account own color', () => {
    expect(subAccountColor(makeSub({ color: '#123456' }), '#000')).toBe('#123456')
  })

  it('liability falls back to red even without an own color', () => {
    expect(subAccountColor(makeSub({ type: 'liability', category: 'credit_card' }), '#000')).toBe('#ef4444')
  })

  it('asset without own color falls back to the parent account color', () => {
    expect(subAccountColor(makeSub({ type: 'asset', category: 'cash' }), '#3b82f6')).toBe('#3b82f6')
  })

  it('asset with neither own color nor account color falls back to default blue', () => {
    expect(subAccountColor(makeSub({ type: 'asset', category: 'cash' }))).toBe('#3b82f6')
  })
})
