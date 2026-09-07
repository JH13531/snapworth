import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PenLine, ChevronRight, TrendingUp, TrendingDown, Minus, Shield, Target, AlertCircle, CalendarPlus, Plus } from 'lucide-react'
import { useAccountsWithReady, useSubAccountsWithReady, useSnapshots, useExchangeRates } from '@/hooks/useData'
import { useSettingsStore } from '@/store/settings'
import { needsBackupReminder, daysSinceBackup } from '@/lib/backup-health'
import { summarizeMonth, formatMoney, pctChange, allMonths, buildSnapshotMap, snapCurrency, nearestPriorMonth, resolveChartRange } from '@/lib/money'
import { currentMonth, prevMonth, formatMonth, missingMonths } from '@/lib/date'
import { projectGoal, type NetWorthPoint } from '@/lib/projection'
import NetWorthChart from '@/components/NetWorthChart'
import CompositionChart from '@/components/CompositionChart'
import AnimatedNumber from '@/components/AnimatedNumber'
import GoalForecast from '@/components/GoalForecast'
import { DashboardSkeleton } from '@/components/Skeleton'
import { useTranslation } from '@/lib/i18n'
import Decimal from 'decimal.js'

export default function DashboardPage() {
  const [dismissedBackupTip, setDismissedBackupTip] = useState(() => {
    try {
      const dismissedAt = localStorage.getItem('snapworth:backup-tip-dismissed-at')
      if (!dismissedAt) return false
      // 30 天后重新提醒
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
      return Date.now() - parseInt(dismissedAt) < THIRTY_DAYS
    } catch { return false }
  })
  const { accounts, ready: accountsReady } = useAccountsWithReady()
  const { subAccounts, ready: subAccountsReady } = useSubAccountsWithReady()
  const snapshots = useSnapshots()
  const rates = useExchangeRates()
  const { settings } = useSettingsStore()
  const base = settings?.base_currency ?? 'CNY'
  const hide = settings?.privacy_mode ?? false
  const invert = settings?.invert_change_color ?? false
  const { t } = useTranslation()
  const navigate = useNavigate()
  const month = currentMonth()
  const [chartRange, setChartRange] = useState<number | 'year' | undefined>(12)

  const snapMap = useMemo(() => buildSnapshotMap(snapshots), [snapshots])
  const hasCurrentMonthData = subAccounts.some((sa) => !sa.archived && sa.include_in_networth && snapMap.has(`${sa.account_id}|${month}|${sa.id}`))

  const current = useMemo(() => summarizeMonth(accounts, snapshots, rates, month, base, subAccounts), [accounts, subAccounts, snapshots, rates, month, base])
  const priorMonthKey = nearestPriorMonth(snapshots, month)
  const prev = useMemo(
    () => priorMonthKey ? summarizeMonth(accounts, snapshots, rates, priorMonthKey, base, subAccounts) : null,
    [accounts, subAccounts, snapshots, rates, priorMonthKey, base],
  )
  const yearStart = `${new Date().getFullYear()}-01`
  const yearStartSummary = useMemo(() => summarizeMonth(accounts, snapshots, rates, yearStart, base, subAccounts), [accounts, subAccounts, snapshots, rates, yearStart, base])

  const change = prev ? current.networth.sub(prev.networth) : null
  const changePct = prev ? pctChange(current.networth, prev.networth) : null
  const ytdChange = current.networth.sub(yearStartSummary.networth)
  const positive = change?.gte(0) ?? true
  const isZero = change?.isZero() ?? true
  const hasSnapshots = snapshots.length > 0

  // 找出因缺少汇率而未计入总资产的账户
  const missingRateAccounts = useMemo(() => {
    if (current.missingRates.length === 0) return []
    return accounts
      .filter((a) => !a.archived && a.include_in_networth)
      .filter((a) => {
        const snap = snapMap.get(`${a.id}|${month}`)
        if (!snap || !snap.balance) return false
        const cur = snapCurrency(snap, a)
        return cur !== base && current.missingRates.includes(cur)
      })
      .map((a) => {
        const snap = snapMap.get(`${a.id}|${month}`)!
        return { name: a.name, currency: snapCurrency(snap, a) }
      })
  }, [accounts, snapshots, snapMap, month, base, current.missingRates])
  // 备份健康提醒：未开启自动备份、且超过 30 天没有留存时才显示。
  // 注意：浏览器内的数据副本不构成真正的备份——清缓存时会和主数据一起丢失。
  const backupStale = needsBackupReminder({
    hasData: hasSnapshots,
    autoFileBackupEnabled: !!settings?.auto_file_backup,
    lastBackupAt: settings?.last_backup_export_at,
  })
  const daysSince = daysSinceBackup(settings?.last_backup_export_at)
  const showBackupTip = hasSnapshots && !dismissedBackupTip && backupStale

  const changeColor = isZero ? 'text-slate-400' : invert
    ? (positive ? 'text-green-500' : 'text-red-500')
    : (positive ? 'text-red-500' : 'text-green-500')
  const priorLabel = priorMonthKey === prevMonth(month) ? t('dashboard.mom') : priorMonthKey ? t('dashboard.compare_with', { month: priorMonthKey.slice(5) }) : ''

  const months = allMonths(snapshots)
  const hasData = months.length > 0 && accounts.length > 0

  // 计算连续记录月数（streak）
  const streak = useMemo(() => {
    if (months.length === 0) return 0
    const sorted = [...months].sort()
    let count = 1
    for (let i = sorted.length - 1; i > 0; i--) {
      const expected = prevMonth(sorted[i])
      if (sorted[i - 1] === expected) {
        count++
      } else {
        break
      }
    }
    // 检查最后一个月是否是当前月或上月（否则 streak 已断）
    const lastMonth = sorted[sorted.length - 1]
    const cm = currentMonth()
    const pm = prevMonth(cm)
    if (lastMonth !== cm && lastMonth !== pm) return 0
    return count
  }, [months])

  // 净资产目标进度
  const goalInfo = useMemo(() => {
    const goalStr = settings?.net_worth_goal
    if (!goalStr) return null
    try {
      const goal = new Decimal(goalStr)
      if (goal.isZero()) return null
      const pct = current.networth.div(goal).mul(100)
      const remaining = goal.sub(current.networth)
      const achieved = remaining.lte(0)
      const pctClamped = Math.min(pct.toNumber(), 100)
      return { goal, pct, pctClamped, remaining, achieved }
    } catch { return null }
  }, [settings?.net_worth_goal, current.networth])

  // 目标达成预测：只用最近 12 个有数据的月份推算平均月增速
  const netWorthSeries = useMemo<NetWorthPoint[]>(() => {
    if (months.length === 0) return []
    return months.slice(-12).map((m) => ({
      month: m,
      networth: summarizeMonth(accounts, snapshots, rates, m, base, subAccounts).networth,
    }))
  }, [months, accounts, subAccounts, snapshots, rates, base])

  const projection = useMemo(
    () => (goalInfo && !goalInfo.achieved ? projectGoal(netWorthSeries, goalInfo.remaining, 12) : null),
    [goalInfo, netWorthSeries],
  )

  // 当前图表区间内的断档月份，用于「补录」入口
  const chartGaps = useMemo(() => {
    if (months.length < 2) return { recent: [] as string[], total: 0 }
    const shown = resolveChartRange(months, chartRange)
    if (shown.length < 2) return { recent: [] as string[], total: 0 }
    const start = shown[0]
    const end = shown[shown.length - 1]
    const inWindow = months.filter((m) => m >= start && m <= end)
    const gaps = missingMonths(inWindow, start, end)
    // 断档可能有几十个月，只把最近 3 个做成按钮，其余用总数概括
    return { recent: gaps.slice(-3), total: gaps.length }
  }, [months, chartRange])

  const filledCount = subAccounts.filter((sa) => !sa.archived && sa.include_in_networth && snapMap.has(`${sa.account_id}|${month}|${sa.id}`)).length
  const totalActive = subAccounts.filter((sa) => !sa.archived && sa.include_in_networth).length
  const entryComplete = totalActive > 0 && filledCount === totalActive

  const ready = accountsReady && subAccountsReady
  if (!ready) {
    return <DashboardSkeleton />
  }

  if (!hasData) {
    return (
      <div className="px-4 pt-8 lg:pt-20 max-w-md mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">{settings?.book_name ?? t('dashboard.my_book')}</h1>
          <p className="text-slate-500">{t('dashboard.tagline')}</p>
        </div>
        <div className="card p-8 lg:p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center mx-auto mb-4">
            <PenLine size={28} className="text-brand-600" />
          </div>
          <p className="text-slate-600 dark:text-slate-300 mb-1">{t('dashboard.empty_title')}</p>
          <p className="text-sm text-slate-400 mb-5">{t('dashboard.empty_desc')}</p>
          <div className="flex gap-2 justify-center">
            <Link to="/accounts/new" className="btn-secondary">{t('dashboard.add_account')}</Link>
            <Link to={`/entry/${month}`} className="btn-primary">{t('dashboard.start_entry')}</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 lg:px-8 pt-6 pb-8">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">{settings?.book_name ?? t('dashboard.my_book')}</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-slate-500">{formatMonth(month)}</p>
            {streak > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium">
                {t('dashboard.streak', { count: streak })}
              </span>
            )}
          </div>
        </div>
        <Link to={`/entry/${month}`} className="btn-primary">
          <PenLine size={16} /> <span className="hidden lg:inline">{entryComplete ? t('dashboard.view_this_month') : t('dashboard.record_this_month')}</span>
        </Link>
      </div>

      <div className="card p-5 lg:p-7 mb-4 lg:mb-6">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="text-sm text-slate-500 mb-1">{t('dashboard.net_worth')}</div>
            {hasCurrentMonthData ? (
              <div className="text-4xl lg:text-5xl font-bold tabular-nums tracking-tight">
                {hide ? '****' : (
                  <AnimatedNumber
                    value={current.networth.toNumber()}
                    format={(v) => formatMoney(v, base)}
                  />
                )}
              </div>
            ) : (
              <div className="text-2xl lg:text-3xl font-medium text-slate-400">{t('dashboard.no_current_data')}</div>
            )}
          </div>
          <div className="flex flex-col lg:items-end gap-2">
            {hasCurrentMonthData && change ? (
              <div className={`flex items-center gap-2 text-base font-medium ${changeColor}`}>
                {isZero ? <Minus size={18} /> : positive ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                <span>
                  {positive ? '+' : ''}{formatMoney(change, base, hide)}
                  {changePct !== null && ` (${positive ? '+' : ''}${changePct.toFixed(1)}%)`}
                </span>
                <span className="text-slate-400 font-normal text-sm">{priorLabel}</span>
              </div>
            ) : hasCurrentMonthData ? (
              <div className="text-sm text-slate-400">{t('dashboard.record_to_compare')}</div>
            ) : null}
            {hasCurrentMonthData && !ytdChange.isZero() && (
              <div className="text-xs text-slate-400">
                {t('dashboard.ytd_change')} {ytdChange.gte(0) ? '+' : ''}{formatMoney(ytdChange, base, hide)}
              </div>
            )}
          </div>
        </div>
        {hasCurrentMonthData ? (
          <div className="grid grid-cols-2 gap-3 mt-5 pt-5 border-t border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500">{t('dashboard.assets_total')}</div>
              <div className="text-lg lg:text-xl font-semibold tabular-nums mt-0.5">
                {hide ? '****' : <AnimatedNumber value={current.assets.toNumber()} format={(v) => formatMoney(v, base)} />}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('dashboard.liabilities_total')}</div>
              <div className="text-lg lg:text-xl font-semibold tabular-nums mt-0.5">
                {hide ? '****' : <AnimatedNumber value={current.liabilities.toNumber()} format={(v) => formatMoney(v, base)} />}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-800">
            <Link to={`/entry/${month}`} className="text-sm text-brand-600 hover:underline font-medium">
              {t('dashboard.go_record_month')}
            </Link>
          </div>
        )}
      </div>

      {/* 缺少汇率警告 */}
      {missingRateAccounts.length > 0 && (
        <div className="card p-4 mb-4 lg:mb-6 border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {t('dashboard.missing_rates_detail', { count: current.missingRates.length })}
              </div>
              <div className="text-xs text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
                {missingRateAccounts.map((a) => `${a.name}（${a.currency}）`).join('、')}
              </div>
            </div>
            <Link
              to="/settings/rates"
              className="shrink-0 text-xs text-amber-700 dark:text-amber-300 font-medium hover:underline flex items-center gap-1 mt-0.5"
            >
              {t('dashboard.go_settings')} <ChevronRight size={14} />
            </Link>
          </div>
        </div>
      )}

      {/* 净资产目标进度 */}
      {goalInfo ? (
        <div className="card p-4 mb-4 lg:mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Target size={16} className="text-brand-500" />
              <span className="text-sm font-medium">{t('dashboard.net_worth_goal')}</span>
            </div>
            <Link to="/settings" className="text-xs text-slate-400 hover:text-slate-600">{t('dashboard.edit')}</Link>
          </div>
          {goalInfo.achieved ? (
            <div className="text-center py-2">
              <div className="text-2xl mb-1">🎉</div>
              <div className="text-sm font-medium text-green-600 dark:text-green-400">{t('dashboard.goal_achieved')}</div>
              <div className="text-xs text-slate-500 mt-1">
                {t('dashboard.current')} {formatMoney(current.networth, base, hide)} · {t('dashboard.goal_label')} {formatMoney(goalInfo.goal, base, hide)}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between mb-1.5">
                <div className="text-xs text-slate-500">
                  {t('dashboard.remaining')} <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">{formatMoney(goalInfo.remaining.abs(), base, hide)}</span>
                </div>
                {/* 进度百分比是相对值，隐私模式下保持可见 */}
                <div className="text-xs text-slate-500 tabular-nums">
                  {goalInfo.pct.toFixed(1)}%
                </div>
              </div>
              <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    goalInfo.pctClamped >= 80 ? 'bg-yellow-400' : goalInfo.pctClamped >= 50 ? 'bg-blue-400' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                  style={{ width: `${goalInfo.pctClamped}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <div className="text-[11px] text-slate-400">{t('dashboard.current')} {formatMoney(current.networth, base, hide)}</div>
                <div className="text-[11px] text-slate-400">{t('dashboard.goal_label')} {formatMoney(goalInfo.goal, base, hide)}</div>
              </div>
              {projection && (
                <GoalForecast
                  projection={projection}
                  remaining={goalInfo.remaining}
                  base={base}
                  hide={hide}
                />
              )}
            </>
          )}
        </div>
      ) : (
        <Link to="/settings" className="card p-4 mb-4 lg:mb-6 flex items-center gap-3 hover:border-brand-500 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/50 flex items-center justify-center shrink-0">
            <Target size={20} className="text-brand-400" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm text-slate-600 dark:text-slate-400">{t('dashboard.set_goal')}</div>
            <div className="text-xs text-slate-400">{t('dashboard.track_milestone')}</div>
          </div>
          <ChevronRight size={18} className="text-slate-300" />
        </Link>
      )}

      {!entryComplete && (
        <Link to={`/entry/${month}`} className="card p-4 mb-4 lg:mb-6 flex items-center gap-3 hover:border-brand-500">
          <div className="w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-900 flex items-center justify-center shrink-0">
            <PenLine size={20} className="text-brand-600" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">{t('dashboard.entry_incomplete')}</div>
            <div className="text-xs text-slate-500">{t('dashboard.filled_count', { filled: filledCount, total: totalActive })}</div>
          </div>
          <ChevronRight size={18} className="text-slate-400" />
        </Link>
      )}

      {showBackupTip && (
        <div className="card p-4 mb-4 lg:mb-6 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
              <Shield size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-amber-800 dark:text-amber-200">
                {t('dashboard.backup_title')}
              </div>
              <div className="text-xs text-amber-700 dark:text-amber-300/80 mt-0.5 leading-relaxed">
                {daysSince === null
                  ? t('dashboard.backup_desc')
                  : t('dashboard.backup_desc_stale').replace('{days}', String(daysSince))}
              </div>
              <div className="flex gap-2 mt-3">
                <Link to="/settings?action=export" className="text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline">
                  {t('dashboard.export_backup')}
                </Link>
                <button
                  onClick={() => {
                    try { localStorage.setItem('snapworth:backup-tip-dismissed-at', String(Date.now())) } catch {}
                    setDismissedBackupTip(true)
                  }}
                  className="text-xs text-amber-600/70 dark:text-amber-400/70 hover:underline"
                >
                  {t('dashboard.got_it')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="card p-4 lg:p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-baseline gap-2">
              <h2 className="font-semibold">{t('dashboard.net_worth_trend')}</h2>
              <span className="text-[10px] text-slate-400">{t('dashboard.click_data_point')}</span>
            </div>
            <div className="flex gap-1 text-xs">
              {[{ l: t('dashboard.last_12_months'), v: 12 }, { l: t('dashboard.this_year'), v: 'year' as const }, { l: t('dashboard.all_time'), v: undefined }].map((r) => (
                <button
                  key={r.l}
                  onClick={() => setChartRange(r.v)}
                  className={`px-2.5 py-1 rounded-lg ${chartRange === r.v ? 'bg-brand-100 dark:bg-brand-900 text-brand-600' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  {r.l}
                </button>
              ))}
            </div>
          </div>
          <NetWorthChart
            onMonthClick={(m) => navigate(`/review/${m}`)}
            onMonthFill={(m) => navigate(`/entry/${m}`)}
            accounts={accounts}
            snapshots={snapshots}
            rates={rates}
            base={base}
            hide={hide}
            invertColor={invert}
            range={chartRange}
          />
          {chartGaps.total > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 flex-wrap">
                <CalendarPlus size={14} className="text-slate-400 shrink-0" />
                <span className="text-[11px] text-slate-500">
                  {t('dashboard.gap_hint', { count: chartGaps.total })}
                </span>
                {chartGaps.recent.map((m) => (
                  <Link
                    key={m}
                    to={`/entry/${m}`}
                    className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-brand-100 dark:hover:bg-brand-900 hover:text-brand-600 transition-colors tabular-nums"
                  >
                    <Plus size={10} /> {m}
                  </Link>
                ))}
                {chartGaps.total > chartGaps.recent.length && (
                  <span className="text-[11px] text-slate-400">…</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card p-4 lg:p-5">
          <h2 className="font-semibold mb-2">{t('dashboard.asset_composition')}</h2>
          <CompositionChart
            accounts={accounts}
            subAccounts={subAccounts}
            snapshots={snapshots}
            rates={rates}
            month={month}
            base={base}
            hide={hide}
            type="asset"
          />
        </div>

      </div>
    </div>
  )
}
