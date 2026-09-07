// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/db'
import { applyImportData, restoreBackup, collectExportData } from '../backup'
import type { ExportData } from '../crypto'
import type { BackupRecord } from '@/types'

function blankData(over: Partial<ExportData> = {}): ExportData {
  return {
    schema_version: 1,
    settings: {
      id: 'singleton', base_currency: 'CNY', theme: 'system', privacy_mode: false,
      invert_change_color: false, book_name: '测试', schema_version: 1,
      onboarded: true, updated_at: '2025-01-01T00:00:00.000Z',
    },
    accounts: [],
    snapshots: [],
    exchange_rates: [],
    monthly_reviews: [],
    tombstones: [],
    ...over,
  } as ExportData
}

const iso = (s: string) => new Date(s).toISOString()

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear()
  })
})

describe('applyImportData', () => {
  it('overwrite 模式清空后写入，并兜底生成子账户', async () => {
    await db.accounts.add({
      id: 'stale', name: '遗留账户', icon: 'wallet', color: '#000', type: 'asset',
      category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
      hidden: false, sort_order: 0, created_at: iso('2024-01-01'), updated_at: iso('2024-01-01'),
    } as any)

    const data = blankData({
      accounts: [{
        id: 'a1', name: '招商银行', icon: 'wallet', color: '#000', type: 'asset',
        category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
        hidden: false, sort_order: 3, created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
      } as any],
      snapshots: [{
        id: 's1', account_id: 'a1', month: '2025-01', balance: '1000',
        created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
      } as any],
    })

    await applyImportData(data, 'overwrite')

    expect(await db.accounts.count()).toBe(1)
    expect(await db.accounts.get('stale')).toBeUndefined()

    const subs = await db.subAccounts.toArray()
    expect(subs).toHaveLength(1)
    expect(subs[0].account_id).toBe('a1')
    expect(subs[0].sort_order).toBe(0)

    // 快照的 sub_account_id 被回填，否则汇总时会被漏掉
    const snap = await db.snapshots.get('s1')
    expect(snap!.sub_account_id).toBe(subs[0].id)
  })

  it('merge 模式保留本地较新数据，采用备份中更新的排序', async () => {
    // 模拟设备 B：已有账户，排序 0，时间较早
    await db.accounts.add({
      id: 'a1', name: '旧名', icon: 'wallet', color: '#000', type: 'asset',
      category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
      hidden: false, sort_order: 0, created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
    } as any)
    // 本地独有的账户不应被删除
    await db.accounts.add({
      id: 'local-only', name: '本地独有', icon: 'wallet', color: '#000', type: 'asset',
      category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
      hidden: false, sort_order: 1, created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
    } as any)

    // 模拟设备 A 导出：拖拽排序后 sort_order=5 且 updated_at 被同步刷新
    const data = blankData({
      accounts: [{
        id: 'a1', name: '新名', icon: 'wallet', color: '#000', type: 'asset',
        category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
        hidden: false, sort_order: 5, created_at: iso('2025-01-01'), updated_at: iso('2025-06-01'),
      } as any],
    })

    await applyImportData(data, 'merge')

    const merged = await db.accounts.get('a1')
    expect(merged!.sort_order).toBe(5)   // 排序变更被采纳
    expect(merged!.name).toBe('新名')

    expect(await db.accounts.get('local-only')).toBeTruthy()  // 合并不丢本地数据
  })

  it('merge 模式下备份时间戳较旧时不覆盖本地排序', async () => {
    await db.accounts.add({
      id: 'a1', name: '本地最新', icon: 'wallet', color: '#000', type: 'asset',
      category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
      hidden: false, sort_order: 9, created_at: iso('2025-01-01'), updated_at: iso('2025-12-01'),
    } as any)

    const data = blankData({
      accounts: [{
        id: 'a1', name: '过期备份', icon: 'wallet', color: '#000', type: 'asset',
        category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
        hidden: false, sort_order: 1, created_at: iso('2025-01-01'), updated_at: iso('2025-02-01'),
      } as any],
    })

    await applyImportData(data, 'merge')

    const kept = await db.accounts.get('a1')
    expect(kept!.sort_order).toBe(9)
    expect(kept!.name).toBe('本地最新')
  })

  it('备份自带 sub_accounts 时直接使用，不再兜底生成', async () => {
    const data = blankData({
      accounts: [{
        id: 'a1', name: '证券', icon: 'wallet', color: '#000', type: 'asset',
        category: 'investment', currency: 'CNY', include_in_networth: true, archived: false,
        hidden: false, sort_order: 0, created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
      } as any],
      sub_accounts: [
        { id: 'sub-x', account_id: 'a1', name: 'A股', type: 'asset', category: 'investment', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: iso('2025-01-01'), updated_at: iso('2025-01-01') },
        { id: 'sub-y', account_id: 'a1', name: '美股', type: 'asset', category: 'investment', currency: 'USD', include_in_networth: true, archived: false, sort_order: 1, created_at: iso('2025-01-01'), updated_at: iso('2025-01-01') },
      ] as any,
      snapshots: [{
        id: 's1', account_id: 'a1', sub_account_id: 'sub-y', month: '2025-01', balance: '500',
        created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
      } as any],
    })

    await applyImportData(data, 'overwrite')

    const subs = await db.subAccounts.toArray()
    expect(subs.map((s) => s.id).sort()).toEqual(['sub-x', 'sub-y'])
    expect((await db.snapshots.get('s1'))!.sub_account_id).toBe('sub-y')
  })

  it('钳制未来的时间戳，防止伪造数据永久压制本地', async () => {
    const data = blankData({
      accounts: [{
        id: 'a1', name: '未来', icon: 'wallet', color: '#000', type: 'asset',
        category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
        hidden: false, sort_order: 0,
        created_at: iso('2025-01-01'), updated_at: '2099-01-01T00:00:00.000Z',
      } as any],
    })

    await applyImportData(data, 'overwrite')

    const acc = await db.accounts.get('a1')
    expect(acc!.updated_at <= new Date().toISOString()).toBe(true)
  })
})

