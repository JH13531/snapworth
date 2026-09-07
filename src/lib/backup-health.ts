/**
 * 备份健康度：判断是否该提醒用户备份。
 *
 * 背景：数据只存在当前设备的 IndexedDB 里，清缓存/换设备即全丢。
 * 「自动备份到文件夹」能自动留存，但手机端和不支持 FSA 的浏览器用不了，
 * 这些用户只能靠手动导出，很容易忘记。因此需要一个不依赖用户主动查看的提醒机制。
 */

/** 距上次备份超过该时长即提醒 */
export const BACKUP_STALE_MS = 30 * 24 * 60 * 60 * 1000

/** 同一设备上的提醒冷却，避免每次记账都被打扰 */
export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000

const LAST_REMINDER_KEY = 'snapworth:last-backup-reminder-at'

export interface BackupHealthInput {
  /** 是否已有记账数据 */
  hasData: boolean
  /** 已开启「自动备份到文件夹」——视为已具备自动留存，不再打扰 */
  autoFileBackupEnabled: boolean
  /** 上次成功留存的时刻（手动导出或自动写盘都会更新），ISO 字符串 */
  lastBackupAt?: string | null
  now?: number
}

/**
 * 是否需要提醒用户备份。
 * 已开启自动备份的用户永远不提醒——他们的问题由权限失效提示单独覆盖。
 */
export function needsBackupReminder(input: BackupHealthInput): boolean {
  if (!input.hasData) return false
  if (input.autoFileBackupEnabled) return false

  const now = input.now ?? Date.now()
  if (!input.lastBackupAt) return true

  const at = Date.parse(input.lastBackupAt)
  if (Number.isNaN(at)) return true
  return now - at > BACKUP_STALE_MS
}

/** 距上次备份的天数，用于把提醒写得更具体。从未备份返回 null。 */
export function daysSinceBackup(lastBackupAt?: string | null, now = Date.now()): number | null {
  if (!lastBackupAt) return null
  const at = Date.parse(lastBackupAt)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.floor((now - at) / (24 * 60 * 60 * 1000)))
}

/**
 * 冷却判断 + 记录。记账后的提醒走这里，避免每次保存都弹。
 * 返回 true 表示现在可以提醒（并已记录本次提醒时间）。
 */
export function tryAcquireReminderSlot(now = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(LAST_REMINDER_KEY) || 0)
    if (last > 0 && now - last < REMINDER_COOLDOWN_MS) return false
    localStorage.setItem(LAST_REMINDER_KEY, String(now))
    return true
  } catch {
    // 隐私模式下 localStorage 可能不可用，宁可多提醒一次
    return true
  }
}
