// 无 React 依赖的 i18n 入口，供非组件代码（类型工具、CSV 导出、categoryLabel 等）使用。
// 由 I18nProvider 在语言变化时同步 currentLang。
import zh from './i18n/zh'
import en from './i18n/en'
import type { Lang } from './i18n'

const dictionaries: Record<Lang, Record<string, string>> = { zh, en }

let currentLang: Lang = 'zh'

export function setCurrentLang(lang: Lang): void {
  currentLang = lang
}

export function getCurrentLang(): Lang {
  return currentLang
}

/** 传给 Intl / toLocaleDateString 的 BCP-47 语言标签。 */
export function localeTag(): string {
  return currentLang === 'zh' ? 'zh-CN' : 'en-US'
}

export function tl(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[currentLang]
  const val = dict[key] ?? key
  if (!params) return val
  return val.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k]
    return v !== undefined ? String(v) : `{${k}}`
  })
}

// 紧凑数字格式：中文用 万/亿，英文用 k/M/B。用于图表坐标轴与标签。
export function formatCompact(v: number): string {
  const abs = Math.abs(v)
  if (currentLang === 'zh') {
    if (abs >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, '') + '亿'
    if (abs >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + '万'
    return String(v)
  }
  if (abs >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B'
  if (abs >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (abs >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(v)
}
