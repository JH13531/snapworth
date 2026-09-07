import Dexie, { type Table } from 'dexie'
import type { Account, SubAccount, Snapshot, ExchangeRate, Settings, Tombstone, MonthlyReview, BackupRecord } from '@/types'

export class SnapworthDB extends Dexie {
  accounts!: Table<Account, string>
  subAccounts!: Table<SubAccount, string>
  snapshots!: Table<Snapshot, string>
  exchangeRates!: Table<ExchangeRate, [string, string]>
  settings!: Table<Settings, string>
  tombstones!: Table<Tombstone, string>
  monthlyReviews!: Table<MonthlyReview, string>
  backups!: Table<BackupRecord, string>

  constructor() {
    super('snapworth')
    this.version(1).stores({
      accounts: 'id, type, category, archived, hidden, sort_order',
      snapshots: 'id, account_id, month, [account_id+month]',
      exchangeRates: '[month+currency], month, currency',
      settings: 'id',
      tombstones: 'id, entity, updated_at',
    })
    this.version(2).stores({
      monthlyReviews: 'month, updated_at',
    })
    this.version(3).stores({
      backups: 'id, kind, created_at',
    })
    this.version(4).stores({
      snapshots: 'id, account_id, month, [account_id+month], currency',
    }).upgrade(async (tx) => {
      // 回填历史快照的币种：旧数据未在快照上记录币种，沿用其账户当前币种。
      const accounts = await tx.table('accounts').toArray()
      const currencyById = new Map(accounts.map((a: Account) => [a.id, a.currency]))
      await tx.table('snapshots').toCollection().modify((snap: Snapshot) => {
        if (!snap.currency) snap.currency = currencyById.get(snap.account_id) ?? 'CNY'
      })
    })
    this.version(5).upgrade(async (tx) => {
      // 回填首次记录时间：旧快照用 created_at 作为 recorded_at。
      await tx.table('snapshots').toCollection().modify((snap: Snapshot) => {
        if (!snap.recorded_at) snap.recorded_at = snap.created_at
      })
    })
    this.version(6).upgrade(async (tx) => {
      // 给已归档的账户回填 archived_at（旧数据只有 archived 布尔，没有归档月份）
      // 无法精确知道归档时间，用当前月作为兜底
      const now = new Date().toISOString().slice(0, 7)
      await tx.table('accounts').toCollection().modify((acc: Account) => {
        if (acc.archived && !acc.archived_at) {
          acc.archived_at = now
        }
      })
    })
    this.version(7).stores({
      subAccounts: 'id, account_id, category, currency, archived, sort_order',
    }).upgrade(async (tx) => {
      // 迁移：每个现有账户创建一个对应的子账户，继承所有属性
      // 旧快照保持 account_id 不变，sub_account_id 设为新子账户的 ID
      const accounts = await tx.table('accounts').toArray()
      const now = new Date().toISOString()
      for (const acc of accounts) {
        const sub: SubAccount = {
          id: crypto.randomUUID(),
          account_id: acc.id,
          name: '',
          type: acc.type,
          category: acc.category,
          currency: acc.currency,
          include_in_networth: acc.include_in_networth,
          archived: acc.archived,
          archived_at: acc.archived_at,
          sort_order: 0,
          icon: acc.icon,
          color: acc.color,
          created_at: now,
          updated_at: now,
        }
        await tx.table('subAccounts').add(sub)
        // 给该账户的所有快照加上 sub_account_id
        const snaps = await tx.table('snapshots').where('account_id').equals(acc.id).toArray()
        for (const snap of snaps) {
          await tx.table('snapshots').update(snap.id, { sub_account_id: sub.id })
        }
      }
    })
    this.version(8).upgrade(async (tx) => {
      // 清理「浏览器内自动备份」遗留数据：这类明文副本与主数据同存于 IndexedDB，
      // 清缓存时会一起丢失，起不到备份作用，功能已移除。
      await tx.table('backups').where('kind').equals('auto-export').delete()
    })
  }
}

// HMR-safe singleton: avoid multiple Dexie instances connecting to the same IndexedDB
const globalForDb = globalThis as unknown as { __snapworthDb?: SnapworthDB }
export const db = globalForDb.__snapworthDb ?? new SnapworthDB()
globalForDb.__snapworthDb = db

const SETTINGS_ID = 'singleton' as const

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get(SETTINGS_ID)
  if (existing) return existing
  const defaults: Settings = {
    id: SETTINGS_ID,
    base_currency: 'CNY',
    theme: 'system',
    privacy_mode: false,
    invert_change_color: false,
    book_name: '我的账本',
    schema_version: 1,
    onboarded: false,
    updated_at: new Date().toISOString(),
  }
  await db.settings.put(defaults)
  return defaults
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const next = { ...current, ...patch, id: SETTINGS_ID, updated_at: new Date().toISOString() }
  await db.settings.put(next)
  return next
}

/**
 * 返回当前账本的稳定 vault_id（用于加密备份与未来同步的 AAD 绑定/设备配对）。
 * 首次调用时生成并持久化；之后保持不变。
 */
export async function ensureVaultId(): Promise<string> {
  const current = await getSettings()
  if (current.vault_id) return current.vault_id
  const vault_id = uuid()
  await updateSettings({ vault_id })
  return vault_id
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
