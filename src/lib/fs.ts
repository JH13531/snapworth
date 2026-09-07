/**
 * File System Access API 封装——用于授权文件夹后自动读写备份文件。
 * 仅在支持 File System Access API 的浏览器中可用（Chrome/Edge 桌面 86+）。
 * Safari/iOS/所有移动浏览器不支持，调用方需做渐进增强降级。
 *
 * 使用方式：
 *   1. requestBackupFolder() — 用户授权一个文件夹，返回 handle（存 IndexedDB）
 *   2. saveToBackupFolder(filename, content) — 写入文件到已授权文件夹
 *   3. readFromBackupFolder(filename) — 读取文件
 *   4. hasBackupFolderPermission() — 检查是否有已授权的文件夹
 */

const FOLDER_HANDLE_KEY = 'snapworth:backup-folder-handle'
const FOLDER_META_KEY = 'snapworth:backup-folder-name'

/** 检测浏览器是否支持 File System Access API */
export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/**
 * 是否作为已安装的 PWA 运行（独立窗口，非浏览器标签页）。
 * 已安装应用的文件访问权限由浏览器自动持久保留，重启后无需再次授权。
 */
export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false
  const mm = window.matchMedia?.('(display-mode: standalone)')
  if (mm?.matches) return true
  // iOS Safari 专用属性
  return (window.navigator as any).standalone === true
}

/**
 * 请求用户选择一个备份文件夹并授权。
 * 返回文件夹名称（用于显示），handle 存入 IndexedDB。
 */
export async function requestBackupFolder(): Promise<string> {
  if (!supportsFileSystemAccess()) {
    throw new Error('当前浏览器不支持文件夹授权功能')
  }

  const picker = (window as any).showDirectoryPicker
  const handle = await picker({
    id: 'snapworth-backups',
    mode: 'readwrite',
    startIn: 'documents',
  })

  // 验证权限
  const options = { mode: 'readwrite' } as const
  if ((await handle.requestPermission(options)) !== 'granted') {
    throw new Error('文件夹权限被拒绝')
  }

  // 存储 handle 和名称
  const db = await openHandleStore()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite')
    const req = tx.objectStore('handles').put(handle, FOLDER_HANDLE_KEY)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
  try { localStorage.setItem(FOLDER_META_KEY, handle.name) } catch {}

  return handle.name
}

/** 获取已授权文件夹的名称（用于 UI 显示） */
export function getBackupFolderName(): string | null {
  try {
    return localStorage.getItem(FOLDER_META_KEY)
  } catch {
    return null
  }
}

/** 检查是否有已授权的文件夹 */
export async function hasBackupFolder(): Promise<boolean> {
  const handle = await getFolderHandle()
  return handle !== null
}

/**
 * 查询当前授权状态，不弹窗、不打扰用户。
 * - 'none'   : 从未授权过文件夹
 * - 'granted': 可直接写盘
 * - 'prompt' : 已授权过，但浏览器重启后权限降级，需要用户在一次点击中重新允许
 * - 'denied' : 用户明确拒绝
 */
export async function getBackupFolderPermission(): Promise<'none' | 'granted' | 'prompt' | 'denied'> {
  const handle = await getFolderHandle()
  if (!handle) return 'none'
  try {
    return await handle.queryPermission({ mode: 'readwrite' })
  } catch {
    return 'denied'
  }
}

/**
 * 对已授权的文件夹重新申请权限（必须在用户手势中调用）。
 * 用于浏览器重启后权限降级的场景，不会重新弹出目录选择器。
 */
export async function reauthorizeBackupFolder(): Promise<boolean> {
  const handle = await getFolderHandle()
  if (!handle) return false
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

/** 取消文件夹授权并清除记录 */
export async function revokeBackupFolder(): Promise<void> {
  const db = await openHandleStore()
  await new Promise<void>((resolve) => {
    const tx = db.transaction('handles', 'readwrite')
    const req = tx.objectStore('handles').delete(FOLDER_HANDLE_KEY)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
  })
  try { localStorage.removeItem(FOLDER_META_KEY) } catch {}
}

/**
 * 将内容写入备份文件夹中的指定文件。
 * 自动重新申请权限（浏览器可能会让权限过期）。
 */
export async function saveToBackupFolder(filename: string, content: string): Promise<void> {
  const handle = await getFolderHandle()
  if (!handle) throw new Error('尚未授权备份文件夹')

  const options = { mode: 'readwrite' } as const
  if ((await handle.requestPermission(options)) !== 'granted') {
    throw new Error('文件夹权限已被撤销')
  }

  const fileHandle = await handle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

/**
 * 从备份文件夹读取指定文件内容。
 */
export async function readFromBackupFolder(filename: string): Promise<string | null> {
  const handle = await getFolderHandle()
  if (!handle) return null

  const options = { mode: 'read' } as const
  try {
    if ((await handle.requestPermission(options)) !== 'granted') return null
    const fileHandle = await handle.getFileHandle(filename)
    const file = await fileHandle.getFile()
    return await file.text()
  } catch {
    return null
  }
}

/**
 * 列出备份文件夹中所有文件（用于检测是否有备份文件可以导入）。
 */
export async function listBackupFolder(): Promise<string[]> {
  const handle = await getFolderHandle()
  if (!handle) return []

  const options = { mode: 'read' } as const
  try {
    if ((await handle.requestPermission(options)) !== 'granted') return []
    const names: string[] = []
    for await (const entry of handle.values()) {
      if (entry.kind === 'file') names.push(entry.name)
    }
    return names
  } catch {
    return []
  }
}

// ========== 内部：用 IndexedDB 存 FileSystemDirectoryHandle ==========

const DB_NAME = 'snapworth-fs-handles'
const DB_VERSION = 1

function openHandleStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('handles')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getFolderHandle(): Promise<any | null> {
  try {
    const db = await openHandleStore()
    return await new Promise<any>((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly')
      const req = tx.objectStore('handles').get(FOLDER_HANDLE_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}
