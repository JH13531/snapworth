import { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Plus, Info, Sparkles } from 'lucide-react'
import { useAccounts, useSnapshots, useExchangeRates, useMonthlyReview, useSubAccounts } from '@/hooks/useData'
import { useSettingsStore } from '@/store/settings'
import { db } from '@/db'
import { summarizeMonth, formatMoney, pctChange, nearestPriorMonth, assessDebtHealth } from '@/lib/money'
import { prevMonth, formatMonth } from '@/lib/date'
import TopChangesCard from '@/components/TopChangesCard'
import { writeFileAutoBackup } from '@/lib/backup-file'
import { needsBackupReminder, daysSinceBackup } from '@/lib/backup-health'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/lib/i18n'
import Decimal from 'decimal.js'

const TAGS = ['工资', '奖金', '大额支出', '投资波动', '还贷', '转账调整', '其他']

/**
 * 预设标签在库里存的是中文（保持历史数据兼容），展示时按当前语言翻译。
 * 用户自建的标签不在表里，原样显示。
 */
const TAG_KEYS: Record<string, string> = {
  工资: 'tag.salary',
  奖金: 'tag.bonus',
  大额支出: 'tag.big_expense',
  投资波动: 'tag.investment',
  还贷: 'tag.repayment',
  转账调整: 'tag.transfer',
  其他: 'tag.other',
}

