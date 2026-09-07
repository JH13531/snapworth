import { useRef, useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRightLeft } from 'lucide-react'
import {
  Moon, Sun, Monitor, Upload, FileSpreadsheet, Lock, Trash2, Key,
  ChevronRight, Info, X, Loader2, Eye, EyeOff, Download, AlertTriangle, Undo2, Copy, Check,
  FolderCog, ShieldAlert,
} from 'lucide-react'
import { useSettingsStore } from '@/store/settings'
import { useTranslation } from '@/lib/i18n'
import { CURRENCIES, currencyName } from '@/lib/currency'
import { db, ensureVaultId } from '@/db'
import { useAccounts, useSubAccounts, useSnapshots, useExchangeRates, useMonthlyReviews } from '@/hooks/useData'
import {
  encryptVault, decryptVault, downloadFile, isVaultBlob, isKeyFile,
  type ExportData, type VaultBlob, type KeyFile,
} from '@/lib/crypto'
import { exportFullCsv, parseCsvWide, downloadSampleCsv } from '@/lib/csv'
import { fetchRatesForMonth } from '@/lib/rates-api'
import { createAutoBackupBeforeImport, getAutoBackup, restoreBackup, clearAutoBackup, applyImportData } from '@/lib/backup'
import {
  getFileBackupStatus, enableFileBackup, disableFileBackup,
  restoreFileBackupPermission, writeFileAutoBackup, isStandaloneApp,
} from '@/lib/backup-file'
import { takePendingImportFile } from '@/lib/import-handoff'
import { currentMonth } from '@/lib/date'
import Decimal from 'decimal.js'
import { Icon } from '@/components/Icon'
import type { Theme, Account, Snapshot, AccountType } from '@/types'
import { CATEGORIES, categoryLabel } from '@/types'

const IMPORT_ICONS = ['wallet', 'piggy-bank', 'trending-up', 'gem', 'building', 'shield',
  'hand-coins', 'credit-card', 'house', 'car', 'landmark', 'coins',
  'smartphone', 'shopping-bag', 'circle-dot']
const IMPORT_EMOJIS = ['💰', '💳', '🏦', '🏠', '🚗', '📈', '💎', '🪙', '💵', '🌐']
const IMPORT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6']

