import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, Shield, RefreshCw, ArrowRight, Check, Upload } from 'lucide-react'
import { useSettingsStore } from '@/store/settings'
import { db, updateSettings, uuid } from '@/db'
import { ACCOUNT_PRESETS, presetToAccount, presetName } from '@/lib/presets'
import type { SubAccount } from '@/types'
import { CURRENCIES, currencyName } from '@/lib/currency'
import { setPendingImportFile } from '@/lib/import-handoff'
import { Icon } from '@/components/Icon'
import { useTranslation } from '@/lib/i18n'

const SLIDES = [
  { icon: Wallet, titleKey: 'onboarding.slide_intro_title', descKey: 'onboarding.slide_intro_desc' },
  { icon: Shield, titleKey: 'onboarding.slide_data_title', descKey: 'onboarding.slide_data_desc' },
  { icon: RefreshCw, titleKey: 'onboarding.slide_view_title', descKey: 'onboarding.slide_view_desc' },
]

export default function OnboardingPage() {
  const [step, setStep] = useState(0)
  const { t } = useTranslation()
  const [bookName, setBookName] = useState(() => t('onboarding.default_book_name'))
  const [currency, setCurrency] = useState('CNY')
  const [selectedPresets, setSelectedPresets] = useState<Set<number>>(new Set([0, 1, 2]))
  const navigate = useNavigate()

  function togglePreset(i: number) {
    setSelectedPresets((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  async function finish() {
    const selected = [...selectedPresets].sort((a, b) => a - b)
    await db.transaction('rw', db.settings, db.accounts, db.subAccounts, async () => {
      await updateSettings({ book_name: bookName, base_currency: currency, onboarded: true })
      const accounts = selected.map((i, idx) => presetToAccount(ACCOUNT_PRESETS[i], idx))
      await db.accounts.bulkAdd(accounts)
      const now = new Date().toISOString()
      const subAccounts: SubAccount[] = accounts.map((acc, idx) => ({
        id: uuid(),
        account_id: acc.id,
        name: '',
        type: acc.type,
        category: acc.category,
        currency: acc.currency,
        include_in_networth: acc.include_in_networth,
        archived: false,
        sort_order: idx,
        created_at: now,
        updated_at: now,
      }))
      await db.subAccounts.bulkAdd(subAccounts)
    })
    await useSettingsStore.getState().load()
    navigate('/')
  }

  const importFileRef = useRef<HTMLInputElement>(null)

  /** 引导页直接选择备份文件，交接给设置页续接完整的导入流程（解密 / 合并覆盖 / CSV 匹配）。 */
  async function handleImportClick() {
    importFileRef.current?.click()
  }

  async function onImportFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // 导入会覆盖/合并数据，仍需一个已初始化的账本记录
    await db.transaction('rw', db.settings, db.accounts, async () => {
      await updateSettings({ book_name: t('onboarding.imported_book_name'), onboarded: true })
    })
    await useSettingsStore.getState().load()
    setPendingImportFile(file)
    navigate('/settings')
    if (importFileRef.current) importFileRef.current.value = ''
  }

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-950">
      {step < 3 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-20 h-20 rounded-3xl bg-brand-100 dark:bg-brand-900 flex items-center justify-center mb-6">
            {(() => { const S = SLIDES[step].icon; return <S size={36} className="text-brand-600" /> })()}
          </div>
          <h1 className="text-2xl font-bold mb-3">{t(SLIDES[step].titleKey)}</h1>
          <p className="text-slate-500 leading-relaxed max-w-xs">{t(SLIDES[step].descKey)}</p>

          <div className="flex gap-2 mt-8">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`h-2 rounded-full transition-all ${i === step ? 'w-8 bg-brand-600' : 'w-2 bg-slate-300 dark:bg-slate-700'}`}
              />
            ))}
          </div>

          <button
            onClick={() => setStep(step + 1)}
            className="btn-primary mt-10 px-8 py-3"
          >
            {step === 2 ? t('onboarding.start_setup') : t('onboarding.next')} <ArrowRight size={18} />
          </button>
          {step < 2 && (
            <button onClick={() => setStep(3)} className="text-sm text-slate-400 mt-4">{t('onboarding.skip')}</button>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col px-6 py-8 overflow-y-auto">
          <h1 className="text-2xl font-bold mb-1">{t('onboarding.create_book')}</h1>
          <p className="text-sm text-slate-500 mb-6">{t('onboarding.create_book_desc')}</p>

          <label className="label">{t('onboarding.book_name')}</label>
          <input className="input mb-4" value={bookName} onChange={(e) => setBookName(e.target.value)} />

          <label className="label">{t('onboarding.base_currency')}</label>
          <select className="input mb-6" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} - {currencyName(c)}</option>)}
          </select>

          <label className="label">{t('onboarding.quick_add_accounts')}</label>
          <div className="flex flex-wrap gap-2 mb-6">
            {ACCOUNT_PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => togglePreset(i)}
                className={`card px-3 py-2 flex items-center gap-2 text-sm transition-all ${selectedPresets.has(i) ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 ring-1 ring-brand-500' : ''}`}
              >
                <span className="w-6 h-6 rounded-lg flex items-center justify-center text-white relative" style={{ backgroundColor: p.color }}>
                  <Icon name={p.icon} size={14} />
                  {selectedPresets.has(i) && (
                    <Check size={10} className="absolute -bottom-1 -right-1 text-white bg-brand-600 rounded-full p-0.5" />
                  )}
                </span>
                {presetName(p)}
              </button>
            ))}
          </div>

          <div className="flex-1" />
          <button onClick={finish} className="btn-primary w-full py-3 text-base">
            {t('onboarding.done')} <Check size={18} />
          </button>
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            <span className="text-xs text-slate-400">{t('onboarding.or')}</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
          </div>
          <button
            onClick={handleImportClick}
            className="btn-secondary w-full py-3 text-base flex items-center justify-center gap-2"
          >
            <Upload size={18} /> {t('onboarding.import_data')}
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".snapvault,.snapkey,.csv,.xls,.xlsx"
            className="hidden"
            onChange={onImportFileChosen}
          />
          <p className="text-xs text-slate-400 text-center mt-3">
            {t('onboarding.import_supported')}
          </p>
        </div>
      )}
    </div>
  )
}