export default function ReviewPage() {
  const { month = '' } = useParams()
  const navigate = useNavigate()
  const accounts = useAccounts()
  const subAccounts = useSubAccounts()
  const snapshots = useSnapshots()
  const rates = useExchangeRates()
  const existingReview = useMonthlyReview(month)
  const { settings } = useSettingsStore()
  const { toast } = useToast()
  const base = settings?.base_currency ?? 'CNY'
  const hide = settings?.privacy_mode ?? false
  const invert = settings?.invert_change_color ?? false
  const { t } = useTranslation()

  const [note, setNote] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const [showCompleteModal, setShowCompleteModal] = useState(false)

  useEffect(() => {
    setNote(existingReview?.note ?? '')
    setSelectedTags(existingReview?.tags ?? [])
  }, [existingReview?.note, existingReview?.tags])

  const knownTags = useMemo(() => {
    const set = new Set<string>(TAGS)
    for (const t of existingReview?.tags ?? []) set.add(t)
    for (const t of selectedTags) set.add(t)
    return [...set]
  }, [existingReview?.tags, selectedTags])

  function addTag(raw: string) {
    const tag = raw.trim()
    if (!tag) return
    setSelectedTags((prev) => prev.includes(tag) ? prev : [...prev, tag])
    setNewTag('')
  }

  const current = useMemo(() => summarizeMonth(accounts, snapshots, rates, month, base, subAccounts), [accounts, subAccounts, snapshots, rates, month, base])
  const priorMonthKey = nearestPriorMonth(snapshots, month)
  const prev = useMemo(
    () => priorMonthKey ? summarizeMonth(accounts, snapshots, rates, priorMonthKey, base, subAccounts) : null,
    [accounts, subAccounts, snapshots, rates, priorMonthKey, base],
  )

  const change = prev ? current.networth.sub(prev.networth) : null
  const changePct = prev ? pctChange(current.networth, prev.networth) : null
  const positive = change?.gte(0) ?? true
  const changeColor = !change || change.isZero() ? 'text-slate-400' : invert
    ? (positive ? 'text-green-500' : 'text-red-500')
    : (positive ? 'text-red-500' : 'text-green-500')
  const priorLabel = priorMonthKey === prevMonth(month)
    ? t('review.mom_last_month')
    : priorMonthKey ? t('review.compare_with', { month: priorMonthKey.slice(5) }) : ''

  const debtRatio = current.assets.isZero() ? new Decimal(0) : current.liabilities.div(current.assets).mul(100)
  const debtHealth = assessDebtHealth(
    debtRatio,
    settings?.health_threshold_warn ?? 50,
    settings?.health_threshold_danger ?? 70,
  )

  // 复盘完成是强提醒备份的最佳时机：数据刚变完整，用户也最有成就感
  const backupDaysSince = daysSinceBackup(settings?.last_backup_export_at)
  const showBackupNag = needsBackupReminder({
    hasData: true,
    autoFileBackupEnabled: !!settings?.auto_file_backup,
    lastBackupAt: settings?.last_backup_export_at,
  })

  async function saveAndFinish() {
    if (!month) {
      navigate('/')
      return
    }
    const now = new Date().toISOString()
    const existing = await db.monthlyReviews.get(month)
    await db.monthlyReviews.put({
      month,
      note: note.trim(),
      tags: selectedTags,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    })
    // 复盘是低频但重要的数据变更，保存后立即写一份自动备份（force 绕过 60 秒节流）
    writeFileAutoBackup({ force: true }).then((res) => {
      if (!res.ok && res.reason === 'permission') {
        toast(t('toast.folder_auth_expired'), 'warning')
      }
    }).catch(() => {})
    setShowCompleteModal(true)
  }

  return (<>
    <div className="px-4 lg:px-8 pt-4 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <Link to={`/entry/${month}`} className="btn-ghost p-2 -ml-2"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold">{t('review.month_suffix', { month: formatMonth(month) })}</h1>
      </div>

      <div className="card p-5 mb-4 text-center">
        <div className="text-sm text-slate-500 mb-1">{t("review.month_net_worth")}</div>
        <div className="text-4xl font-bold tabular-nums mb-2">{formatMoney(current.networth, base, hide)}</div>
        {change ? (
          <div className={`inline-flex items-center gap-1.5 text-sm font-medium ${changeColor}`}>
            {positive ? '↑' : '↓'} {positive ? '+' : ''}{formatMoney(change, base, hide)}
            {changePct !== null && ` (${positive ? '+' : ''}${changePct.toFixed(1)}%)`}
            <span className="text-slate-400 font-normal">{priorLabel}</span>
          </div>
        ) : (
          <div className="text-sm text-slate-400">{t('review.first_month')}</div>
        )}
      </div>

      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">{t('review.overview')}</div>
          <div className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            debtHealth.level === 'healthy' ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400' :
            debtHealth.level === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-600 dark:text-yellow-400' :
            'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
          }`}>
            {t('review.debt_level')} · {debtHealth.label}
          </div>
        </div>
        <div className="space-y-2.5">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">{t('review.assets')}</span>
              <span className="font-medium tabular-nums">{formatMoney(current.assets, base, hide)}</span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: current.assets.isZero() ? '0%' : '100%' }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">{t('review.liabilities')}</span>
              <span className="font-medium tabular-nums">{formatMoney(current.liabilities, base, hide)}</span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  debtHealth.level === 'healthy' ? 'bg-green-500' :
                  debtHealth.level === 'warning' ? 'bg-yellow-500' :
                  'bg-red-500'
                }`}
                style={{ width: current.assets.isZero() ? '0%' : `${Math.min(debtRatio.toNumber(), 100)}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 group relative cursor-help">
          <div className="text-xs text-slate-500">
            {t('review.debt_ratio_short')} <span className={`font-semibold ${debtHealth.color}`}>{debtRatio.toFixed(1)}%</span>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <Info size={12} />
            {t('review.criteria')}
          </div>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 rounded-lg bg-slate-800 dark:bg-slate-700 text-white text-xs leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
            <div className="font-semibold mb-1.5">{t("review.debt_ratio")}{t("review.criteria")}</div>
            <div>· <span className="text-green-400">{t('review.healthy')}</span>{t("review.debt_ratio_short")} &lt; {settings?.health_threshold_warn ?? 50}%</div>
            <div>· <span className="text-yellow-400">{t('review.warning')}</span>{settings?.health_threshold_warn ?? 50}% ≤ {t("review.debt_ratio_short")} &lt; {settings?.health_threshold_danger ?? 70}%</div>
            <div>· <span className="text-red-400">{t('review.danger')}</span>{t("review.debt_ratio_short")} ≥ {settings?.health_threshold_danger ?? 70}%</div>
            <div className="mt-1.5 text-slate-400">{t('review.formula')}</div>
            <div className="mt-1 text-slate-400">{t('review.custom_threshold')}</div>
          </div>
        </div>
      </div>

      {priorMonthKey && (
        <div className="card p-4 mb-4">
          <TopChangesCard
            accounts={accounts}
            subAccounts={subAccounts}
            snapshots={snapshots}
            rates={rates}
            month={month}
            priorMonth={priorMonthKey}
            base={base}
            hide={hide}
            invert={invert}
            subtitle={t("review.top_changes_subtitle")}
          />
        </div>
      )}

      <div className="card p-4 mb-4">
        <h2 className="font-semibold text-sm mb-2">{t('review.monthly_note')}</h2>
        <textarea
          className="input min-h-[80px] resize-none"
          placeholder={t("review.note_placeholder")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2 mt-3 items-center">
          {knownTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])}
              className={`px-3 py-1 rounded-full text-xs transition-colors ${selectedTags.includes(tag) ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
            >
              {TAG_KEYS[tag] ? t(TAG_KEYS[tag]) : tag}
            </button>
          ))}
          {showTagInput ? (
            <input
              autoFocus
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addTag(newTag); setShowTagInput(false) }
                if (e.key === 'Escape') setShowTagInput(false)
              }}
              onBlur={() => { addTag(newTag); setShowTagInput(false) }}
              placeholder={t('review.tag_placeholder')}
              maxLength={10}
              className="px-2.5 py-1 rounded-full text-xs border border-slate-300 dark:border-slate-700 bg-transparent w-24 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          ) : (
            <button
              onClick={() => setShowTagInput(true)}
              className="px-2.5 py-1 rounded-full text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-0.5"
            >
              <Plus size={12} /> {t('review.tags')}
            </button>
          )}
        </div>
      </div>

      <div className="text-xs text-slate-400 text-center mb-3">
        {t('review.backup_tip')}
      </div>
      <button onClick={saveAndFinish} className="btn-primary w-full py-3 text-base">
        <Check size={18} /> {t('review.complete_review')}
      </button>

    {showCompleteModal && (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4 animate-backdrop-in" onClick={() => setShowCompleteModal(false)}>
        <div className="card w-full max-w-sm p-6 text-center animate-modal-in" onClick={(e) => e.stopPropagation()}>
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={32} className="text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-xl font-bold mb-1">{t('review.done_title', { month: formatMonth(month) })}</h2>
          <p className="text-sm text-slate-500 mb-5">{t('review.done_desc')} 🎉</p>

          <div className="grid grid-cols-2 gap-3 mb-5 text-left">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
              <div className="text-xs text-slate-400 mb-0.5">{t("review.month_net_worth")}</div>
              <div className="text-base font-bold tabular-nums">{formatMoney(current.networth, base, hide)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
              <div className="text-xs text-slate-400 mb-0.5">{t('review.vs_last_month')}</div>
              <div className={`text-base font-bold tabular-nums ${changeColor}`}>
                {change ? (
                  <>
                    {positive ? "+" : ""}{changePct !== null ? `${changePct.toFixed(1)}%` : ""}
                  </>
                ) : "-"}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {showBackupNag && (
              <div className="mb-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-left">
                <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {t('review.no_backup_warn')}
                </div>
                <div className="text-xs text-amber-700 dark:text-amber-300/80 mt-1 leading-relaxed">
                  {backupDaysSince === null
                    ? t('review.no_backup_desc')
                    : t('review.backup_stale', { days: backupDaysSince })}
                </div>
                <button
                  onClick={() => { setShowCompleteModal(false); navigate('/settings?action=export') }}
                  className="btn-primary w-full py-2.5 mt-3"
                >
                  {t('review.backup_now')}
                </button>
                <button
                  onClick={() => { setShowCompleteModal(false); navigate('/') }}
                  className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 mt-1"
                >
                  {t('review.later')}
                </button>
              </div>
            )}
            <button
              onClick={() => navigate("/")}
              className={showBackupNag ? 'btn-secondary w-full py-2.5' : 'btn-primary w-full py-2.5'}
            >
              {t('review.view_trend')}
            </button>
            <button
              onClick={() => navigate(`/entry/${month}`)}
              className="btn-secondary w-full py-2.5"
            >
              {t('review.back')}
            </button>
          </div>
        </div>
      </div>
    )}
    </div>


  </>
  )
}
