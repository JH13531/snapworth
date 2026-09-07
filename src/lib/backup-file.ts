/**
 * 自动把加密备份写入用户授权的本地文件夹。
 *
 * 设计要点：
 * - 单一滚动文件 snapworth-auto.snapvault，每次覆盖。云盘/同步盘自身有版本历史，
 *   本地不再堆积文件。
 * - 密码由用户在设置页一次性设定，存在 localStorage。
 *   为什么可以接受：本应用的明文数据本来就完整存在 IndexedDB 里，
 *   能读到 localStorage 的攻击者同样能读到明文数据，密码并未扩大本地攻击面；
 *   它保护的是「离开本机之后」的备份文件（云盘、共享电脑、U 盘）。
 * - File System Access API 的权限在浏览器重启后会降级为 'prompt'。降级期间无法在
 *   无用户手势时续期，因此 initBackupPermissionRecovery() 会在用户下一次点击时
 *   自动续期并补写，而不是要求用户去设置页操作。
 *   彻底免除此步骤的办法是把本应用安装为桌面应用/PWA——已安装应用的文件夹权限
 *   由浏览器永久保留（Chrome 122+ 亦提供「每次访问都允许」的持久授权选项）。
 */
import { db, ensureVaultId, updateSettings } from '@/db'
import { encryptVault } from './crypto'
import { collectExportData } from './backup'
import {
  supportsFileSystemAccess,
  requestBackupFolder,
  getBackupFolderPermission,
  reauthorizeBackupFolder,
  revokeBackupFolder,
  saveToBackupFolder,
  readFromBackupFolder,
  getBackupFolderName,
  isStandaloneApp,
} from './fs'

const PASSWORD_STORAGE_KEY = 'snapworth:file-backup-password'
export const AUTO_BACKUP_FILENAME = 'snapworth-auto.snapvault'

/** 距上次成功写入不足该间隔时跳过，避免每次记账都跑一遍 Argon2 派生。 */
const MIN_INTERVAL_MS = 60_000

export type BackupSkipReason = 'unsupported' | 'disabled' | 'no-password' | 'no-folder' | 'permission' | 'throttled'

export interface FileBackupResult {
  ok: boolean
  filename?: string
  folder?: string | null
  /** ok=false 时说明原因，供 UI 决定是提示还是静默忽略 */
  reason?: BackupSkipReason
  error?: string
}

export function getFileBackupPassword(): string | null {
  try {
    return localStorage.getItem(PASSWORD_STORAGE_KEY)
  } catch {
    return null
  }
}

function setFileBackupPassword(pwd: string) {
  try {
    localStorage.setItem(PASSWORD_STORAGE_KEY, pwd)
  } catch { /* 隐私模式下可能失败，忽略 */ }
}

function clearFileBackupPassword() {
  try {
    localStorage.removeItem(PASSWORD_STORAGE_KEY)
  } catch { /* ignore */ }
}

function isThrottled(): boolean {
  try {
    const last = Number(localStorage.getItem('snapworth:file-backup-at') || 0)
    return last > 0 && Date.now() - last < MIN_INTERVAL_MS
  } catch {
    return false
  }
}

function markWritten() {
  try {
    localStorage.setItem('snapworth:file-backup-at', String(Date.now()))
  } catch { /* ignore */ }
}

/** 读取滚动备份文件当前的 revision，用于 AAD 绑定，防止密文被回滚替换。 */
async function nextRevision(): Promise<number> {
  try {
    const existing = await readFromBackupFolder(AUTO_BACKUP_FILENAME)
    if (!existing) return 1
    const parsed = JSON.parse(existing)
    const rev = typeof parsed?.revision === 'number' ? parsed.revision : 0
    return rev + 1
  } catch {
    // 文件不存在或解析失败，都从 1 开始
    return 1
  }
}

/**
 * 写入一次自动备份。所有失败都以 reason/error 返回，不抛异常，
 * 以便记账流程 fire-and-forget 调用。
 *
 * force 只绕过写入节流，不绕过「已开启」判断——未开启功能时任何调用都不应写盘。
 */
