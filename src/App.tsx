import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import Layout from '@/components/Layout'
import { ToastProvider } from '@/components/Toast'
import { I18nProvider, useTranslation } from '@/lib/i18n'
import DashboardPage from '@/pages/DashboardPage'
import EntryPage from '@/pages/EntryPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import ComparePage from '@/pages/ComparePage'
import AccountsPage from '@/pages/AccountsPage'
import AccountEditPage from '@/pages/AccountEditPage'
import AccountDetailPage from '@/pages/AccountDetailPage'
import ReviewPage from '@/pages/ReviewPage'
import SettingsPage from '@/pages/SettingsPage'
import RatesPage from '@/pages/RatesPage'
import OnboardingPage from '@/pages/OnboardingPage'
import { useSettingsStore } from '@/store/settings'
import { initBackupPermissionRecovery, flushBackupOnHide } from '@/lib/backup-file'

function AppRoutes() {
  const { settings, loading } = useSettingsStore()
  const { t } = useTranslation()

  useEffect(() => {
    useSettingsStore.getState().load()
  }, [])

  // 开启「自动备份到文件夹」后：
  // 1. 权限因浏览器重启降级时，用户下一次点击即自动续期并补写（无需去设置页操作）
  // 2. 切后台/关页时尽力补写一次
  useEffect(() => {
    if (!settings?.auto_file_backup) return
    void initBackupPermissionRecovery()
    return flushBackupOnHide()
  }, [settings?.auto_file_backup])

  // 单一 BrowserRouter 实例：避免 settings 变化时销毁/重建 router 丢失路由状态
  // basename 取 Vite 的 base（部署在子路径如 GitHub Pages /snapworth/ 时需要；根路径部署时为 '/'）
  const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'
  return (
    <BrowserRouter basename={routerBasename}>
      {loading || !settings ? (
        <div className="min-h-screen flex items-center justify-center text-slate-400">{t('common.loading')}</div>
      ) : !settings.onboarded ? (
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/entry" element={<EntryPage />} />
            <Route path="/entry/:month" element={<EntryPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="/accounts/new" element={<AccountEditPage />} />
          <Route path="/accounts/:id/edit" element={<AccountEditPage />} />
          <Route path="/accounts/:id" element={<AccountDetailPage />} />
          <Route path="/review/:month" element={<ReviewPage />} />
          <Route path="/settings/rates" element={<RatesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <I18nProvider>
        <AppRoutes />
      </I18nProvider>
    </ToastProvider>
  )
}
