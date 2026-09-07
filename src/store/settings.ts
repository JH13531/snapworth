import { create } from 'zustand'
import type { Settings, Theme } from '@/types'
import { getSettings, updateSettings } from '@/db'

interface SettingsState {
  settings: Settings | null
  loading: boolean
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
  togglePrivacy: () => Promise<void>
  setTheme: (theme: Theme) => Promise<void>
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
}

// 保存 matchMedia 监听器引用，主题切换时可正确移除/重建
const mql = window.matchMedia('(prefers-color-scheme: dark)')
let systemThemeHandler: (() => void) | null = null

function attachSystemListener() {
  if (systemThemeHandler) return // 已挂载
  systemThemeHandler = () => {
    const cur = useSettingsStore.getState().settings
    if (cur?.theme === 'system') applyTheme('system')
  }
  mql.addEventListener('change', systemThemeHandler)
}

function detachSystemListener() {
  if (!systemThemeHandler) return
  mql.removeEventListener('change', systemThemeHandler)
  systemThemeHandler = null
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loading: true,
  load: async () => {
    const s = await getSettings()
    applyTheme(s.theme)
    set({ settings: s, loading: false })
    if (s.theme === 'system') attachSystemListener()
    // 请求持久存储权限，避免被浏览器自动清理
    if ('storage' in navigator && 'persist' in navigator.storage) {
      navigator.storage.persist().catch(() => {})
    }
  },
  update: async (patch) => {
    const s = await updateSettings(patch)
    if (patch.theme) {
      applyTheme(s.theme)
      // 主题变更后同步更新系统监听器
      if (s.theme === 'system') attachSystemListener()
      else detachSystemListener()
    }
    set({ settings: s })
  },
  togglePrivacy: async () => {
    const cur = get().settings
    if (cur) await get().update({ privacy_mode: !cur.privacy_mode })
  },
  setTheme: async (theme) => {
    await get().update({ theme })
  },
}))
