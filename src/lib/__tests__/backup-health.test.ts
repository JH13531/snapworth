import { describe, it, expect, beforeEach } from 'vitest'
import {
  needsBackupReminder,
  daysSinceBackup,
  tryAcquireReminderSlot,
  BACKUP_STALE_MS,
  REMINDER_COOLDOWN_MS,
} from '../backup-health'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-03T12:00:00Z')

function iso(msAgo: number) {
  return new Date(NOW - msAgo).toISOString()
}

describe('needsBackupReminder', () => {
  it('没有数据时不打扰', () => {
    expect(needsBackupReminder({ hasData: false, autoFileBackupEnabled: false, lastBackupAt: null, now: NOW }))
      .toBe(false)
  })

  it('从未备份过时提醒', () => {
    expect(needsBackupReminder({ hasData: true, autoFileBackupEnabled: false, lastBackupAt: null, now: NOW }))
      .toBe(true)
  })

  it('刚备份过不提醒', () => {
    expect(needsBackupReminder({ hasData: true, autoFileBackupEnabled: false, lastBackupAt: iso(1 * DAY), now: NOW }))
      .toBe(false)
  })

  it('超过 30 天未备份时提醒', () => {
    expect(needsBackupReminder({
      hasData: true, autoFileBackupEnabled: false,
      lastBackupAt: iso(BACKUP_STALE_MS + DAY), now: NOW,
    })).toBe(true)
  })

  it('边界：恰好 30 天不提醒', () => {
    expect(needsBackupReminder({
      hasData: true, autoFileBackupEnabled: false,
      lastBackupAt: iso(BACKUP_STALE_MS), now: NOW,
    })).toBe(false)
  })

  it('已开启自动备份的用户永不提醒', () => {
    expect(needsBackupReminder({
      hasData: true, autoFileBackupEnabled: true,
      lastBackupAt: null, now: NOW,
    })).toBe(false)
  })

  it('时间戳无法解析时按需要提醒处理', () => {
    expect(needsBackupReminder({ hasData: true, autoFileBackupEnabled: false, lastBackupAt: 'garbage', now: NOW }))
      .toBe(true)
  })
})

describe('daysSinceBackup', () => {
  it('从未备份返回 null', () => {
    expect(daysSinceBackup(null, NOW)).toBeNull()
    expect(daysSinceBackup(undefined, NOW)).toBeNull()
  })

  it('返回整天数', () => {
    expect(daysSinceBackup(iso(45 * DAY), NOW)).toBe(45)
    expect(daysSinceBackup(iso(0), NOW)).toBe(0)
  })
})

describe('tryAcquireReminderSlot', () => {
  beforeEach(() => localStorage.clear())

  it('首次可提醒', () => {
    expect(tryAcquireReminderSlot(NOW)).toBe(true)
  })

  it('冷却期内第二次被拦截', () => {
    expect(tryAcquireReminderSlot(NOW)).toBe(true)
    expect(tryAcquireReminderSlot(NOW + 1000)).toBe(false)
  })

  it('超过冷却期后可再次提醒', () => {
    expect(tryAcquireReminderSlot(NOW)).toBe(true)
    expect(tryAcquireReminderSlot(NOW + REMINDER_COOLDOWN_MS + 1000)).toBe(true)
  })
})
