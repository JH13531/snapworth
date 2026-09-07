import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T
  onChange: (v: T) => void
  options: Option<T>[]
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function FilterDropdown<T extends string>({ value, onChange, options, placeholder, className = '', disabled = false }: Props<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const selected = options.find((o) => o.value === value)
  const { t } = useTranslation()

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-200 dark:hover:bg-slate-700 disabled:hover:bg-slate-100 dark:disabled:hover:bg-slate-800"
      >
        <span className="truncate">{selected?.label ?? placeholder ?? t('common.all')}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && !disabled && (
        <div className="absolute top-full left-0 mt-1 w-full min-w-[8rem] max-h-60 overflow-y-auto bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-100 dark:border-slate-800 z-50 py-1">
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                  active ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <span className="flex-1 truncate">{opt.label}</span>
                {active && <Check size={14} className="shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
