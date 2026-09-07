import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { currentMonth } from '@/lib/date'
import { useTranslation } from '@/lib/i18n'

interface MonthPickerProps {
  /** 当前选中的月份 YYYY-MM */
  month: string
  onSelect: (m: string) => void
  onClose: () => void
  /**
   * 可选：限定可选择的月份（如对比页只列出有数据的月份）。
   * 不传时按「不晚于本月」限制，年份可自由向前翻（记账页、分析页）。
   */
  availableMonths?: string[]
}

/**
 * 月份选择器弹窗：年份左右翻页 + 12 格月份网格。
 * 记账页、分析页、对比页共用，保证三处交互一致。
 */
export function MonthPicker({ month, onSelect, onClose, availableMonths }: MonthPickerProps) {
  const { t } = useTranslation()
  const curMonth = currentMonth()
  const sorted = useMemo(() => (availableMonths ? [...availableMonths].sort() : null), [availableMonths])
  const [year, setYear] = useState(parseInt(month.slice(0, 4)))

  // 限定列表时年份也跟着收窄，避免翻到完全没有数据的年份
  const minYear = sorted?.length ? parseInt(sorted[0].slice(0, 4)) : 1970
  const maxYear = sorted?.length
    ? parseInt(sorted[sorted.length - 1].slice(0, 4))
    : new Date().getFullYear()
  const allowed = sorted ? new Set(sorted) : null

  // 底部快捷跳转：有限定列表时跳到最新月份，否则回到本月
  const quickTarget = sorted?.length ? sorted[sorted.length - 1] : curMonth
  const quickLabel = sorted?.length
    ? t('month_picker.back_to_latest')
    : t('month_picker.back_to_current')

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-4 animate-backdrop-in"
      onClick={onClose}
    >
      <div
        className="card w-full sm:w-72 p-4 animate-modal-in max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setYear((y) => y - 1)}
            disabled={year <= minYear}
            className="btn-ghost p-1 -ml-1 disabled:opacity-30"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="font-semibold text-sm">{t('month_picker.year', { year })}</span>
          <button
            onClick={() => setYear((y) => y + 1)}
            disabled={year >= maxYear}
            className="btn-ghost p-1 -mr-1 disabled:opacity-30"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {months.map((m, i) => {
            const isCurrent = m === month
            const disabled = allowed ? !allowed.has(m) : m > curMonth
            return (
              <button
                key={m}
                disabled={disabled}
                onClick={() => { onSelect(m); onClose() }}
                className={`py-2 rounded-lg text-sm transition-colors disabled:opacity-30 disabled:pointer-events-none ${
                  isCurrent
                    ? 'bg-brand-600 text-white font-medium'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {t('month_picker.month_num', { month: i + 1 })}
              </button>
            )
          })}
        </div>

        <button
          onClick={() => { onSelect(quickTarget); onClose() }}
          disabled={month === quickTarget}
          className="w-full mt-3 py-2 text-sm text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-lg font-medium disabled:opacity-40 disabled:cursor-default transition-colors"
        >
          {quickLabel}
        </button>
      </div>
    </div>
  )
}