describe('restoreBackup（撤销导入）', () => {
  it('恢复明文备份时一并还原子账户', async () => {
    const record: BackupRecord = {
      id: 'b1', kind: 'auto-import', created_at: iso('2025-01-01'),
      data: {
        accounts: [{
          id: 'a1', name: '原始', icon: 'wallet', color: '#000', type: 'asset',
          category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
          hidden: false, sort_order: 2, created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
        }] as any,
        sub_accounts: [{
          id: 'sub-1', account_id: 'a1', name: '主账户', type: 'asset', category: 'cash',
          currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0,
          created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
        }] as any,
        snapshots: [],
        exchange_rates: [],
        monthly_reviews: [],
      },
    }

    await restoreBackup(record)

    expect((await db.accounts.get('a1'))!.sort_order).toBe(2)
    expect((await db.subAccounts.get('sub-1'))!.name).toBe('主账户')
  })

  it('恢复缺少子账户的旧备份时按账户兜底', async () => {
    const record: BackupRecord = {
      id: 'b2', kind: 'auto-import', created_at: iso('2025-01-01'),
      data: {
        accounts: [{
          id: 'a9', name: '旧备份账户', icon: 'wallet', color: '#000', type: 'asset',
          category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
          hidden: false, sort_order: 0, created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
        }] as any,
        snapshots: [{
          id: 's9', account_id: 'a9', month: '2025-01', balance: '777',
          created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
        }] as any,
        exchange_rates: [],
        monthly_reviews: [],
      } as any,
    }

    await restoreBackup(record)

    const subs = await db.subAccounts.toArray()
    expect(subs).toHaveLength(1)
    expect(subs[0].account_id).toBe('a9')
    expect((await db.snapshots.get('s9'))!.sub_account_id).toBe(subs[0].id)
  })
})

describe('导出数据采集与恢复', () => {
  it('collectExportData 采集的子账户可被导入还原', async () => {
    await db.accounts.add({
      id: 'a1', name: '账户', icon: 'wallet', color: '#000', type: 'asset',
      category: 'cash', currency: 'CNY', include_in_networth: true, archived: false,
      hidden: false, sort_order: 0, created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
    } as any)
    await db.subAccounts.add({
      id: 'sub-1', account_id: 'a1', name: '子账户', type: 'asset', category: 'cash',
      currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0,
      created_at: iso('2025-01-01'), updated_at: iso('2025-01-01'),
    } as any)

    const data = await collectExportData()
    expect(data.sub_accounts?.length).toBe(1)

    // 清库后从导出的数据恢复
    await db.subAccounts.clear()
    expect(await db.subAccounts.count()).toBe(0)

    await applyImportData(data, 'overwrite')

    expect((await db.subAccounts.get('sub-1'))!.name).toBe('子账户')
  })
})