export async function writeFileAutoBackup(opts: { force?: boolean } = {}): Promise<FileBackupResult> {
  if (!supportsFileSystemAccess()) return { ok: false, reason: 'unsupported' }

  const settings = await db.settings.get('singleton')
  if (!settings?.auto_file_backup) return { ok: false, reason: 'disabled' }
  if (!opts.force && isThrottled()) return { ok: false, reason: 'throttled' }

  const password = getFileBackupPassword()
  if (!password) return { ok: false, reason: 'no-password' }

  const perm = await getBackupFolderPermission()
  if (perm === 'none') return { ok: false, reason: 'no-folder' }
  if (perm !== 'granted') return { ok: false, reason: 'permission', folder: getBackupFolderName() }

  try {
    const data = await collectExportData()
    const vaultId = await ensureVaultId()
    const revision = await nextRevision()
    const { blob } = await encryptVault(data, password, vaultId, revision)
    await saveToBackupFolder(AUTO_BACKUP_FILENAME, JSON.stringify(blob, null, 2))
    markWritten()
    await updateSettings({ last_backup_export_at: new Date().toISOString() })
    return { ok: true, filename: AUTO_BACKUP_FILENAME, folder: getBackupFolderName() }
  } catch (err) {
    return { ok: false, reason: 'permission', error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 开启「自动备份到文件夹」。必须在用户手势中调用（内部会弹目录选择器）。
 * 成功后立即写一份，确保用户当场看到文件出现。
 */
export async function enableFileBackup(password: string): Promise<FileBackupResult> {
  if (!supportsFileSystemAccess()) return { ok: false, reason: 'unsupported' }
  if (!password || password.length < 8) {
    return { ok: false, reason: 'no-password', error: '密码至少 8 位' }
  }

  let folderName: string
  try {
    folderName = await requestBackupFolder()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('abort')) return { ok: false, reason: 'no-folder', error: '已取消选择' }
    return { ok: false, reason: 'no-folder', error: msg }
  }

  setFileBackupPassword(password)
  await db.settings.update('singleton', { auto_file_backup: true })

  const result = await writeFileAutoBackup({ force: true })
  return { ...result, folder: folderName }
}

/** 关闭自动备份到文件夹，撤销授权并清除本地密码。 */
export async function disableFileBackup(): Promise<void> {
  await updateSettings({ auto_file_backup: false })
  clearFileBackupPassword()
  await revokeBackupFolder()
  try { localStorage.removeItem('snapworth:file-backup-at') } catch { /* ignore */ }
}

/** 权限失效时一键重新授权（必须在用户手势中调用）。 */
export async function restoreFileBackupPermission(): Promise<boolean> {
  return reauthorizeBackupFolder()
}

// ========== 权限自动恢复 ==========

/**
 * 浏览器重启后文件夹权限会降级为 'prompt'，而重新授权必须发生在用户手势里。
 * 与其弹一个需要用户主动处理的警告，不如挂一个一次性的全局点击监听：
 * 用户重启后第一次点击页面任意位置，就在该手势中静默续期并补写一次备份。
 *
 * Chrome 122+ 会在此展示三选提示，用户选「每次访问时都允许」后即永久生效；
 * 已安装为桌面应用/PWA 时浏览器直接保留权限，这里根本不会被触发。
 */
let recoveryArmed = false

function disarmRecovery() {
  if (!recoveryArmed) return
  recoveryArmed = false
  document.removeEventListener('pointerdown', recoveryHandler, true)
}

async function recoveryHandler() {
  try {
    if (!(await reauthorizeBackupFolder())) {
      // 用户取消或拒绝：保留监听，下次点击再试
      return
    }
    disarmRecovery()
    await writeFileAutoBackup({ force: true })
  } catch {
    disarmRecovery()
  }
}

/**
 * 启动时调用。仅当权限确实处于降级状态（'prompt'）时才挂监听，
 * 避免权限正常时在每次点击都做一次异步授权检查。
 */
export async function initBackupPermissionRecovery(): Promise<void> {
  if (recoveryArmed || typeof document === 'undefined') return
  if (await getBackupFolderPermission() !== 'prompt') return

  recoveryArmed = true
  document.addEventListener('pointerdown', recoveryHandler, true)
}

/**
 * 页面隐藏/关闭前尽力补写一次。
 * 卸载阶段无法等待异步完成，因此不绕过节流（避免频繁切换标签页时反复跑 Argon2），
 * 失败即忽略——真正的兜底是记账后的自动写入。
 */
export function flushBackupOnHide(): () => void {
  const onHidden = () => {
    if (document.visibilityState !== 'hidden') return
    void writeFileAutoBackup().catch(() => {})
  }
  document.addEventListener('visibilitychange', onHidden)
  return () => document.removeEventListener('visibilitychange', onHidden)
}

export { getBackupFolderName, supportsFileSystemAccess, isStandaloneApp }

/** 供 UI 展示当前状态。 */
export async function getFileBackupStatus(): Promise<{
  enabled: boolean
  supported: boolean
  folder: string | null
  permission: 'none' | 'granted' | 'prompt' | 'denied'
}> {
  const settings = await db.settings.get('singleton')
  return {
    enabled: !!settings?.auto_file_backup,
    supported: supportsFileSystemAccess(),
    folder: getBackupFolderName(),
    permission: await getBackupFolderPermission(),
  }
}
