import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronDown, Copy, Check, X, Download, Loader2, SkipForward,  } from 'lucide-react'
import { useAccountsWithReady, useSnapshots, useExchangeRates, useSubAccountsWithReady } from '@/hooks/useData'
import { useSettingsStore } from '@/store/settings'
import { db, uuid } from '@/db'
import { type Account, type SubAccount, subAccountName, subAccountIcon, subAccountColor } from '@/types'
import { currentMonth, prevMonth, nextMonth, formatMonth } from '@/lib/date'
import { summarizeMonth, formatMoney, pctChange, nearestPriorMonth, latestSnapshotByAccount } from '@/lib/money'
import Decimal from 'decimal.js'
import { Icon } from '@/components/Icon'
import { MonthPicker } from '@/components/MonthPicker'
import Skeleton from '@/components/Skeleton'
import { fetchRatesForMonth } from '@/lib/rates-api'
import { writeFileAutoBackup } from '@/lib/backup-file'
import { needsBackupReminder, daysSinceBackup, tryAcquireReminderSlot } from '@/lib/backup-health'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/lib/i18n'
import { localeTag } from '@/lib/i18n-locale'
import { useSwipeGesture } from '@/hooks/useSwipeGesture'

/** 去除千分位逗号，得到纯数字字符串 */
function stripCommas(s: string): string {
  return s.replace(/,/g, '')
}