function stripCommas(s: string): string { return s.replace(/,/g, '') }
function addCommas(s: string): string {
  const parts = s.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

/**
 * 导入后补全所有缺失汇率的历史月份。
 * 遍历所有有外币快照的月份，若该月缺少某外币汇率，则批量拉取并写入。
 * 静默失败（不阻塞导入完成提示）。
 */
async function backfillMissingRates(
  importedAccounts: Account[],
  importedSnapshots: Snapshot[],
) {
  const settings = await db.settings.get('singleton')
  const base = settings?.base_currency ?? 'CNY'

  // 找出所有外币币种（非{t('settings.base_currency')}）
  const foreignCurs = new Set<string>()
  for (const a of importedAccounts) {
    if (a.currency !== base) foreignCurs.add(a.currency)
  }
  if (foreignCurs.size === 0) return

  // 找出所有出现过的月份
  const allMonths = new Set<string>()
  for (const s of importedSnapshots) allMonths.add(s.month)
  if (allMonths.size === 0) return

  // 已有的汇率 [month, currency]
  const existingRates = await db.exchangeRates.toArray()
  const rateKeys = new Set(existingRates.map((r) => `${r.month}|${r.currency}`))

  // 按月份收集缺失的币种
  const monthToMissing = new Map<string, Set<string>>()
  for (const m of allMonths) {
    const missing = new Set<string>()
    for (const cur of foreignCurs) {
      if (!rateKeys.has(`${m}|${cur}`)) missing.add(cur)
    }
    if (missing.size > 0) monthToMissing.set(m, missing)
  }
  if (monthToMissing.size === 0) return

  const now = new Date().toISOString()
  for (const [m, missing] of monthToMissing) {
    try {
      const result = await fetchRatesForMonth(base, m, [...missing])
      for (const [cur, rate] of Object.entries(result.rates)) {
        const rateStr = rate.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
        const key: [string, string] = [m, cur]
        const existing = await db.exchangeRates.get(key)
        if (existing) {
          await db.exchangeRates.update(key, { rate_to_base: rateStr, updated_at: now })
        } else {
          await db.exchangeRates.add({
            month: m, currency: cur, rate_to_base: rateStr,
            rate_date: result.rate_date, created_at: now, updated_at: now,
          })
        }
      }
    } catch {
      // 单个月份失败不影响其他月份
    }
  }
}

type ExportState = {
  step: 'password' | 'result'
  password: string
  confirm: string
  showPw: boolean
  error: string
  busy: boolean
  recoveryCode: string
  keyFile: KeyFile | null
  blob: VaultBlob | null
  filename: string
  acknowledged: boolean
  copiedRecovery: boolean
  copiedKeyFile: boolean
}

type ImportUnlockState = {
  blob: VaultBlob
  mode: 'password' | 'recovery' | 'keyfile'
  value: string
  keyFileData: KeyFile | null
  showPw: boolean
  error: string
  busy: boolean
}

type ImportModeState = {
  data: ExportData
  confirmOverwrite: boolean
  busy: boolean
}

/**
 * {t('settings.debt_threshold')}输入：本地 state 管理，onBlur 时校验并保存。
 * 避免受控输入在清空/中间态被静默拒绝，导致无法输入。
 */
function ThresholdInputs({
  warn,
  danger,
  onSave,
}: {
  warn: number
  danger: number
  onSave: (patch: { health_threshold_warn?: number; health_threshold_danger?: number }) => void
}) {
  const { t } = useTranslation()
  const [warnStr, setWarnStr] = useState(String(warn))
  const [dangerStr, setDangerStr] = useState(String(danger))
  const [warnError, setWarnError] = useState('')
  const [dangerError, setDangerError] = useState('')

  // 外部值变化时（如初始加载）同步到本地
  useEffect(() => { setWarnStr(String(warn)); setWarnError('') }, [warn])
  useEffect(() => { setDangerStr(String(danger)); setDangerError('') }, [danger])

  function trySave(nextWarn: number | null, nextDanger: number | null) {
    // 两者都是 null 表示无变化
    const patch: { health_threshold_warn?: number; health_threshold_danger?: number } = {}
    if (nextWarn !== null && nextWarn !== warn) patch.health_threshold_warn = nextWarn
    if (nextDanger !== null && nextDanger !== danger) patch.health_threshold_danger = nextDanger
    if (Object.keys(patch).length > 0) onSave(patch)
  }

  function commitWarn() {
    const v = Number(warnStr)
    const d = Number(dangerStr)
    if (warnStr === '' || isNaN(v) || v < 0 || v > 100) {
      setWarnError(t('settings.warn_number'))
      setWarnStr(String(warn))
      return
    }
    // 需要与 danger 比较时，使用最新的 dangerStr（可能还未保存）
    const dangerRef = isNaN(d) ? danger : d
    if (v >= dangerRef) {
      setWarnError(t('settings.warn_lt_danger', { line: t('settings.danger_line'), value: dangerRef }))
      setWarnStr(String(warn))
      return
    }
    setWarnError('')
    trySave(v, isNaN(d) || dangerStr === '' || d <= v ? null : d)
  }

  function commitDanger() {
    const v = Number(dangerStr)
    const w = Number(warnStr)
    if (dangerStr === '' || isNaN(v) || v < 0 || v > 100) {
      setDangerError(t('settings.danger_number'))
      setDangerStr(String(danger))
      return
    }
    const warnRef = isNaN(w) ? warn : w
    if (v <= warnRef) {
      setDangerError(t('settings.danger_gt_warn', { line: t('settings.healthy_line'), value: warnRef }))
      setDangerStr(String(danger))
      return
    }
    setDangerError('')
    trySave(isNaN(w) || warnStr === '' || w >= v ? null : w, v)
  }

  return (
    <div className="flex gap-3 items-start">
      <div className="flex-1">
        <div className="text-[11px] text-green-500 mb-1">{t('settings.healthy_line')}</div>
        <input
          type="number"
          className={`input text-sm ${warnError ? 'border-red-400 focus:ring-red-400' : ''}`}
          min={0}
          max={100}
          value={warnStr}
          onChange={(e) => { setWarnStr(e.target.value); setWarnError('') }}
          onBlur={commitWarn}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
        {warnError && <div className="text-[11px] text-red-500 mt-1">{warnError}</div>}
      </div>
      <div className="text-slate-400 mt-5 text-xs">—</div>
      <div className="flex-1">
        <div className="text-[11px] text-red-500 mb-1">{t('settings.danger_line')}</div>
        <input
          type="number"
          className={`input text-sm ${dangerError ? 'border-red-400 focus:ring-red-400' : ''}`}
          min={0}
          max={100}
          value={dangerStr}
          onChange={(e) => { setDangerStr(e.target.value); setDangerError('') }}
          onBlur={commitDanger}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
        {dangerError && <div className="text-[11px] text-red-500 mt-1">{dangerError}</div>}
      </div>
    </div>
  )
}

type AccountSetupState = {
  accounts: Account[]
  sourceData: ExportData
}

export default function SettingsPage() {
  const { settings, update } = useSettingsStore()
  const { t, setLang } = useTranslation()
  const lang = (settings?.language as 'zh' | 'en') || 'zh' 
  const accounts = useAccounts({ includeArchived: true })
  const subAccounts = useSubAccounts({ includeArchived: true })
  const snapshots = useSnapshots()
  const rates = useExchangeRates()
  const reviews = useMonthlyReviews()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [exportState, setExportState] = useState<ExportState | null>(null)
  const [importUnlock, setImportUnlock] = useState<ImportUnlockState | null>(null)
  const [importMode, setImportMode] = useState<ImportModeState | null>(null)
  const [accountSetup, setAccountSetup] = useState<AccountSetupState | null>(null)
  const [csvFormatHelp, setCsvFormatHelp] = useState(false)

  // 支持 /settings?action=export 直达导出弹窗（复盘完成等场景的强提醒会跳这里）
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('action') === 'export' && !exportState) {
      setExportState({
        step: 'password',
        password: '', confirm: '', showPw: false,
        error: '', busy: false,
        recoveryCode: '', keyFile: null, blob: null,
        filename: `snapworth-${currentMonth()}.snapvault`,
        acknowledged: false,
        copiedRecovery: false, copiedKeyFile: false,
      })
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, exportState, setSearchParams])

  // {t('settings.net_worth_goal')}：draft 是千分位显示值，为空表示未设定
  const [goalDraft, setGoalDraft] = useState(() => {
    const g = settings?.net_worth_goal
    if (!g || g === '') return ''
    try { return addCommas(new Decimal(g).toFixed(0)) } catch { return '' }
  })
  const [goalFocused, setGoalFocused] = useState(false)

  // ===== 自动备份到本地文件夹 =====
  const [fileBackup, setFileBackup] = useState<{
    supported: boolean
    enabled: boolean
    folder: string | null
    permission: 'none' | 'granted' | 'prompt' | 'denied'
  } | null>(null)
  const [fbDialog, setFbDialog] = useState<{ password: string; confirm: string; busy: boolean; error: string } | null>(null)
  const [fbMsg, setFbMsg] = useState('')

  const refreshFileBackupStatus = useCallback(async () => {
    setFileBackup(await getFileBackupStatus())
  }, [])

  useEffect(() => {
    refreshFileBackupStatus().catch(() => {})
  }, [refreshFileBackupStatus])

  // 引导页选择的备份文件在此续接导入流程。
  // 必须等 settings 就绪：解析过程会用到 base_currency 与账本配置。
  useEffect(() => {
    if (!settings) return
    const file = takePendingImportFile()
    if (file) processImportFile(file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  async function openFileBackupDialog() {
    setFbMsg('')
    setFbDialog({ password: '', confirm: '', busy: false, error: '' })
  }

  async function doEnableFileBackup() {
    if (!fbDialog) return
    const pwd = fbDialog.password
    if (pwd.length < 8) {
      setFbDialog({ ...fbDialog, error: t('backup.pwd_min') })
      return
    }
    if (pwd !== fbDialog.confirm) {
      setFbDialog({ ...fbDialog, error: t('backup.pwd_mismatch') })
      return
    }
    setFbDialog({ ...fbDialog, busy: true, error: '' })
    try {
      // 必须在用户手势中调用：内部会弹出目录选择器
      const res = await enableFileBackup(pwd)
      if (!res.ok) {
        setFbDialog({ ...fbDialog, busy: false, error: res.error ?? t('backup.enable_failed') })
        return
      }
      setFbDialog(null)
      setFbMsg(t('backup.enabled_msg', { folder: res.folder ?? t('backup.default_folder') }))
      await refreshFileBackupStatus()
      await useSettingsStore.getState().load()
    } catch (err) {
      setFbDialog({ ...fbDialog, busy: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function doDisableFileBackup() {
    if (!confirm(t('backup.disable_confirm'))) return
    await disableFileBackup()
    setFbMsg(t('backup.disabled_msg'))
    await refreshFileBackupStatus()
    await useSettingsStore.getState().load()
  }

  async function doReauthorizeFileBackup() {
    const ok = await restoreFileBackupPermission()
    setFbMsg(ok ? t('backup.perm_restored') : t('backup.perm_denied'))
    if (ok) {
      const res = await writeFileAutoBackup({ force: true })
      if (res.ok) setFbMsg(t('backup.perm_restored_written'))
    }
    await refreshFileBackupStatus()
  }

  async function doWriteFileBackupNow() {
    setFbMsg(t('backup.writing'))
    const res = await writeFileAutoBackup({ force: true })
    setFbMsg(res.ok
      ? t('backup.written', { folder: res.folder ?? '' })
      : t('backup.write_failed', { reason: res.error ?? res.reason ?? t('backup.unknown_reason') }))
    await refreshFileBackupStatus()
  }

  if (!settings) return null
  const cfg = settings

  function openExport() {
    setExportState({
      step: 'password',
      password: '', confirm: '', showPw: false,
      error: '', busy: false,
      recoveryCode: '', keyFile: null, blob: null,
      filename: `snapworth-${currentMonth()}.snapvault`,
      acknowledged: false,
      copiedRecovery: false, copiedKeyFile: false,
    })
  }

  async function doExport() {
    if (!exportState) return
    const pwd = exportState.password
    if (pwd.length < 8) {
      setExportState({ ...exportState, error: t('backup.pwd_min') })
      return
    }
    if (pwd !== exportState.confirm) {
      setExportState({ ...exportState, error: t('backup.pwd_mismatch') })
      return
    }
    setExportState({ ...exportState, busy: true, error: '' })
    try {
      const vaultId = await ensureVaultId()
      const data: ExportData = {
        schema_version: cfg.schema_version,
        settings: cfg,
        accounts,
        sub_accounts: subAccounts,
        snapshots,
        exchange_rates: rates,
        monthly_reviews: reviews,
        tombstones: [],
      }
      const { blob, recoveryCode, keyFile } = await encryptVault(data, pwd, vaultId)
      setExportState({
        ...exportState,
        step: 'result',
        busy: false,
        password: '', confirm: '',
        blob, recoveryCode, keyFile,
      })
    } catch (err) {
      setExportState({ ...exportState, busy: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  function downloadExport() {
    if (!exportState?.blob) return
    downloadFile(exportState.filename, JSON.stringify(exportState.blob, null, 2))
    update({ last_backup_export_at: new Date().toISOString() }).catch(() => {})
  }

  function downloadKeyFile() {
    if (!exportState?.keyFile) return
    const keyFilename = exportState.filename.replace('.snapvault', '.snapkey')
    downloadFile(keyFilename, JSON.stringify(exportState.keyFile, null, 2), 'application/json')
  }

  function exportCsv() {
    const csv = exportFullCsv(accounts, snapshots, rates, cfg, subAccounts)
    downloadFile(`snapworth-${currentMonth()}.csv`, csv, 'text/csv')
  }

  /** 解析成功后弹出导入模式选择 */
  function promptImportMode(importData: ExportData) {
    setImportMsg('')
    setImportMode({ data: importData, confirmOverwrite: false, busy: false })
  }

  async function applyImport(importData: ExportData, mode: 'merge' | 'overwrite') {
    await createAutoBackupBeforeImport()
    await applyImportData(importData, mode)
    setCanUndo(true)
    const msg = mode === 'merge' ? t('settings.import_merged') : t('settings.import_replaced')
    setImportMsg(msg)

    // 补全历史月份的外币汇率（导入的数据通常不含汇率）
    backfillMissingRates(importData.accounts, importData.snapshots).catch(() => {})

    // 导入即是一次重要的数据变更，顺手刷新文件夹自动备份（未开启则静默跳过）
    const res = await writeFileAutoBackup({ force: true })
    if (!res.ok && res.reason === 'permission') setFbMsg(res.error ?? t('backup.permission_expired'))
    else if (res.ok) refreshFileBackupStatus().catch(() => {})
  }

  async function undoImport() {
    setUndoing(true)
    try {
      const backup = await getAutoBackup()
      if (!backup) throw new Error(t('import.not_found_backup'))
      await restoreBackup(backup)
      await clearAutoBackup()
      setCanUndo(false)
      setImportMsg(t('import.undone'))
    } catch (err) {
      setImportMsg(t('import.undo_failed', { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      setUndoing(false)
    }
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await processImportFile(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  /** 读取并解析导入文件，进入对应的导入流程（CSV 匹配 / 加密解锁）。可被引导页交接复用。 */
  async function processImportFile(file: File) {
    setImportMsg(t('import.reading'))
    try {
      const fileName = file.name.toLowerCase()
      const isExcel = fileName.endsWith('.xls') || fileName.endsWith('.xlsx')
      let text: string

      if (isExcel) {
        // Read Excel file and convert first sheet to CSV
        const buffer = await file.arrayBuffer()
        const XLSX = await import('xlsx')
        const workbook = XLSX.read(buffer, { type: 'array' })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        text = XLSX.utils.sheet_to_csv(firstSheet)
      } else {
        text = await file.text()
      }

      // Check if this is a CSV file (or was converted from Excel)
      const isCsvByName = fileName.endsWith('.csv') || isExcel
      let isCsv = isCsvByName
      let parsedJson: unknown = null
      if (!isCsvByName) {
        try {
          parsedJson = JSON.parse(text)
        } catch {
          // Not valid JSON — treat as CSV
          isCsv = true
        }
      }

      if (isCsv) {
        // Parse CSV and match accounts by name
        const csvData = parseCsvWide(text, settings?.base_currency ?? 'CNY')

        // Match accounts by name to existing accounts
        const existingAccounts = await db.accounts.toArray()
        const accountByName = new Map(existingAccounts.map((a) => [a.name, a]))

        const matchedAccounts = csvData.accounts.map((csvAccount: Account) => {
          const existing = accountByName.get(csvAccount.name)
          if (existing) {
            // Use existing account ID and properties
            return { ...csvAccount, id: existing.id, type: existing.type, category: existing.category, currency: existing.currency }
          }
          return csvAccount
        })

        // Update snapshots to use matched account IDs
        const matchedSnapshots = csvData.snapshots.map((snap: Snapshot) => {
          const csvAccount = csvData.accounts.find((a: Account) => a.id === snap.account_id)
          const matchedAccount = matchedAccounts.find((a: Account) => a.name === csvAccount?.name)
          return { ...snap, account_id: matchedAccount?.id ?? snap.account_id }
        })

        const sourceData: ExportData = {
          schema_version: cfg.schema_version,
          settings: cfg,
          accounts: matchedAccounts,
          snapshots: matchedSnapshots,
          exchange_rates: [],
          monthly_reviews: [],
          tombstones: [],
        }

        setImportMsg('')
        setAccountSetup({ accounts: [...matchedAccounts], sourceData })
      } else {
        // Encrypted vault or key file
        const data = parsedJson
        if (isVaultBlob(data)) {
          setImportMsg('')
          setImportUnlock({
            blob: data, mode: 'password', value: '', keyFileData: null, showPw: false, error: '', busy: false,
          })
        } else if (isKeyFile(data)) {
          setImportMsg('')
          throw new Error(t('import.is_keyfile'))
        } else {
          throw new Error(t('import.unknown_format'))
        }
      }
    } catch (err) {
      if (err instanceof Error && (err as any).code === 'CSV_FORMAT_UNKNOWN') {
        setCsvFormatHelp(true)
      } else {
        const msg = t('import.failed', { reason: err instanceof Error ? err.message : String(err) })
        setImportMsg(msg)
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function doImportUnlock() {
    if (!importUnlock) return
    const { blob, mode, value, keyFileData } = importUnlock
    if (mode === 'password' && !value.trim()) {
      setImportUnlock({ ...importUnlock, error: t('import.enter_password') })
      return
    }
    if (mode === 'recovery' && !value.trim()) {
      setImportUnlock({ ...importUnlock, error: t('import.enter_recovery') })
      return
    }
    if (mode === 'keyfile' && !keyFileData) {
      setImportUnlock({ ...importUnlock, error: t('import.enter_keyfile') })
      return
    }
    setImportUnlock({ ...importUnlock, busy: true, error: '' })
    try {
      let creds: Parameters<typeof decryptVault>[1]
      if (mode === 'password') creds = { password: value }
      else if (mode === 'recovery') creds = { recoveryCode: value }
      else creds = { keyFile: keyFileData! }
      const importData = await decryptVault(blob, creds)
      setImportUnlock(null)
      setImportMsg(t('import.decrypt_ok'))
      promptImportMode(importData)
    } catch (err) {
      setImportUnlock({ ...importUnlock, busy: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  function handleKeyFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !importUnlock) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        if (!isKeyFile(data)) throw new Error(t('import.invalid_keyfile'))
        setImportUnlock({ ...importUnlock, keyFileData: data, error: '' })
      } catch (err) {
        setImportUnlock({ ...importUnlock, error: t('import.keyfile_invalid', { reason: err instanceof Error ? err.message : String(err) }) })
      }
    }
    reader.readAsText(file)
  }

  async function clearAll() {
    if (!confirm(t('settings.clear_data_confirm'))) return
    if (!confirm(t('import.delete_confirm'))) return

    // 1. 删除主业务库（Dexie）
    try { await db.delete() } catch { /* ignore */ }

    // 2. 清空 localStorage（drafts、auto-backup-key、collapsed-cats、folder meta 等）
    try { localStorage.clear() } catch { /* ignore */ }

    // 3. 删除存 FileSystemDirectoryHandle 的辅助 IndexedDB
    try {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('snapworth-fs-handles')
        req.onsuccess = () => resolve()
        req.onerror = () => resolve()
        req.onblocked = () => resolve()
      })
    } catch { /* ignore */ }

    // 4. 注销所有 Service Worker，避免旧版缓存残留
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister().catch(() => {})))
      } catch { /* ignore */ }
    }

    location.reload()
  }

  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: t('settings.theme_light'), icon: Sun },
    { value: 'dark', label: t('settings.theme_dark'), icon: Moon },
    { value: 'system', label: t('settings.theme_system'), icon: Monitor },
  ]

  return (
    <div className="px-4 lg:px-8 pt-4 pb-8">
      <h1 className="text-2xl font-bold mb-4">{t('settings.title')}</h1>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-slate-500 mb-2 px-1">{t('settings.section_book')}</h2>
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          <div className="p-4">
            <label className="label">{t('settings.book_name')}</label>
            <input className="input" value={settings.book_name} onChange={(e) => update({ book_name: e.target.value })} />
          </div>
          <div className="p-4">
            <label className="label">{t('settings.base_currency')}</label>
            <select className="input" value={settings.base_currency} onChange={(e) => update({ base_currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} - {currencyName(c)}</option>)}
            </select>
          </div>
          <div className="p-4">
            <label className="label">{t('settings.net_worth_goal')}</label>
            <div className="relative">
              <input
                type="text"
                className="input pr-8"
                placeholder={t('settings.goal_unset_placeholder')}
                value={goalFocused ? (goalDraft ? stripCommas(goalDraft) : '') : (goalDraft || '')}
                onFocus={() => setGoalFocused(true)}
                onBlur={() => {
                  setGoalFocused(false)
                  const raw = stripCommas(goalDraft.trim())
                  if (raw === '') {
                    update({ net_worth_goal: undefined })
                    setGoalDraft('')
                  } else {
                    try {
                      const d = new Decimal(raw)
                      if (d.isNegative()) {
                        setGoalDraft('')
                        update({ net_worth_goal: undefined })
                      } else {
                        const clean = d.toFixed(0)
                        update({ net_worth_goal: clean })
                        setGoalDraft(addCommas(clean))
                      }
                    } catch {
                      // invalid, revert
                      const cur = settings.net_worth_goal
                      setGoalDraft(cur ? addCommas(new Decimal(cur).toFixed(0)) : '')
                    }
                  }
                }}
                onChange={(e) => {
                  const v = e.target.value
                  // Allow digits and commas only
                  const cleaned = v.replace(/[^0-9,]/g, '')
                  setGoalDraft(cleaned)
                }}
                inputMode="numeric"
              />
              {goalDraft && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setGoalDraft('')
                    update({ net_worth_goal: undefined })
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-1">{t('settings.goal_desc')}</div>
          </div>
          <div className="p-4 border-t border-slate-100 dark:border-slate-800">
            <label className="label">{t('settings.debt_threshold')}</label>
            <div className="text-xs text-slate-500 mb-3">{t('settings.debt_threshold_desc')}</div>
            <ThresholdInputs
              warn={settings.health_threshold_warn ?? 50}
              danger={settings.health_threshold_danger ?? 70}
              onSave={(patch) => update(patch)}
            />
            <div className="flex gap-4 mt-2 text-[11px] text-slate-400">
              <span className="text-green-500">{t('settings.health_legend_healthy', { line: t('settings.healthy_line') })}</span>
              <span className="text-yellow-500">● {t('review.warning')}: {t('settings.between')}</span>
              <span className="text-red-500">{t('settings.health_legend_danger', { line: t('settings.danger_line') })}</span>
            </div>
          </div>
          <Link to="/settings/rates" className="p-4 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
            <div className="w-9 h-9 rounded-xl bg-cyan-100 dark:bg-cyan-900 flex items-center justify-center shrink-0">
              <ArrowRightLeft size={18} className="text-cyan-600" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">{t('settings.rates_manage')}</div>
              <div className="text-xs text-slate-500">{t('settings.rates_subtitle', { base: settings.base_currency })}</div>
            </div>
            <ChevronRight size={18} className="text-slate-400" />
          </Link>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-slate-500 mb-2 px-1">{t('settings.section_appearance')}</h2>
        <div className="card p-2 flex gap-1">
          {themes.map((t) => (
            <button
              key={t.value}
              onClick={() => update({ theme: t.value })}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs ${settings.theme === t.value ? 'bg-brand-100 dark:bg-brand-900 text-brand-600' : 'text-slate-500'}`}
            >
              <t.icon size={20} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="card mt-2 p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{t('settings.invert_color')}</div>
            <div className="text-xs text-slate-500">
              {settings.invert_change_color ? t('settings.invert_color_alt') : t('settings.invert_color_desc')}
            </div>
          </div>
          <button
            onClick={() => update({ invert_change_color: !settings.invert_change_color })}
            className={`w-12 h-7 rounded-full transition-colors relative ${settings.invert_change_color ? 'bg-brand-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${settings.invert_change_color ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>
        <div className="card mt-2 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">{t('settings.language')}</div>
          </div>
          <div className="flex gap-2">
            {(['zh', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                  lang === l
                    ? 'bg-brand-100 dark:bg-brand-900 text-brand-600 font-medium'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                {l === 'zh' ? t('settings.chinese') : t('settings.english')}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-slate-500 mb-2 px-1">{t('settings.section_data')}</h2>
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {/* 自动备份到本地文件夹 */}
          {fileBackup?.supported && (
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FolderCog size={16} className="text-slate-400" />
                  <span className="text-sm font-medium">{t('backup.auto_title')}</span>
                </div>
                {fileBackup.enabled ? (
                  <button onClick={doDisableFileBackup} className="text-xs text-slate-400 hover:text-red-500 hover:underline">
                    {t('backup.disable')}
                  </button>
                ) : (
                  <button onClick={openFileBackupDialog} className="text-xs text-brand-600 hover:underline">
                    {t('backup.enable')}
                  </button>
                )}
              </div>

              {!fileBackup.enabled && (
                <div className="text-xs text-slate-500 leading-relaxed">
                  {t('backup.intro')}
                </div>
              )}

              {fileBackup.enabled && (
                <>
                  <div className="text-xs text-slate-500">
                    {t('backup.location')}<span className="font-medium">{fileBackup.folder ?? t('backup.unknown')}</span>
                    <span className="text-slate-400"> / snapworth-auto.snapvault</span>
                  </div>

                  {fileBackup.permission === 'granted' ? (
                    <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                      <Check size={12} /> {t('backup.permission_ok')}
                    </div>
                  ) : (
                    <div className="mt-2 flex items-start gap-1.5">
                      <ShieldAlert size={12} className="text-slate-400 shrink-0 mt-0.5" />
                      <div className="text-[11px] text-slate-500 leading-relaxed">
                        {t('backup.permission_degraded')}
                        <button onClick={doReauthorizeFileBackup} className="text-brand-600 underline mx-0.5">
                          {t('backup.reauthorize')}
                        </button>
                        。
                      </div>
                    </div>
                  )}

                  {!isStandaloneApp() && (
                    <div className="mt-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-500 leading-relaxed">
                      {t('backup.install_hint')}
                    </div>
                  )}

                  <div className="flex gap-2 mt-3">
                    <button onClick={doWriteFileBackupNow} className="flex-1 py-2 rounded-lg bg-brand-50 dark:bg-brand-950/50 text-brand-600 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors">
                      {t('backup.write_now')}
                    </button>
                  </div>
                </>
              )}

              {fbMsg && <div className="text-xs text-slate-500 mt-2">{fbMsg}</div>}
            </div>
          )}

          {fileBackup && !fileBackup.supported && (
            <div className="p-4 text-xs text-slate-400">
              {t('backup.unsupported')}
            </div>
          )}

          <button onClick={openExport} className="w-full p-4 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-900 flex items-center justify-center shrink-0">
              <Lock size={18} className="text-green-600" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">{t('settings.export_backup')}</div>
              <div className="text-xs text-slate-500">{t('settings.export_backup_subtitle')}</div>
            </div>
            <ChevronRight size={18} className="text-slate-400" />
          </button>
          <button onClick={exportCsv} className="w-full p-4 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900 flex items-center justify-center shrink-0">
              <FileSpreadsheet size={18} className="text-purple-600" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">{t('settings.export_csv')}</div>
              <div className="text-xs text-slate-500">{t('settings.export_csv_desc')}</div>
            </div>
            <ChevronRight size={18} className="text-slate-400" />
          </button>
          <button onClick={() => fileRef.current?.click()} className="w-full p-4 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-900 flex items-center justify-center shrink-0">
              <Upload size={18} className="text-orange-600" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">{t('settings.import_data')}</div>
              <div className="text-xs text-slate-500">{t('settings.import_data_desc')}</div>
            </div>
            <ChevronRight size={18} className="text-slate-400" />
          </button>
          <input ref={fileRef} type="file" accept=".snapvault,.snapkey,.csv,.xls,.xlsx" className="hidden" onChange={onImport} />
        </div>
        {importMsg && (
          <div className="mt-2 flex flex-col items-center gap-2">
            <div className="text-sm text-center text-slate-500">{importMsg}</div>
            {canUndo && (
              <button
                onClick={undoImport}
                disabled={undoing}
                className="btn-secondary text-sm py-1.5"
              >
                <Undo2 size={14} /> {undoing ? t('backup.restoring') : t('backup.undo_import')}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-slate-500 mb-2 px-1">{t('settings.section_danger')}</h2>
        <div className="card">
          <button onClick={clearAll} className="w-full p-4 flex items-center gap-3 text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50">
            <Trash2 size={18} />
            <div>
              <div className="text-sm font-medium">{t('settings.clear_data')}</div>
              <div className="text-xs opacity-70">{t('settings.clear_data_warning')}</div>
            </div>
          </button>
        </div>
      </section>

      <section>
        <div className="card p-4 flex items-start gap-3">
          <Info size={18} className="text-slate-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-500 leading-relaxed">
            {t('settings.about_line1')}<br />
            {t('settings.about_line2', { action: t('settings.export_backup') })}<br />
            {t('settings.about_line3')}
          </div>
        </div>
      </section>

      {fbDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 animate-backdrop-in" onClick={() => { if (!fbDialog.busy) setFbDialog(null) }}>
          <div className="card w-full max-w-md p-5 animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t('backup.enable_dialog_title')}</h3>
              <button onClick={() => setFbDialog(null)} className="p-1 text-slate-400"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">
              {t('backup.enable_dialog_desc')}
              <code className="mx-1 px-1 rounded bg-slate-100 dark:bg-slate-800 text-[12px]">snapworth-auto.snapvault</code>
              {t('backup.enable_dialog_desc2')}
            </p>
            <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              {t('backup.enable_dialog_warn')}
            </div>
            <label className="label">{t('backup.password_label')}</label>
            <input
              type="password"
              className="input mb-3"
              value={fbDialog.password}
              autoFocus
              autoComplete="new-password"
              onChange={(e) => setFbDialog({ ...fbDialog, password: e.target.value, error: '' })}
            />
            <label className="label">{t('backup.confirm_label')}</label>
            <input
              type="password"
              className="input mb-4"
              value={fbDialog.confirm}
              autoComplete="new-password"
              onChange={(e) => setFbDialog({ ...fbDialog, confirm: e.target.value, error: '' })}
              onKeyDown={(e) => { if (e.key === 'Enter') doEnableFileBackup() }}
            />
            {fbDialog.error && <div className="text-sm text-red-500 mb-3">{fbDialog.error}</div>}
            <button onClick={doEnableFileBackup} disabled={fbDialog.busy} className="btn-primary w-full py-2.5 flex items-center justify-center gap-2">
              {fbDialog.busy ? <Loader2 size={16} className="animate-spin" /> : <FolderCog size={16} />}
              {t('backup.choose_folder')}
            </button>
          </div>
        </div>
      )}

      {exportState && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 animate-backdrop-in" onClick={() => { if (!exportState.busy) setExportState(null) }}>
          <div className="card w-full max-w-md p-5 max-h-[90vh] overflow-y-auto animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t('settings.export_backup')}</h3>
              <button onClick={() => setExportState(null)} className="p-1 text-slate-400"><X size={20} /></button>
            </div>

            {exportState.step === 'password' && (
              <>
                <p className="text-sm text-slate-500 mb-4">{t('backup.export_desc')}</p>
                <label className="label">{t('backup.password_label')}</label>
                <div className="relative mb-3">
                  <input
                    type={exportState.showPw ? 'text' : 'password'}
                    className="input pr-10"
                    value={exportState.password}
                    autoFocus
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    name="vault-new-password"
                    onChange={(e) => setExportState({ ...exportState, password: e.target.value, error: '' })}
                    onKeyDown={(e) => { if (e.key === 'Enter') doExport() }}
                  />
                  <button type="button" onClick={() => setExportState({ ...exportState, showPw: !exportState.showPw })} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {exportState.showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <label className="label">{t('backup.confirm_label')}</label>
                <div className="relative mb-4">
                  <input
                    type={exportState.showPw ? 'text' : 'password'}
                    className="input pr-10"
                    value={exportState.confirm}
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    name="vault-new-password-confirm"
                    onChange={(e) => setExportState({ ...exportState, confirm: e.target.value, error: '' })}
                    onKeyDown={(e) => { if (e.key === 'Enter') doExport() }}
                  />
                  <button type="button" onClick={() => setExportState({ ...exportState, showPw: !exportState.showPw })} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {exportState.showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {exportState.error && <div className="text-sm text-red-500 mb-3">{exportState.error}</div>}
                <button onClick={doExport} disabled={exportState.busy} className="btn-primary w-full py-3">
                  {exportState.busy ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
                  {exportState.busy ? t('backup.encrypting') : t('backup.generate')}
                </button>
              </>
            )}

            {exportState.step === 'result' && (
              <>
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 p-3 mb-4">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">{t('backup.result_notice')}</p>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">{t('backup.way1_title')}</div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(exportState.recoveryCode)
                      setExportState({ ...exportState, copiedRecovery: true })
                      setTimeout(() => setExportState(s => s && { ...s, copiedRecovery: false }), 1500)
                    }}
                    className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1"
                  >
                    {exportState.copiedRecovery ? <><Check size={14} className="text-green-500" /> {t('backup.copied')}</> : <><Copy size={14} /> {t('backup.copy')}</>}
                  </button>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 text-center font-mono text-lg tracking-wider select-all">
                    {exportState.recoveryCode}
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">{t('backup.recovery_hint')}</p>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800 my-4 relative">
                  <span className="absolute left-1/2 -translate-x-1/2 -top-2.5 bg-white dark:bg-slate-900 px-3 text-xs text-slate-400">{t('backup.or')}</span>
                </div>

                <div className="mb-4 mt-4">
                  <div className="text-sm font-medium mb-2">{t('backup.way2_title')}</div>
                  <button
                    onClick={downloadKeyFile}
                    className="w-full py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Key size={16} /> {t('backup.download_key')}
                  </button>
                  <p className="text-xs text-slate-500 mt-1.5">{t('backup.key_hint')}</p>
                </div>

                <button onClick={downloadExport} className="btn-primary w-full py-3 mb-3">
                  <Download size={18} /> {t('backup.download_vault')}
                </button>
                <label className="flex items-start gap-2 text-xs text-slate-500 mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4"
                    checked={exportState.acknowledged}
                    onChange={(e) => setExportState({ ...exportState, acknowledged: e.target.checked })}
                  />
                  <span>{t('backup.acknowledge')}</span>
                </label>
                <button
                  onClick={() => setExportState(null)}
                  disabled={!exportState.acknowledged}
                  className="btn-secondary w-full py-2.5"
                >
                  {t('backup.done')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {importUnlock && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 animate-backdrop-in" onClick={() => { if (!importUnlock.busy) setImportUnlock(null) }}>
          <div className="card w-full max-w-sm p-5 animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t('import.decrypt_title')}</h3>
              <button onClick={() => setImportUnlock(null)} className="p-1 text-slate-400"><X size={20} /></button>
            </div>
            <div className="flex gap-1 mb-3 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                onClick={() => setImportUnlock({ ...importUnlock, mode: 'password', value: '', error: '' })}
                className={`flex-1 py-2 rounded-lg text-sm ${importUnlock.mode === 'password' ? 'bg-white dark:bg-slate-900 shadow-sm font-medium' : 'text-slate-500'}`}
              >{t('import.mode_password')}</button>
              <button
                onClick={() => setImportUnlock({ ...importUnlock, mode: 'recovery', value: '', error: '' })}
                className={`flex-1 py-2 rounded-lg text-sm ${importUnlock.mode === 'recovery' ? 'bg-white dark:bg-slate-900 shadow-sm font-medium' : 'text-slate-500'}`}
              >{t('import.mode_recovery')}</button>
              <button
                onClick={() => setImportUnlock({ ...importUnlock, mode: 'keyfile', error: '' })}
                className={`flex-1 py-2 rounded-lg text-sm ${importUnlock.mode === 'keyfile' ? 'bg-white dark:bg-slate-900 shadow-sm font-medium' : 'text-slate-500'}`}
              >{t('import.mode_keyfile')}</button>
            </div>
            <div className="relative mb-4">
              {importUnlock.mode === 'password' && (
                <>
                  <input
                    type={importUnlock.showPw ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder={t('import.password_placeholder')}
                    value={importUnlock.value}
                    autoFocus
                    autoComplete="current-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    name="vault-unlock-password"
                    onChange={(e) => setImportUnlock({ ...importUnlock, value: e.target.value, error: '' })}
                    onKeyDown={(e) => { if (e.key === 'Enter') doImportUnlock() }}
                  />
                  <button type="button" onClick={() => setImportUnlock({ ...importUnlock, showPw: !importUnlock.showPw })} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {importUnlock.showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </>
              )}
              {importUnlock.mode === 'recovery' && (
                <input
                  className="input font-mono tracking-wider text-center"
                  placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                  value={importUnlock.value}
                  autoFocus
                  onChange={(e) => setImportUnlock({ ...importUnlock, value: e.target.value.toUpperCase(), error: '' })}
                  onKeyDown={(e) => { if (e.key === 'Enter') doImportUnlock() }}
                />
              )}
              {importUnlock.mode === 'keyfile' && (
                <div>
                  <input
                    ref={(el) => { if (el) el.value = '' }}
                    type="file"
                    accept=".snapkey"
                    onChange={handleKeyFileSelect}
                    className="hidden"
                    id="keyfile-upload"
                  />
                  <label htmlFor="keyfile-upload" className="block w-full py-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-center text-sm text-slate-500 cursor-pointer hover:border-slate-400 dark:hover:border-slate-600">
                    <Key size={20} className="mx-auto mb-1 text-slate-400" />
                    {importUnlock.keyFileData ? (
                      <span className="text-green-600 dark:text-green-400">✓ {t('import.keyfile_selected', { id: importUnlock.keyFileData.vault_id })}</span>
                    ) : (
                      <span>{t('import.keyfile_pick')}</span>
                    )}
                  </label>
                </div>
              )}
            </div>
            {importUnlock.error && <div className="text-sm text-red-500 mb-3">{importUnlock.error}</div>}
            <button onClick={doImportUnlock} disabled={importUnlock.busy} className="btn-primary w-full py-3">
              {importUnlock.busy ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
              {importUnlock.busy ? t('import.decrypting') : t('import.decrypt_go')}
            </button>
          </div>
        </div>
      )}

      {importMode && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 animate-backdrop-in" onClick={() => { if (!importMode.busy) setImportMode(null) }}>
          <div className="card w-full max-w-sm p-5 animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t('import.mode_title')}</h3>
              <button onClick={() => setImportMode(null)} className="p-1 text-slate-400"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-4">{t('import.mode_desc')}</p>

            {!importMode.confirmOverwrite ? (
              <div className="space-y-3">
                <button
                  onClick={async () => {
                    setImportMode({ ...importMode, busy: true })
                    try {
                      await applyImport(importMode.data, 'merge')
                      setImportMode(null)
                    } catch (err) {
                      setImportMsg(t('import.failed', { reason: err instanceof Error ? err.message : String(err) }))
                      setImportMode(null)
                    }
                  }}
                  disabled={importMode.busy}
                  className="w-full p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-brand-500 dark:hover:border-brand-500 text-left transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900 flex items-center justify-center shrink-0">
                      <Upload size={18} className="text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium group-hover:text-brand-600">{t('import.merge')}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{t('import.merge_desc')}</div>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setImportMode({ ...importMode, confirmOverwrite: true })}
                  disabled={importMode.busy}
                  className="w-full p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-red-400 dark:hover:border-red-500 text-left transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/50 flex items-center justify-center shrink-0">
                      <AlertTriangle size={18} className="text-red-500" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-red-500 group-hover:text-red-600">{t('import.overwrite')}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{t('import.overwrite_desc')}</div>
                    </div>
                  </div>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
                      {t('import.overwrite_warn_pre')}<b>{t('import.overwrite_warn_strong')}</b>{t('import.overwrite_warn_post', { action: t('settings.auto_backup') })}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setImportMode({ ...importMode, confirmOverwrite: false })}
                    disabled={importMode.busy}
                    className="btn-secondary flex-1"
                  >
                    {t('import.back')}
                  </button>
                  <button
                    onClick={async () => {
                      setImportMode({ ...importMode, busy: true })
                      try {
                        await applyImport(importMode.data, 'overwrite')
                        setImportMode(null)
                      } catch (err) {
                        setImportMsg(t('import.failed', { reason: err instanceof Error ? err.message : String(err) }))
                        setImportMode(null)
                      }
                    }}
                    disabled={importMode.busy}
                    className="btn flex-1 bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    {importMode.busy ? <Loader2 size={16} className="animate-spin" /> : null}
                    {importMode.busy ? t('import.importing') : t('import.confirm_overwrite')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {accountSetup && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 animate-backdrop-in" onClick={() => setAccountSetup(null)}>
          <div className="card w-full max-w-lg max-h-[85vh] flex flex-col animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 pb-3 shrink-0">
              <h3 className="font-semibold">{t('import.account_title')}</h3>
              <button onClick={() => setAccountSetup(null)} className="p-1 text-slate-400"><X size={20} /></button>
            </div>
            <p className="px-5 text-sm text-slate-500 pb-3 shrink-0">{t('import.account_desc')}</p>
            <div className="flex-1 overflow-y-auto px-5 space-y-3">
              {accountSetup.accounts.map((acct, idx) => {
                const catForType = CATEGORIES.filter((c) => c.type === acct.type)
                const updateAcct = (patch: Partial<Account>) => {
                  const updated = [...accountSetup.accounts]
                  updated[idx] = { ...acct, ...patch }
                  setAccountSetup({ ...accountSetup, accounts: updated })
                }
                return (
                  <div key={acct.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2.5">
                    {/* 名称 + 图标 */}
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: acct.color + '22' }}>
                        <Icon name={acct.icon} size={18} />
                      </div>
                      <input
                        className="flex-1 text-sm font-medium bg-transparent border-b border-transparent focus:border-slate-300 dark:focus:border-slate-600 outline-none px-0 py-0.5 min-w-0"
                        value={acct.name}
                        onChange={(e) => updateAcct({ name: e.target.value })}
                        placeholder={t('import.account_name_placeholder')}
                      />
                    </div>
                    {/* 图标选择 */}
                    <div>
                      <label className="text-[11px] text-slate-400 mb-1 block">{t('import.field_icon')}</label>
                      <div className="flex flex-wrap gap-1">
                        {IMPORT_ICONS.map((ic) => (
                          <button
                            key={ic}
                            onClick={() => updateAcct({ icon: ic })}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 transition-colors ${acct.icon === ic ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-600' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                          >
                            <Icon name={ic} size={14} />
                          </button>
                        ))}
                        {IMPORT_EMOJIS.map((em) => (
                          <button
                            key={em}
                            onClick={() => updateAcct({ icon: em })}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors ${acct.icon === em ? 'bg-brand-100 dark:bg-brand-900/50' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 颜色选择 */}
                    <div>
                      <label className="text-[11px] text-slate-400 mb-1 block">{t('import.field_color')}</label>
                      <div className="flex flex-wrap gap-1.5">
                        {IMPORT_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => updateAcct({ color: c })}
                            className={`w-6 h-6 rounded-full transition-all ${acct.color === c ? 'ring-2 ring-offset-1 ring-brand-500 scale-110' : 'hover:scale-105'}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>
                    {/* 类型/类别/货币 */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[11px] text-slate-400 mb-1 block">{t('import.field_type')}</label>
                        <select
                          className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5"
                          value={acct.type}
                          onChange={(e) => {
                            const newType = e.target.value as AccountType
                            const defaultCat = CATEGORIES.find((c) => c.type === newType)?.key ?? 'cash'
                            updateAcct({ type: newType, category: defaultCat })
                          }}
                        >
                          <option value="asset">{t('accounts.asset')}</option>
                          <option value="liability">{t('accounts.liability')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 mb-1 block">{t('import.field_category')}</label>
                        <select
                          className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5"
                          value={acct.category}
                          onChange={(e) => updateAcct({ category: e.target.value })}
                        >
                          {catForType.map((c) => (
                            <option key={c.key} value={c.key}>{categoryLabel(c.key)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 mb-1 block">{t('import.field_currency')}</label>
                        <select
                          className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5"
                          value={acct.currency}
                          onChange={(e) => updateAcct({ currency: e.target.value })}
                        >
                          {CURRENCIES.map((c) => (
                            <option key={c.code} value={c.code}>{c.code}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {/* 备注 */}
                    <div>
                      <label className="text-[11px] text-slate-400 mb-1 block">{t('import.field_note')}</label>
                      <input
                        className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5"
                        value={acct.note ?? ''}
                        onChange={(e) => updateAcct({ note: e.target.value || undefined })}
                        placeholder={t('import.note_optional')}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="p-5 pt-3 shrink-0">
              <button
                onClick={() => {
                  const editedAccounts = accountSetup.accounts
                  const remappedSnapshots = accountSetup.sourceData.snapshots.map((snap) => {
                    const originalAcct = accountSetup.sourceData.accounts.find((a) => a.id === snap.account_id)
                    const editedAcct = editedAccounts.find((a) => a.name === originalAcct?.name)
                    return { ...snap, account_id: editedAcct?.id ?? snap.account_id }
                  })
                  const importData: ExportData = {
                    ...accountSetup.sourceData,
                    accounts: editedAccounts,
                    snapshots: remappedSnapshots,
                  }
                  setAccountSetup(null)
                  promptImportMode(importData)
                }}
                className="btn-primary w-full py-3"
              >
                {t('import.next')}
              </button>
            </div>
          </div>
        </div>
      )}

      {csvFormatHelp && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 animate-backdrop-in" onClick={() => setCsvFormatHelp(false)}>
          <div className="card w-full max-w-md p-5 animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{t('csv_help.title')}</h3>
              <button onClick={() => setCsvFormatHelp(false)} className="p-1 text-slate-400"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-4">{t('csv_help.desc')}</p>
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium">📊 {t('csv_help.wide')}</div>
                  <button onClick={() => downloadSampleCsv('snapshot-wide')} className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                    <Download size={14} />{t('csv_help.download_sample')}
                  </button>
                </div>
                <div className="text-xs text-slate-500">{t('csv_help.wide_desc')}</div>
                <div className="mt-1.5 text-xs text-slate-400 font-mono bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2 overflow-x-auto">
                  {t('csv_help.sample_wide')}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium">📋 {t('csv_help.transposed')}</div>
                  <button onClick={() => downloadSampleCsv('snapshot-transposed')} className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                    <Download size={14} />{t('csv_help.download_sample')}
                  </button>
                </div>
                <div className="text-xs text-slate-500">{t('csv_help.transposed_desc')}</div>
                <div className="mt-1.5 text-xs text-slate-400 font-mono bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2 overflow-x-auto">
                  {t('csv_help.sample_transposed')}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium">📝 {t('csv_help.transaction')}</div>
                  <button onClick={() => downloadSampleCsv('transaction')} className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                    <Download size={14} />{t('csv_help.download_sample')}
                  </button>
                </div>
                <div className="text-xs text-slate-500">{t('csv_help.transaction_desc')}</div>
                <div className="mt-1.5 text-xs text-slate-400 font-mono bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2 overflow-x-auto">
                  {t('csv_help.sample_transaction')}
                </div>
              </div>
            </div>
            <button onClick={() => setCsvFormatHelp(false)} className="btn-primary w-full py-2.5 mt-4">
              {t('csv_help.got_it')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}