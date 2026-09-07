import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useSettingsStore } from '@/store/settings'
import zh from './zh'
import en from './en'
import { setCurrentLang } from '../i18n-locale'

export type Lang = 'zh' | 'en'

const dictionaries: Record<Lang, Record<string, string>> = { zh, en }

function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (_, key) => {
    const val = params[key]
    return val !== undefined ? String(val) : `{${key}}`
  })
}

interface I18nContextValue {
  lang: Lang
  t: (key: string, params?: Record<string, string | number>) => string
  setLang: (lang: Lang) => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const { settings, update } = useSettingsStore()
  const [lang, setLangState] = useState<Lang>((settings?.language as Lang) || 'zh')

  // 同步 settings 中的 language
  useEffect(() => {
    if (!settings) return
    const l = (settings.language as Lang) || 'zh'
    setLangState(l)
    setCurrentLang(l)
    // 设置 html lang 属性
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
  }, [settings?.language])

  const setLang = useCallback(async (newLang: Lang) => {
    setLangState(newLang)
    setCurrentLang(newLang)
    document.documentElement.lang = newLang === 'zh' ? 'zh-CN' : 'en'
    try {
      await update({ language: newLang } as any)
    } catch { /* ignore */ }
  }, [update])

  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    const dict = dictionaries[lang]
    const val = dict[key] ?? key
    return interpolate(val, params)
  }, [lang])

  return (
    <I18nContext.Provider value={{ lang, t, setLang }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider')
  return ctx
}
