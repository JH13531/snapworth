import { db, uuid, getSettings } from '@/db'
import type { Account, BackupRecord, Snapshot, SubAccount } from '@/types'
import { decryptVault, type ExportData } from './crypto'

const AUTO_BACKUP_ID = 'auto-before-import'
/** 仅用于解密旧版加密自动备份（已停止写入新加密备份） */
const AUTO_BACKUP_KEY_STORAGE_KEY = 'snapworth:auto-backup-key'

/**
 * 收集当前所有业务数据，用于自动备份。
 */
async function collectAllData(): Promise<NonNullable<BackupRecord['data']>> {
  const [accounts, sub_accounts, snapshots, exchange_rates, monthly_reviews] = await Promise.all([
    db.accounts.toArray(),
    db.subAccounts.toArray(),
    db.snapshots.toArray(),
    db.exchangeRates.toArray(),
    db.monthlyReviews.toArray(),
  ])
  return { accounts, sub_accounts, snapshots, exchange_rates, monthly_reviews }
}

// ========== 导入前自动备份（用于撤销导入） ==========

/**
 * 在导入前把当前所有业务数据快照到本地 backups 表（明文）。
 * 只保留最近一次自动备份；用户可在导入后一键撤销。
 */
export async function createAutoBackupBeforeImport(): Promise<string> {
  const data = await collectAllData()
  const record: BackupRecord = {
    id: AUTO_BACKUP_ID,
    kind: 'auto-import',
    created_at: new Date().toISOString(),
    data,
  }
  await db.backups.put(record)
  return record.id
}

export async function getAutoBackup(): Promise<BackupRecord | undefined> {
  return db.backups.get(AUTO_BACKUP_ID)
}

export async function clearAutoBackup(): Promise<void> {
  await db.backups.delete(AUTO_BACKUP_ID)
}

/**
 * 收集一份完整的可导出数据（含 settings 与 tombstones），
 * 供手动导出与自动写盘备份共用。
 */
export async function collectExportData(): Promise<ExportData> {
  const [settings, data, tombstones] = await Promise.all([
    getSettings(),
    collectAllData(),
    db.tombstones.toArray(),
  ])
  return {
    schema_version: settings.schema_version,
    settings,
    accounts: data.accounts,
    sub_accounts: data.sub_accounts,
    snapshots: data.snapshots,
    exchange_rates: data.exchange_rates,
    monthly_reviews: data.monthly_reviews,
    tombstones,
  }
}

// ========== 恢复 ==========

/**
 * 旧版备份（以及 CSV 导入）没有 sub_accounts 字段，按账户兜底生成子账户（与 v7 迁移一致）。
 *
 * 快照通过 sub_account_id 关联子账户：
 * - 优先复用快照中已出现的 ID，避免新 ID 切断「快照 → 子账户」的关联；
 * - 对仍缺少 sub_account_id 的快照，回填到该账户新生成的子账户上，
 *   否则汇总时（子账户存在即优先于账户）这些快照会被漏掉。
 *
 * 返回的 snapshots 为回填后的新数组；无需处理时原样返回。
 */
export function backfillSubAccounts(
  accounts: Account[],
  snapshots: Snapshot[],
  existing?: SubAccount[],
): { subAccounts: SubAccount[]; snapshots: Snapshot[] } {
  const now = new Date().toISOString()
  const idsByAccount = new Map<string, Set<string>>()
  for (const snap of snapshots) {
    if (!snap.sub_account_id) continue
    let set = idsByAccount.get(snap.account_id)
    if (!set) {
      set = new Set()
      idsByAccount.set(snap.account_id, set)
    }
    set.add(snap.sub_account_id)
  }
  // 已有子账户的账户不再兜底，避免覆盖真实数据
  const skip = new Set<string>()
  if (existing) {
    for (const sub of existing) skip.add(sub.account_id)
  }

  const result: SubAccount[] = []
  // 每个账户兜底出的「主子账户」，用于接管该账户下未关联子账户的快照
  const primaryByAccount = new Map<string, string>()
  for (const acc of accounts) {
    if (skip.has(acc.id)) continue
    const ids = [...(idsByAccount.get(acc.id) ?? [])]
    if (ids.length === 0) ids.push(uuid())
    ids.forEach((id, idx) => {
      result.push({
        id,
        account_id: acc.id,
        name: '',
        type: acc.type,
        category: acc.category,
        currency: acc.currency,
        include_in_networth: acc.include_in_networth,
        archived: acc.archived,
        archived_at: acc.archived_at,
        sort_order: idx,
        created_at: now,
        updated_at: now,
      })
      if (idx === 0) primaryByAccount.set(acc.id, id)
    })
  }

  let out = snapshots
  if (primaryByAccount.size) {
    out = snapshots.map((s) =>
      !s.sub_account_id && primaryByAccount.has(s.account_id)
        ? { ...s, sub_account_id: primaryByAccount.get(s.account_id) }
        : s,
    )
  }
  return { subAccounts: result, snapshots: out }
}

/**
 * 把导入的数据写入本地库。
 *
 * - overwrite 模式：先清空五张业务表再写入。
 * - merge 模式：逐条按 updated_at 比较，只有更新的数据才覆盖本地。
 * - 备份缺少 sub_accounts 时（旧版备份、CSV/Excel 导入）按账户兜底生成，
 *   并回填快照的 sub_account_id，否则这些快照在汇总时会被漏掉。
 */
