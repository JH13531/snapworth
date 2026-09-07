import { useState } from 'react'
import { Info } from 'lucide-react'
import type { Decimal } from 'decimal.js'
import type { GoalProjection } from '@/lib/projection'
import { formatMoney } from '@/lib/money'
import { formatMonth } from '@/lib/date'
import { useTranslation } from '@/lib/i18n'

interface Props {
  projection: GoalProjection
  remaining: Decimal
  base: string
  hide: boolean
}

/**
 * 目标达成预测行。
 *
 * 平时只显示一句话结论（预计 X 年 X 月达成），
 * 点/悬停「怎么算的」展开完整算式——增速是多少、取的哪段窗口、分母为什么是自然月。
 * 预测这东西不把口径摊开讲，用户只会当成一个神秘数字。
 */
export default function GoalForecast({ projection, remaining, base, hide }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { growth, monthsNeeded, etaMonth, reason } = projection

  if (reason === 'insufficient_data' || !growth) {
    return (
      <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
        <div className="text-[11px] text-slate-400">{t('dashboard.forecast_need_more_data')}</div>
      </div>
    )
  }

  if (reason === 'no_growth' || reason === 'too_far') {
    const msg = reason === 'no_growth'
      ? t('dashboard.forecast_no_growth', { months: growth.spanMonths })
      : t('dashboard.forecast_too_far')
    return (
      <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
        <div className="text-[11px] text-slate-400">{msg}</div>
      </div>
    )
  }

  const gapNotice = growth.dataPoints < growth.spanMonths + 1
    ? t('dashboard.forecast_window_gap', {
        recorded: growth.dataPoints,
        span: growth.spanMonths + 1,
      })
    : t('dashboard.forecast_window_full', { count: growth.dataPoints })

  return (
    <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
      <div className="text-[11px] text-slate-500 min-w-0">
        {t('dashboard.forecast_eta', {
          month: formatMonth(etaMonth!),
          months: monthsNeeded ?? 0,
        })}
      </div>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          aria-expanded={open}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <Info size={12} />
          {t('dashboard.forecast_how')}
        </button>
        {open && (
          <div className="absolute right-0 bottom-full mb-2 w-72 p-3 rounded-xl bg-slate-900 dark:bg-slate-800 text-white shadow-xl z-30 text-[11px] leading-relaxed">
            <div className="font-medium mb-2 text-slate-100">
              {t('dashboard.forecast_title')}
            </div>
            <Row label={t('dashboard.forecast_window')}>
              {formatMonth(growth.windowStart)} → {formatMonth(growth.windowEnd)}
              <div className="text-slate-400">{gapNotice}</div>
            </Row>
            <Row label={t('dashboard.forecast_net_gain')}>
              <span className="tabular-nums">
                {growth.netGain.gte(0) ? '+' : ''}{formatMoney(growth.netGain, base, hide)}
              </span>
            </Row>
            <Row label={t('dashboard.forecast_rate')}>
              <span className="tabular-nums">
                {formatMoney(growth.netGain, base, hide)} ÷ {growth.spanMonths} = {formatMoney(growth.monthlyRate, base, hide)}
              </span>
              <div className="text-slate-400">{t('dashboard.forecast_per_month')}</div>
            </Row>
            <div className="h-px bg-white/15 my-2" />
            <Row label={t('dashboard.forecast_remaining')}>
              <span className="tabular-nums">{formatMoney(remaining, base, hide)}</span>
            </Row>
            <Row label={t('dashboard.forecast_eta_label')}>
              <span className="tabular-nums">
                {formatMoney(remaining, base, hide)} ÷ {formatMoney(growth.monthlyRate, base, hide)} ≈ {monthsNeeded} {t('dashboard.forecast_months_unit')}
              </span>
              <div className="text-slate-300 font-medium">{formatMonth(etaMonth!)}</div>
            </Row>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 mb-1.5">
      <span className="text-slate-400 shrink-0 w-12">{label}</span>
      <span className="flex-1 min-w-0 break-words">{children}</span>
    </div>
  )
}