/** 格式化为千分位字符串（无小数） */
function addCommas(s: string): string {
  const parts = s.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

export default function EntryPage() {
  const { month: routeMonth } = useParams()
  const navigate = useNavigate()
  const month = routeMonth ?? currentMonth()
  const { accounts, ready: accountsReady } = useAccountsWithReady()
  const { subAccounts, ready: subAccountsReady } = useSubAccountsWithReady()
  const snapshots = useSnapshots()
  const rates = useExchangeRates()
  const { settings } = useSettingsStore()
  const base = settings?.base_currency ?? 'CNY'
  const hide = settings?.privacy_mode ?? false
  const invert = settings?.invert_change_color ?? false
  const { t } = useTranslation()
  const { toast } = useToast()

  const [balances, setBalances] = useState<Record<string, string>>({})
  const loadedMonthRef = useRef<string>('')
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('snapworth:collapsed-accounts')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })
  const contentRef = useRef<HTMLDivElement>(null)

  // 持久化折叠状态
  useEffect(() => {
    try { localStorage.setItem('snapworth:collapsed-accounts', JSON.stringify([...collapsedAccounts])) } catch {}
  }, [collapsedAccounts])

  // 初始化 balances：从已保存快照载入，再用本地草稿覆盖（未提交的输入）
  const hasLoadedSnapshotsRef = useRef(false)
  useEffect(() => {
    if (loadedMonthRef.current !== month) {
      loadedMonthRef.current = month
      hasLoadedSnapshotsRef.current = false
    }
    if (accounts.length === 0) return
    if (hasLoadedSnapshotsRef.current) return
    // 快照数据还在加载中（live query 初始默认空数组），等有数据了再同步
    const monthSnaps = snapshots.filter((s) => s.month === month)
    if (monthSnaps.length === 0 && snapshots.length === 0) return
    hasLoadedSnapshotsRef.current = true

    const map: Record<string, string> = {}
    for (const s of snapshots) {
      if (s.month === month) {
        const key = s.sub_account_id ?? s.account_id
        map[key] = s.balance
      }
    }
    // 草稿覆盖已保存数据（未提交的输入优先）
    try {
      const saved = localStorage.getItem(`snapworth:draft:${month}`)
      if (saved) {
        const draft = JSON.parse(saved) as Record<string, string>
        for (const [id, val] of Object.entries(draft)) {
          map[id] = val
        }
      }
    } catch { /* ignore */ }
    setBalances(map)
  }, [month, snapshots, accounts])

  // 草稿自动保存到 localStorage
  useEffect(() => {
    try {
      const hasAny = Object.values(balances).some((v) => v !== '' && v !== undefined)
      if (hasAny) {
        localStorage.setItem(`snapworth:draft:${month}`, JSON.stringify(balances))
      } else {
        localStorage.removeItem(`snapworth:draft:${month}`)
      }
    } catch { /* ignore */ }
  }, [balances, month])

  const activeSubAccountsByAccount = useMemo(() => {
    const active = subAccounts.filter((s) => !s.archived && s.include_in_networth)
    // 按主账户分组，每组内按 sort_order 排序
    const byAccount = new Map<string, SubAccount[]>()
    for (const s of active) {
      if (!byAccount.has(s.account_id)) byAccount.set(s.account_id, [])
      byAccount.get(s.account_id)!.push(s)
    }
    for (const list of byAccount.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order)
    }
    return byAccount
  }, [subAccounts])

  const allActiveSubAccounts = useMemo(() => {
    const all: SubAccount[] = []
    for (const list of activeSubAccountsByAccount.values()) {
      all.push(...list as SubAccount[])
    }
    return all
  }, [activeSubAccountsByAccount])

  const hasUnsavedChanges = useMemo(() => {
    for (const acc of allActiveSubAccounts) {
      const draft = stripCommas(balances[acc.id] ?? '')
      const saved = snapshots.find((s) => (s.sub_account_id ?? s.account_id) === acc.id && s.month === month)?.balance ?? ''
      if (draft !== saved) return true
    }
    for (const id of Object.keys(balances)) {
      if (!allActiveSubAccounts.find((a) => a.id === id)) {
        const saved = snapshots.find((s) => s.account_id === id && s.month === month)
        if (stripCommas(balances[id] ?? '') !== (saved?.balance ?? '')) return true
      }
    }
    return false
  }, [balances, snapshots, month, allActiveSubAccounts])

  const groupedByAccount = useMemo(() => {
    // 按主账户分组，并找出主账户信息
    const byAccount = new Map<string, { account: Account | undefined; subs: SubAccount[] }>()
    for (const s of allActiveSubAccounts) {
      if (!byAccount.has(s.account_id)) {
        byAccount.set(s.account_id, {
          account: accounts.find((a) => a.id === s.account_id),
          subs: [],
        })
      }
      byAccount.get(s.account_id)!.subs.push(s)
    }
    // 按主账户 sort_order 排序
    return [...byAccount.entries()].sort(([, a], [, b]) => {
      const ao = a.account?.sort_order ?? 0
      const bo = b.account?.sort_order ?? 0
      return ao - bo
    })
  }, [allActiveSubAccounts, accounts])

  const latestByAccount = useMemo(
    () => latestSnapshotByAccount(snapshots, month),
    [snapshots, month],
  )

  const currentSummary = useMemo(() => {
    const draftSnaps = [...snapshots]
    const monthSnapIds = new Set(
      snapshots.filter((s) => s.month === month).map((s) => s.account_id),
    )
    for (const acc of allActiveSubAccounts) {
      const draft = balances[acc.id]?.trim() ?? ''
      if (!monthSnapIds.has(acc.id) && draft !== '') {
        draftSnaps.push({
          id: `__draft_${acc.id}`,
          account_id: acc.account_id,
          sub_account_id: acc.id,
          month,
          balance: stripCommas(draft),
          currency: acc.currency,
          created_at: '',
          updated_at: '',
        })
      }
    }
    return summarizeMonth(
      accounts,
      draftSnaps.map((s) => {
        if (s.month !== month) return s
        const draft = balances[s.account_id]
        const cleanDraft = draft ? stripCommas(draft.trim()) : ''
        return { ...s, balance: cleanDraft !== '' ? cleanDraft : s.balance }
      }),
      rates,
      month,
      base,
      subAccounts,
    )
  }, [accounts, subAccounts, snapshots, balances, rates, month, base, allActiveSubAccounts])
  const priorMonth = nearestPriorMonth(snapshots, month)
  const prevSummary = useMemo(
    () => priorMonth ? summarizeMonth(accounts, snapshots, rates, priorMonth, base, subAccounts) : null,
    [accounts, subAccounts, snapshots, rates, priorMonth, base],
  )

  const change = prevSummary ? currentSummary.networth.sub(prevSummary.networth) : null
  const changePct = prevSummary ? pctChange(currentSummary.networth, prevSummary.networth) : null
  const positive = change?.gte(0) ?? true
  const changeColor = settings?.invert_change_color
    ? positive ? 'text-green-500' : 'text-red-500'
    : positive ? 'text-red-500' : 'text-green-500'
  const priorLabel = priorMonth === prevMonth(month)
    ? t('review.mom_last_month')
    : priorMonth ? t('review.compare_with', { month: priorMonth.slice(5) }) : ''

  const completedCount = allActiveSubAccounts.filter((a) => balances[a.id] !== undefined && balances[a.id] !== '').length

  const lastRecordedAt = useMemo(() => {
    const monthSnaps = snapshots.filter((s) => s.month === month && s.recorded_at)
    if (monthSnaps.length === 0) return null
    return monthSnaps.reduce((latest, s) => s.recorded_at! > latest ? s.recorded_at! : latest, '')
  }, [snapshots, month])

  function fillLatest() {
    const latest = latestSnapshotByAccount(snapshots, month)
    let filled = 0
    setBalances((cur) => {
      const next = { ...cur }
      for (const acc of allActiveSubAccounts) {
        const prev = latest.get(acc.account_id)
        if (prev && !next[acc.id]) {
          next[acc.id] = prev.balance
          filled++
        }
      }
      return next
    })
    if (filled > 0) {
      toast(t('toast.filled_from_prev', { count: filled }), 'success')
    } else {
      toast(t('toast.no_history'), 'info')
    }
  }

  function fillOneLatest(accId: string) {
    const prev = latestSnapshotByAccount(snapshots, month).get(accId)
    if (!prev) return
    setBalances((cur) => ({ ...cur, [accId]: prev.balance }))
  }

  /** 跳转到下一个未填写的账户输入框 */
  function scrollToNextEmpty() {
    const firstEmpty = allActiveSubAccounts.find((a) => !balances[a.id] || balances[a.id] === '')
    if (!firstEmpty) {
      toast(t('toast.all_filled'), 'success')
      return
    }
    const el = document.getElementById(`entry-input-${firstEmpty.id}`)
    if (el) {
      // 确保该分类组展开
      const cat = firstEmpty.category
      if (collapsedAccounts.has(cat)) {
        setCollapsedAccounts((prev) => { const next = new Set(prev); next.delete(cat); return next })
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => el.focus(), 350)
    }
  }

  const [rateModal, setRateModal] = useState<{ currency: string; value: string; rate_date?: string } | null>(null)
  const [rateFetching, setRateFetching] = useState(false)

  function openRate(currency: string) {
    const existing = rates.find((r) => r.currency === currency && r.month === month)
    setRateModal({ currency, value: existing?.rate_to_base ?? '', rate_date: existing?.rate_date })
  }

  async function persistRate(currency: string, val: string, rateDate?: string) {
    const now = new Date().toISOString()
    const existing = rates.find((r) => r.currency === currency && r.month === month)
    if (val === '') {
      if (existing) await db.exchangeRates.delete([month, currency])
      return
    }
    if (existing) {
      await db.exchangeRates.update([month, currency], { rate_to_base: val, rate_date: rateDate, updated_at: now })
    } else {
      await db.exchangeRates.add({ month, currency, rate_to_base: val, rate_date: rateDate, created_at: now, updated_at: now })
    }
  }

  async function autoFetchRate() {
    if (!rateModal) return
    setRateFetching(true)
    try {
      const result = await fetchRatesForMonth(base, month, [rateModal.currency])
      const v = result.rates[rateModal.currency]
      if (v) setRateModal({ ...rateModal, value: v.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''), rate_date: result.rate_date })
      else toast(t('toast.no_rate'), 'warning')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('toast.fetch_failed'), 'error')
    } finally {
      setRateFetching(false)
    }
  }

  async function completeMonth() {
    const now = new Date().toISOString()
    await db.transaction('rw', db.snapshots, async () => {
      for (const acc of allActiveSubAccounts) {
        const draft = stripCommas(balances[acc.id] ?? '')
        const existing = snapshots.find((s) => (s.sub_account_id ?? s.account_id) === acc.id && s.month === month)
        if (draft === '') {
          if (existing) await db.snapshots.delete(existing.id)
        } else {
          try {
            new Decimal(draft)
          } catch { continue }
          if (existing) {
            await db.snapshots.update(existing.id, {
              balance: draft,
              ...(existing.currency ? {} : { currency: acc.currency }),
              recorded_at: now,
              updated_at: now,
            })
          } else {
            await db.snapshots.add({
              id: uuid(), account_id: acc.account_id, sub_account_id: acc.id, month, balance: draft, currency: acc.currency,
              created_at: now, updated_at: now, recorded_at: now,
            })
          }
        }
      }
    })
    try { localStorage.removeItem(`snapworth:draft:${month}`) } catch { /* ignore */ }
    // 自动写入加密备份到已授权的文件夹（未开启/权限失效时静默跳过）
    writeFileAutoBackup().then((res) => {
      if (!res.ok && res.reason === 'permission') {
        toast(t('toast.folder_auth_expired'), 'warning')
      }
    }).catch(() => {})
    // 未开启自动备份时，定期提醒用户手动导出（每天最多一次）
    if (needsBackupReminder({
      hasData: true,
      autoFileBackupEnabled: !!settings?.auto_file_backup,
      lastBackupAt: settings?.last_backup_export_at,
    }) && tryAcquireReminderSlot()) {
      const days = daysSinceBackup(settings?.last_backup_export_at)
      toast(
        days === null
          ? t('entry.no_backup')
          : t('entry.backup_stale', { days }),
        'info',
      )
    }
    // 自动获取汇率（如果开启）
    if (settings?.auto_fetch_rates) {
      const foreignCurs = [...new Set(allActiveSubAccounts.map((a) => a.currency).filter((c) => c !== base))]
      if (foreignCurs.length > 0) {
        const todayStr = new Date().toISOString().slice(0, 10)
        fetchRatesForMonth(base, month, foreignCurs, todayStr).then(async (fetched) => {
          const now = new Date().toISOString()
          for (const [cur, rate] of Object.entries(fetched.rates)) {
            const rateStr = rate.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
            const existing = await db.exchangeRates.get([month, cur])
            if (existing) {
              await db.exchangeRates.update([month, cur], { rate_to_base: rateStr, rate_date: fetched.rate_date, updated_at: now })
            } else {
              await db.exchangeRates.add({ month, currency: cur, rate_to_base: rateStr, rate_date: fetched.rate_date, created_at: now, updated_at: now })
            }
          }
        }).catch((e) => {
          console.warn('自动获取汇率失败:', e)
        })
      }
    }
    navigate(`/review/${month}`)
  }

  function goPrev() { navigate(`/entry/${prevMonth(month)}`) }
  function goNext() {
    const nm = nextMonth(month)
    if (nm <= currentMonth()) navigate(`/entry/${nm}`)
  }

  const swipeRef = useRef<HTMLDivElement>(null)
  useSwipeGesture(swipeRef, {
    onLeft: goNext,
    onRight: goPrev,
  })

  /** 输入框 focus 时：显示纯数字（去逗号） */
  const [focusedInput, setFocusedInput] = useState<string | null>(null)

  /** 获取输入框的显示值 */
  function getInputDisplay(accId: string, rawVal: string): string {
    if (rawVal === '') return ''
    if (focusedInput === accId) return stripCommas(rawVal)
    // 失焦时：如果是有效数字则千分位格式化
    try {
      const d = new Decimal(stripCommas(rawVal))
      const fixed = d.toFixed(2)
      return addCommas(fixed)
    } catch {
      return rawVal
    }
  }

  const ready = accountsReady && subAccountsReady
  if (!ready) {
    return (
      <div className="px-4 pt-4">
        <Skeleton width="4rem" height="1.75rem" className="mb-4" />
        <div className="card p-4 mb-3 space-y-3">
          <Skeleton width="100%" height="4rem" />
          <Skeleton width="100%" height="0.375rem" />
        </div>
        <div className="space-y-4 mt-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton width="5rem" height="0.75rem" />
              <div className="card divide-y divide-slate-100 dark:divide-slate-800">
                {Array.from({ length: 3 }).map((__, j) => (
                  <div key={j} className="p-3.5 flex items-center gap-3">
                    <Skeleton width="2.25rem" height="2.25rem" className="rounded-xl" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton width="60%" height="0.875rem" />
                      <Skeleton width="40%" height="0.75rem" />
                    </div>
                    <Skeleton width="7rem" height="2.25rem" className="rounded-lg" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (allActiveSubAccounts.length === 0) {
    return (
      <div className="px-4 pt-4">
        <h1 className="text-2xl font-bold mb-4">{t('entry.title')}</h1>
        <div className="card p-8 text-center">
          <p className="text-slate-500 mb-4">{t('entry.no_accounts')}</p>
          <Link to="/accounts/new" className="btn-primary">{t('entry.add_account')}</Link>
        </div>
      </div>
    )
  }

  const progressPct = allActiveSubAccounts.length > 0 ? Math.round((completedCount / allActiveSubAccounts.length) * 100) : 0

  return (
    <div ref={swipeRef} className="pb-4">
      <div className="sticky top-0 z-30 bg-slate-50/90 dark:bg-slate-950/90 backdrop-blur px-4 lg:px-8 pt-[max(1rem,var(--safe-top))] pb-2">
        {/* 月份导航 */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={goPrev} className="btn-ghost p-2 -ml-2"><ChevronLeft size={20} /></button>
          <button
            onClick={() => setShowMonthPicker(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 -mx-3 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors group"
          >
            <span className="text-lg font-bold">{formatMonth(month)}</span>
            <ChevronDown size={16} className="text-slate-400 group-hover:text-brand-500 transition-colors" />
          </button>
          <button onClick={goNext} disabled={month >= currentMonth()} className="btn-ghost p-2 -mr-2 disabled:opacity-30">
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="card p-3.5 mb-3">
          {/* 折叠态：净资产 + 进度 + 按钮 */}
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs text-slate-500">{t('entry.net_worth_label')}</div>
              <div className="text-2xl font-bold tabular-nums">
                {formatMoney(currentSummary.networth, base, hide)}
              </div>
            </div>
            <div className="text-right">
              {change ? (
                <>
                  <div className={`text-sm font-medium tabular-nums ${changeColor}`}>
                    {positive ? '+' : ''}{formatMoney(change, base, hide)}
                    {changePct !== null && ` (${positive ? '+' : ''}${changePct.toFixed(1)}%)`}
                  </div>
                  <div className="text-xs text-slate-400">{priorLabel}</div>
                </>
              ) : (
                <div className="text-xs text-slate-400">{t('entry.no_comparison')}</div>
              )}
            </div>
          </div>

          {/* 进度条 */}
          <div className="mt-2.5">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{t('entry.progress', { filled: completedCount, total: allActiveSubAccounts.length })}</span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* 资产负债详情 + 最近记录时间 */}
          <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
            <div className="flex justify-between text-xs text-slate-400">
              <span>{t('dashboard.assets_total')} {formatMoney(currentSummary.assets, base, hide)}</span>
              <span>{t('dashboard.liabilities_total')} {formatMoney(currentSummary.liabilities, base, hide)}</span>
            </div>
            {lastRecordedAt && (
              <div className="text-[10px] text-slate-400 text-center">
                {t('entry.recorded_at', {
                  date: new Date(lastRecordedAt).toLocaleDateString(localeTag(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={scrollToNextEmpty} className="btn-secondary text-sm px-3" title={t('entry.jump_next_empty')}>
            <SkipForward size={16} />
          </button>
          <button onClick={fillLatest} className="btn-secondary flex-1 text-sm">
            <Copy size={16} /> {t('entry.fill_recent')}
          </button>
          <button onClick={completeMonth} className="btn-primary flex-1 text-sm">
            <Check size={16} /> {hasUnsavedChanges ? t('entry.finish_save') : t('entry.finish')}
          </button>
        </div>
      </div>

      <div ref={contentRef} className="px-4 lg:px-8 pt-3 space-y-4">
        {groupedByAccount.map(([accountId, { account, subs }]) => {
          const collapsed = collapsedAccounts.has(accountId)
          const filledInAccount = subs.filter((a) => balances[a.id] !== undefined && balances[a.id] !== '').length
          const totalBal = subs.reduce((sum, s) => {
            const val = balances[s.id] ? stripCommas(balances[s.id]) : '0'
            const n = parseFloat(val)
            if (isNaN(n)) return sum
            return sum + (s.type === 'liability' ? -Math.abs(n) : n)
          }, 0)
          return (
            <div key={accountId}>
              <button
                onClick={() => {
                  const next = new Set(collapsedAccounts)
                  if (collapsed) next.delete(accountId); else next.add(accountId)
                  setCollapsedAccounts(next)
                }}
                className="text-xs font-medium text-slate-500 mb-2 px-1 flex items-center gap-2 w-full text-left hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: account?.color ?? '#64748b' }}
                >
                  <Icon name={account?.icon ?? 'wallet'} size={14} />
                </div>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{account?.name ?? accountId}</span>
                <span className="ml-auto text-[11px] tabular-nums text-slate-400">
                  {totalBal !== 0 ? formatMoney(totalBal, base, hide) : ''}
                </span>
                <span className={`text-[10px] font-medium ${filledInAccount === subs.length ? 'text-green-500' : filledInAccount > 0 ? 'text-brand-500' : 'text-slate-400'}`}>
                  {filledInAccount === subs.length ? '✓ ' : ''}{filledInAccount}/{subs.length}
                </span>
                <ChevronDown size={12} className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} />
              </button>
              {!collapsed && (
                <div className="card divide-y divide-slate-100 dark:divide-slate-800">
                  {subs.map((sub) => {
                    const rawVal = balances[sub.id] ?? ''
                    const displayVal = getInputDisplay(sub.id, rawVal)
                    const prevMonthSnap = snapshots.find((s) => (s.sub_account_id ?? s.account_id) === sub.id && s.month === prevMonth(month))
                    const baselineSnap = prevMonthSnap ?? latestByAccount.get(sub.account_id)
                    const baselineLabel = prevMonthSnap
                      ? t('entry.prev_month_short')
                      : (baselineSnap ? t('entry.recent_month', { month: baselineSnap.month.slice(5) }) : '')
                    const cleanVal = stripCommas(rawVal)
                    const diff = cleanVal && baselineSnap ? new Decimal(cleanVal).sub(new Decimal(baselineSnap.balance)) : null
                    const diffUp = diff ? (sub.type === 'asset' ? diff.gte(0) : diff.lte(0)) : false
                    const diffColor = !diff || diff.isZero() ? 'text-slate-400'
                      : invert
                        ? (diffUp ? 'text-green-500' : 'text-red-500')
                        : (diffUp ? 'text-red-500' : 'text-green-500')
                    const filled = rawVal !== ''
                    const canFillLatest = !!baselineSnap && !filled
                    return (
                      <div key={sub.id} className={`p-3.5 flex items-center gap-3 transition-colors ${filled ? 'bg-brand-50/40 dark:bg-brand-950/20' : 'opacity-60'}`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 transition-opacity ${filled ? '' : 'opacity-50'}`} style={{ backgroundColor: subAccountColor(sub, account?.color) }}>
                          <Icon name={subAccountIcon(sub)} size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm truncate flex items-center gap-1.5 ${filled ? 'font-medium' : 'font-normal text-slate-500 dark:text-slate-400'}`}>
                            {subAccountName(sub, account?.name)}
                            {sub.currency !== base && (
                              (() => {
                                const r = rates.find((x) => x.currency === sub.currency && x.month === month)
                                return (
                                  <button
                                    onClick={() => openRate(sub.currency)}
                                    className={`text-[10px] px-1.5 py-0.5 rounded ${r ? 'bg-slate-100 dark:bg-slate-800 text-slate-500' : 'bg-amber-100 dark:bg-amber-900 text-amber-600'} text-[10px]`}
                                    title={r
                                      ? `${t('entry.rate_tip', { currency: sub.currency, rate: r.rate_to_base, base })}${r.rate_date ? `\n${t('entry.rate_data_date', { date: r.rate_date })}` : ''}`
                                      : t('entry.click_set_rate')}
                                  >
                                    {sub.currency}{r ? ` ${r.rate_to_base}` : ' ⚠'}
                                  </button>
                                )
                              })()
                            )}
                          </div>
                          {baselineSnap && (
                            <div className="text-xs text-slate-400 tabular-nums">
                              {baselineLabel} {formatMoney(baselineSnap.balance, baselineSnap.currency ?? sub.currency)}
                              {diff && !diff.isZero() && (
                                <span className={diffColor}>
                                  {' '}({diff.gte(0) ? '+' : ''}{diff.toFixed(2)})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="relative flex items-center gap-1.5">
                          {canFillLatest && (
                            <button
                              type="button"
                              onClick={() => fillOneLatest(sub.id)}
                              title={t("entry.fill_latest")}
                              className="shrink-0 text-[10px] px-1.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                              {t('entry.same_as_above')}
                            </button>
                          )}
                          <div className="relative">
                            <input
                              id={`entry-input-${sub.id}`}
                              type="text"
                              inputMode="decimal"
                              value={displayVal}
                              onFocus={() => setFocusedInput(sub.id)}
                              onBlur={() => {
                                setFocusedInput(null)
                                // 失焦时格式化
                                const clean = stripCommas(rawVal)
                                if (clean !== '') {
                                  try {
                                    new Decimal(clean)
                                    setBalances((p) => ({ ...p, [sub.id]: addCommas(new Decimal(clean).toFixed(2)) }))
                                  } catch {
                                    // 无效数字保持原值
                                  }
                                }
                              }}
                              onChange={(e) => {
                                const input = e.target.value
                                // 允许输入数字、小数点、逗号
                                const cleaned = input.replace(/[^0-9.,.-]/g, '')
                                setBalances((p) => ({ ...p, [sub.id]: cleaned }))
                              }}
                              placeholder="0.00"
                              className={`w-28 text-right rounded-lg border pl-2.5 pr-7 py-1.5 text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500 bg-transparent transition-colors ${filled ? 'border-brand-200 dark:border-brand-800 font-medium text-slate-800 dark:text-slate-200' : 'border-dashed border-slate-300 dark:border-slate-600 text-slate-400'}`}
                            />
                            {filled
                              ? <span className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-500"><Check size={14} /></span>
                              : <span className="absolute right-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 dark:bg-amber-500" />
                            }
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 月份选择器 */}
      {showMonthPicker && (
        <MonthPicker
          month={month}
          onSelect={(m) => navigate(`/entry/${m}`)}
          onClose={() => setShowMonthPicker(false)}
        />
      )}

      {rateModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 animate-backdrop-in" onClick={() => setRateModal(null)}>
          <div className="card w-full max-w-sm p-5 animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t('entry.exchange_rate')}</h3>
              <button onClick={() => setRateModal(null)} className="p-1 text-slate-400"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              1 {rateModal.currency} = ? {base}
              {rateModal.rate_date && (
                <span className="block text-[11px] text-slate-400 mt-1">{t('entry.rate_date')}：{rateModal.rate_date}</span>
              )}
            </p>
            <input
              type="number"
              step="0.0001"
              autoFocus
              className="input text-lg mb-3"
              value={rateModal.value}
              onChange={(e) => setRateModal({ ...rateModal, value: e.target.value })}
            />
            <div className="flex gap-2">
              <button onClick={autoFetchRate} disabled={rateFetching} className="btn-secondary flex-1">
                {rateFetching ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {t('entry.auto_fetch')}
              </button>
              <button
                onClick={async () => {
                  const val = rateModal.value.trim()
                  if (val) { try { new Decimal(val) } catch { toast(t('toast.invalid_number'), 'warning'); return } }
                  await persistRate(rateModal.currency, val, rateModal.rate_date)
                  setRateModal(null)
                }}
                className="btn-primary flex-1"
              >
                {t('common.save')}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-3">
              {t('entry.rate_source')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