export async function applyImportData(importData: ExportData, mode: 'merge' | 'overwrite'): Promise<void> {
  const union = mode === 'merge'

  // 防御损坏/恶意的备份：把未来的 updated_at 钳制到当前时间，
  // 防止伪造的未来时间戳覆盖本地较新的记录。
  const now = new Date().toISOString()
  const clamp = (ts: string | undefined) => (ts && ts > now ? now : ts ?? now)
  const clampTimes = <T extends { created_at?: string; updated_at?: string }>(x: T): T => ({
    ...x,
    updated_at: clamp(x.updated_at),
    created_at: clamp(x.created_at),
  })

  const accounts = importData.accounts.map(clampTimes)
  const snapshots = importData.snapshots.map(clampTimes)
  const exchange_rates = importData.exchange_rates.map(clampTimes)
  const incomingReviews = (importData.monthly_reviews ?? []).map(clampTimes)
  const incomingSubs = (importData.sub_accounts ?? []).map(clampTimes)

  // 旧版备份不含子账户：按账户兜底生成，否则导入后账户会没有可记账的单元
  let subAccountsToImport = incomingSubs
  let snapshotsToImport = snapshots
  if (!incomingSubs.length) {
    const existingSubs = await db.subAccounts.toArray()
    const backfilled = backfillSubAccounts(accounts, snapshots, union ? existingSubs : undefined)
    subAccountsToImport = backfilled.subAccounts
    snapshotsToImport = backfilled.snapshots
  }

  await db.transaction('rw', db.accounts, db.subAccounts, db.snapshots, db.exchangeRates, db.monthlyReviews, async () => {
    if (!union) {
      await db.accounts.clear()
      await db.subAccounts.clear()
      await db.snapshots.clear()
      await db.exchangeRates.clear()
      await db.monthlyReviews.clear()
    }
    for (const a of accounts) {
      const existing = await db.accounts.get(a.id)
      if (!existing || (existing.updated_at < a.updated_at)) await db.accounts.put(a)
    }
    for (const s of subAccountsToImport) {
      const existing = await db.subAccounts.get(s.id)
      if (!existing || (existing.updated_at < s.updated_at)) await db.subAccounts.put(s)
    }
    for (const s of snapshotsToImport) {
      const existing = await db.snapshots.get(s.id)
      if (!existing || (existing.updated_at < s.updated_at)) await db.snapshots.put(s)
    }
    for (const r of exchange_rates) {
      const key: [string, string] = [r.month, r.currency]
      const existing = await db.exchangeRates.get(key)
      if (!existing || existing.updated_at < r.updated_at) await db.exchangeRates.put(r)
    }
    for (const rv of incomingReviews) {
      const existing = await db.monthlyReviews.get(rv.month)
      if (!existing || existing.updated_at < rv.updated_at) await db.monthlyReviews.put(rv)
    }
  })
}

/** 用备份快照覆盖当前业务数据（在单个事务内完成，用于撤销导入）。 */
export async function restoreBackup(record: BackupRecord): Promise<void> {
  let accounts: any[] = []
  let sub_accounts: any[] | undefined
  let snapshots: any[] = []
  let exchange_rates: any[] = []
  let monthly_reviews: any[] = []

  if (record.data) {
    accounts = record.data.accounts
    sub_accounts = record.data.sub_accounts
    snapshots = record.data.snapshots
    exchange_rates = record.data.exchange_rates
    monthly_reviews = record.data.monthly_reviews
  } else if (record.encrypted_blob) {
    // 旧版加密备份：尝试解密（autoKey 可能已不存在，失败则跳过）
    try {
      const data = await decryptLegacyAutoBackup(record)
      accounts = data.accounts
      sub_accounts = data.sub_accounts
      snapshots = data.snapshots
      exchange_rates = data.exchange_rates
      monthly_reviews = data.monthly_reviews
    } catch {
      // 旧加密备份无法解密（autoKey 已丢失或浏览器清除了 localStorage）
      // 静默跳过，避免阻塞主流程
    }
  }

  // 旧版备份缺失子账户数据：按账户兜底生成，避免恢复后账户没有子账户
  if (accounts.length && !sub_accounts) {
    const backfilled = backfillSubAccounts(accounts, snapshots)
    sub_accounts = backfilled.subAccounts
    snapshots = backfilled.snapshots
  }

  await db.transaction(
    'rw',
    db.accounts,
    db.subAccounts,
    db.snapshots,
    db.exchangeRates,
    db.monthlyReviews,
    async () => {
      await db.accounts.clear()
      await db.subAccounts.clear()
      await db.snapshots.clear()
      await db.exchangeRates.clear()
      await db.monthlyReviews.clear()
      if (accounts.length) await db.accounts.bulkAdd(accounts)
      if (sub_accounts?.length) await db.subAccounts.bulkAdd(sub_accounts)
      if (snapshots.length) await db.snapshots.bulkAdd(snapshots)
      if (exchange_rates.length) await db.exchangeRates.bulkAdd(exchange_rates)
      if (monthly_reviews.length) await db.monthlyReviews.bulkAdd(monthly_reviews)
    },
  )
}

export { uuid }

// ========== 旧版加密备份兼容（仅供迁移/恢复使用） ==========

/**
 * 取出 localStorage 中的旧版 autoKey（若存在）。
 * 新代码不再写入该 key；仅用于尝试解密旧版加密备份。
 */
function getLegacyAutoKey(): string | null {
  try {
    return localStorage.getItem(AUTO_BACKUP_KEY_STORAGE_KEY)
  } catch {
    return null
  }
}

/** 解密一份旧版自动加密备份（若 autoKey 已丢失则抛错）。 */
async function decryptLegacyAutoBackup(record: BackupRecord): Promise<ExportData> {
  if (!record.encrypted_blob) {
    throw new Error('该备份不是加密备份')
  }
  const autoKey = getLegacyAutoKey()
  if (!autoKey) {
    throw new Error('自动备份密钥已丢失，无法解密旧版备份')
  }
  return decryptVault(record.encrypted_blob, { password: autoKey })
}
