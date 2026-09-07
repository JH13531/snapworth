// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { Account, Snapshot, SubAccount } from '@/types'

// backup.ts 在模块加载时会实例化 Dexie，node 环境没有 IndexedDB，mock 掉。
// 本测试只覆盖纯函数 backfillSubAccounts。
vi.mock('@/db', () => ({
  db: {},
  uuid: (() => {
    let n = 0
    return () => `gen-${++n}`
  })(),
}))

import { backfillSubAccounts } from '../backup'

function account(over: Partial<Account> & { id: string }): Account {
  return {
    name: over.id,
    icon: 'wallet',
    color: '#6366f1',
    type: 'asset',
    category: 'cash',
    currency: 'CNY',
    include_in_networth: true,
    archived: false,
    hidden: false,
    sort_order: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...over,
  } as Account
}

function snapshot(over: Partial<Snapshot> & { id: string; account_id: string }): Snapshot {
  return {
    month: '2025-01',
    balance: '100',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...over,
  } as Snapshot
}

describe('backfillSubAccounts', () => {
  it('为没有子账户的账户生成一个，并接管其缺少关联的快照', () => {
    const accounts = [account({ id: 'a1' })]
    const snapshots = [
      snapshot({ id: 's1', account_id: 'a1', month: '2025-01' }),
      snapshot({ id: 's2', account_id: 'a1', month: '2025-02' }),
    ]

    const { subAccounts, snapshots: out } = backfillSubAccounts(accounts, snapshots)

    expect(subAccounts).toHaveLength(1)
    const sub = subAccounts[0]
    expect(sub.account_id).toBe('a1')
    expect(sub.type).toBe('asset')
    expect(sub.category).toBe('cash')
    expect(sub.currency).toBe('CNY')
    expect(sub.sort_order).toBe(0)

    // 快照被回填到新生成的子账户上，否则汇总会漏掉它们
    expect(out.map((s) => s.sub_account_id)).toEqual([sub.id, sub.id])
    // 原数组不被就地修改
    expect(snapshots.every((s) => s.sub_account_id === undefined)).toBe(true)
  })

  it('优先复用快照中已有的 sub_account_id，不切断关联', () => {
    const accounts = [account({ id: 'a1' })]
    const snapshots = [
      snapshot({ id: 's1', account_id: 'a1', sub_account_id: 'existing-1' }),
      snapshot({ id: 's2', account_id: 'a1', sub_account_id: 'existing-2' }),
      snapshot({ id: 's3', account_id: 'a1' }),
    ]

    const { subAccounts, snapshots: out } = backfillSubAccounts(accounts, snapshots)

    expect(subAccounts.map((s) => s.id).sort()).toEqual(['existing-1', 'existing-2'])
    // 已有 ID 的第一个作为主子账户，接管无关联的 s3
    expect(out.find((s) => s.id === 's1')!.sub_account_id).toBe('existing-1')
    expect(out.find((s) => s.id === 's2')!.sub_account_id).toBe('existing-2')
    expect(out.find((s) => s.id === 's3')!.sub_account_id).toBe('existing-1')
  })

  it('已有子账户的账户被跳过，不生成重复数据', () => {
    const accounts = [account({ id: 'a1' }), account({ id: 'a2' })]
    const existing: SubAccount[] = [
      { id: 'sub-a1', account_id: 'a1', name: '主账户' } as SubAccount,
    ]

    const { subAccounts } = backfillSubAccounts(accounts, [], existing)

    expect(subAccounts.map((s) => s.account_id)).toEqual(['a2'])
  })

  it('账户与快照都为空时返回空结果', () => {
    const { subAccounts, snapshots } = backfillSubAccounts([], [])
    expect(subAccounts).toEqual([])
    expect(snapshots).toEqual([])
  })

  it('负债账户继承 type 与 include_in_networth', () => {
    const accounts = [
      account({ id: 'a1', type: 'liability', category: 'mortgage', include_in_networth: true }),
    ]

    const { subAccounts } = backfillSubAccounts(accounts, [])

    expect(subAccounts[0].type).toBe('liability')
    expect(subAccounts[0].category).toBe('mortgage')
    expect(subAccounts[0].include_in_networth).toBe(true)
  })
})
