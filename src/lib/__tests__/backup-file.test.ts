// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db, updateSettings } from '@/db'

// 加密与真实文件系统在测试环境不可用，mock 掉；
// 本测试关注的是编排逻辑：开关门控、节流、revision 递增、失败原因分类。
const writes: Array<{ filename: string; content: string }> = []
let fakePermission: 'none' | 'granted' | 'prompt' | 'denied' = 'granted'
let existingFile: string | null = null
let encryptCalls: Array<{ password: string; revision: number }> = []

vi.mock('@/fs-mock-marker', () => ({}))

vi.mock('../fs', () => ({
  supportsFileSystemAccess: () => true,
  getBackupFolderPermission: () => Promise.resolve(fakePermission),
  getBackupFolderName: () => 'Backups',
  saveToBackupFolder: (filename: string, content: string) => {
    writes.push({ filename, content })
    existingFile = content
    return Promise.resolve()
  },
  readFromBackupFolder: () => Promise.resolve(existingFile),
  requestBackupFolder: () => Promise.resolve('Backups'),
  reauthorizeBackupFolder: () => Promise.resolve(true),
  revokeBackupFolder: () => Promise.resolve(),
}))

vi.mock('../crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crypto')>()
  return {
    ...actual,
    encryptVault: vi.fn(async (_data: unknown, password: string, _vaultId: string, revision = 1) => {
      encryptCalls.push({ password, revision })
      return { blob: { fake: true, revision }, recoveryCode: '', keyFile: {} as any }
    }),
  }
})

const { writeFileAutoBackup, AUTO_BACKUP_FILENAME } = await import('../backup-file')

async function enable(opts: { password?: string } = {}) {
  await updateSettings({ auto_file_backup: true })
  localStorage.setItem('snapworth:file-backup-password', opts.password ?? 'test-password-123')
}

beforeEach(async () => {
  writes.length = 0
  encryptCalls = []
  existingFile = null
  fakePermission = 'granted'
  localStorage.clear()
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear()
  })
  await updateSettings({ auto_file_backup: false })
})

describe('writeFileAutoBackup 门控', () => {
  it('未开启功能时不写盘，force 也不例外', async () => {
    localStorage.setItem('snapworth:file-backup-password', 'x')
    const res = await writeFileAutoBackup({ force: true })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('disabled')
    expect(writes).toHaveLength(0)
  })

  it('开启但缺少密码时不写盘', async () => {
    await updateSettings({ auto_file_backup: true })
    const res = await writeFileAutoBackup({ force: true })
    expect(res.reason).toBe('no-password')
    expect(writes).toHaveLength(0)
  })

  it('未授权文件夹时返回 no-folder', async () => {
    fakePermission = 'none'
    await enable()
    const res = await writeFileAutoBackup({ force: true })
    expect(res.reason).toBe('no-folder')
  })

  it('权限降级为 prompt 时返回 permission，供 UI 提示恢复', async () => {
    fakePermission = 'prompt'
    await enable()
    const res = await writeFileAutoBackup({ force: true })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('permission')
    expect(writes).toHaveLength(0)
  })

  it('条件齐备时写入滚动文件并带上加密结果', async () => {
    await enable({ password: 'my-backup-pw' })
    const res = await writeFileAutoBackup({ force: true })

    expect(res.ok).toBe(true)
    expect(res.filename).toBe(AUTO_BACKUP_FILENAME)
    expect(writes).toHaveLength(1)
    expect(writes[0].filename).toBe('snapworth-auto.snapvault')
    expect(JSON.parse(writes[0].content).fake).toBe(true)
    expect(encryptCalls[0].password).toBe('my-backup-pw')
  })

  it('非 force 时受节流保护，避免每次记账都跑 Argon2', async () => {
    await enable()
    const first = await writeFileAutoBackup({ force: true })
    expect(first.ok).toBe(true)

    const second = await writeFileAutoBackup()
    expect(second.reason).toBe('throttled')
    expect(writes).toHaveLength(1)
  })

  it('写入后更新 last_backup_export_at，抑制导出提醒', async () => {
    await enable()
    await writeFileAutoBackup({ force: true })
    const settings = await db.settings.get('singleton')
    expect(settings!.last_backup_export_at).toBeTruthy()
  })
})

describe('revision 递增（防回滚替换）', () => {
  it('首次写入 revision 为 1，之后读取旧文件递增', async () => {
    await enable()

    await writeFileAutoBackup({ force: true })
    expect(encryptCalls[0].revision).toBe(1)

    await writeFileAutoBackup({ force: true })
    expect(encryptCalls[1].revision).toBe(2)

    await writeFileAutoBackup({ force: true })
    expect(encryptCalls[2].revision).toBe(3)
  })

  it('旧文件损坏时回到 1 而不是抛错', async () => {
    await enable()
    existingFile = 'not-json'
    const res = await writeFileAutoBackup({ force: true })
    expect(res.ok).toBe(true)
    expect(encryptCalls[0].revision).toBe(1)
  })
})
