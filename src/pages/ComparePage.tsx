import { useState, useEffect, useMemo } from 'react'
import { ArrowLeftRight, ChevronDown, Info } from 'lucide-react'
import { useAccountsWithReady, useSubAccountsWithReady, useSnapshots, useExchangeRates } from '@/hooks/useData'
import { useSettingsStore } from '@/store/settings'
import { summarizeMonth, pctChange, allMonths, formatMoney } from '@/lib/money'
import { monthDiff, formatMonth } from '@/lib/date'
import { calcCAGR, formatRate } from '@/lib/growth'
import NetChangeBreakdown from '@/components/NetChangeBreakdown'
import { MonthPicker } from '@/components/MonthPicker'
import { useTranslation } from '@/lib/i18n'
import Decimal from 'decimal.js'

export default function ComparePage() {
  const { accounts, ready: accountsReady } = useAccountsWithReady({ includeArchived: true })
  const { subAccounts, ready: subReady } = useSubAccountsWithReady({ includeArchived: true })
  const snapshots = useSnapshots()
  const rates = useExchangeRates()
  const { settings } = useSettingsStore()
  const base = settings?.base_currency ?? 'CNY'
  const hide = settings?.privacy_mode ?? false
  const invert = settings?.invert_change_color ?? false
  const { t } = useTranslation()

  const months = useMemo(() => allMonths(snapshots).sort(), [snapshots])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  /** 正在编辑哪个端点（null = 未打开选择器） */
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to' | null>(null)

  useEffect(() => {
    if (months.length >= 2 && !from && !to) {
      setFrom(months[months.length - 2])
      setTo(months[months.length - 1])
    }
  }, [months, from, to])

  const ready = accountsReady && subReady

  const fromSum = useMemo(
    () => (from ? summarizeMonth(accounts, snapshots, rates, from, base, subAccounts) : null),
    [accounts, subAccounts, snapshots, rates, from, base],
  )
  const toSum = useMemo(
    () => (to ? summarizeMonth(accounts, snapshots, rates, to, base, subAccounts) : null),
    [accounts, subAccounts, snapshots, rates, to, base],
  )

  const absChange = fromSum && toSum ? toSum.networth.sub(fromSum.networth) : null
  const pct = fromSum && toSum ? pctChange(toSum.networth, fromSum.networth) : null
  const span = from && to ? monthDiff(from, to) : 0
  const cagr = fromSum && toSum && span > 0
    ? calcCAGR(fromSum.networth, toSum.networth, span)
    : { rate: null, reason: 'zero_span' as const, years: 0 }

  const changeColor = (v: Decimal) => {
    if (v.isZero()) return 'text-slate-400'
    const up = v.gte(0)
    return invert
      ? (up ? 'text-green-500' : 'text-red-500')
      : (up ? 'text-red-500' : 'text-green-500')
  }

  /** 总量行的涨跌色：负债增加对净资产是负向，故取反后再套用同一套配色 */
  const deltaTone = (v: Decimal, type: 'asset' | 'liability') =>
    changeColor(type === 'liability' ? v.neg() : v)

  if (!ready) {
    return <div className="px-4 lg:px-8 pt-6 text-slate-400">{t('common.loading')}</div>
  }

  const tooFew = months.length < 2
  const sameMonth = from && to && from === to

  return (
    <div className="px-4 lg:px-8 pt-6 pb-8">
      <h1 className="text-2xl lg:text-3xl font-bold">{t('compare.title')}</h1>
      <p className="text-sm text-slate-500 mt-1 mb-5">{t('compare.subtitle')}</p>

      {/* 月份选择 */}
      <div className="card p-4 mb-4 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[8rem]">
          <div className="text-xs text-slate-500 mb-1">{t('compare.month_from')}</div>
          <button
            onClick={() => setPickerTarget('from')}
            className="w-full flex items-center justify-between gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors group"
          >
            <span className="truncate">{from ? formatMonth(from) : '—'}</span>
            <ChevronDown size={14} className="text-slate-400 group-hover:text-brand-500 transition-colors shrink-0" />
          </button>
        </div>
        <button
          onClick={() => { const f = from; setFrom(to); setTo(f) }}
          className="btn-ghost p-2.5 mb-0.5"
          aria-label={t('compare.swap')}
          title={t('compare.swap')}
        >
          <ArrowLeftRight size={16} />
        </button>
        <div className="flex-1 min-w-[8rem]">
          <div className="text-xs text-slate-500 mb-1">{t('compare.month_to')}</div>
          <button
            onClick={() => setPickerTarget('to')}
            className="w-full flex items-center justify-between gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors group"
          >
            <span className="truncate">{to ? formatMonth(to) : '—'}</span>
            <ChevronDown size={14} className="text-slate-400 group-hover:text-brand-500 transition-colors shrink-0" />
          </button>
        </div>
      </div>

      {tooFew && (
        <div className="card p-8 text-center text-slate-400">{t('compare.need_two')}</div>
      )}
      {!tooFew && sameMonth && (
        <div className="card p-8 text-center text-slate-400">{t('compare.need_two')}</div>
      )}

      {!tooFew && !sameMonth && fromSum && toSum && (
        <>
          {/* 概览数字 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="card p-4">
              <div className="text-xs text-slate-500">{t('compare.net_worth')}</div>
              <div className="text-lg font-semibold tabular-nums mt-1">{formatMoney(toSum.networth, base, hide)}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">{formatMonth(to)}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-slate-500">{t('compare.change')}</div>
              <div className={`text-lg font-semibold tabular-nums mt-1 ${changeColor(absChange!)}`}>
                {absChange!.gte(0) ? '+' : ''}{formatMoney(absChange!, base, hide)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {pct !== null ? `${pct.gte(0) ? '+' : ''}${pct.toFixed(1)}%` : ''}
              </div>
            </div>
            <div className="card p-4 group relative">
              <div className="flex items-center gap-1 text-xs text-slate-500">
                {t('compare.cagr')}
                <Info size={12} className="text-slate-300 dark:text-slate-600" />
              </div>
              {cagr.rate !== null ? (
                <div className={`text-lg font-semibold tabular-nums mt-1 ${changeColor(new Decimal(cagr.rate))}`}>
                  {formatRate(cagr.rate)}
                </div>
              ) : (
                <div className="text-sm text-slate-400 mt-1.5">
                  {cagr.reason === 'invalid_base' ? t('compare.invalid_base') : cagr.reason === 'sign_flip' ? t('compare.sign_flip') : '—'}
                </div>
              )}
              <div className="text-[11px] text-slate-400 mt-0.5">{t('compare.cagr_between', { from: formatMonth(from), to: formatMonth(to) })}</div>
              <div className="absolute top-full right-0 mt-2 w-64 p-3 rounded-lg bg-slate-800 dark:bg-slate-700 text-white text-xs leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">
                <div className="font-semibold mb-1.5">{t('compare.cagr_formula_title')}</div>
                <div className="font-mono text-[11px] break-words">{t('compare.cagr_formula')}</div>
                {cagr.rate !== null && (
                  <div className="font-mono text-[11px] mt-1.5 text-slate-300 break-words">
                    = ({formatMoney(toSum.networth, base, hide)} ÷ {formatMoney(fromSum.networth, base, hide)})^(12 ÷ {span}) − 1 = {formatRate(cagr.rate)}
                  </div>
                )}
                <div className="mt-1.5 text-[11px] text-slate-300">{t('compare.cagr_formula_hint')}</div>
              </div>
            </div>
          </div>

          {/* 资产 / 负债总量对照（替代原来的三指标柱状图） */}
          <div className="card p-4 mb-4 grid grid-cols-2 gap-4">
            <TotalStat
              label={t('compare.assets')}
              from={fromSum.assets}
              to={toSum.assets}
              type="asset"
              base={base}
              hide={hide}
              deltaTone={deltaTone}
            />
            <TotalStat
              label={t('compare.liabilities')}
              from={fromSum.liabilities}
              to={toSum.liabilities}
              type="liability"
              base={base}
              hide={hide}
              deltaTone={deltaTone}
            />
          </div>

          {/* 净增额去向：分类级排序 + 下钻到账户，各项之和可核对 */}
          <div className="card p-4 mb-4">
            <NetChangeBreakdown
              accounts={accounts}
              subAccounts={subAccounts}
              snapshots={snapshots}
              rates={rates}
              month={to}
              priorMonth={from}
              base={base}
              hide={hide}
              invert={invert}
              maxRows={8}
            />
          </div>
        </>
      )}

      {/* 月份选择器（与记账页一致；对比页仅列出有数据的月份） */}
      {pickerTarget && months.length > 0 && (
        <MonthPicker
          month={(pickerTarget === 'from' ? from : to) || months[months.length - 1]}
          availableMonths={months}
          onSelect={(m) => {
            if (pickerTarget === 'from') setFrom(m)
            else setTo(m)
            setPickerTarget(null)
          }}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </div>
  )
}

function TotalStat({
  label,
  from,
  to,
  type,
  base,
  hide,
  deltaTone,
}: {
  label: string
  from: Decimal
  to: Decimal
  type: 'asset' | 'liability'
  base: string
  hide: boolean
  deltaTone: (v: Decimal, t: 'asset' | 'liability') => string
}) {
  const delta = to.sub(from)
  const { t } = useTranslation()
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums mt-1">{formatMoney(to, base, hide)}</div>
      {/* 窄屏两列放不下「期初 → 期末」两个完整金额，改为期初小字 + 变动额并排 */}
      <div className="text-[11px] tabular-nums mt-0.5">
        <span className="text-slate-400">{t('compare.from_value')} {formatMoney(from, base, hide)}</span>
        <span className="text-slate-300"> · </span>
        <span className={`font-medium ${deltaTone(delta, type)}`}>
          {delta.gte(0) ? '+' : ''}{formatMoney(delta, base, hide)}
        </span>
      </div>
    </div>
  )
}
