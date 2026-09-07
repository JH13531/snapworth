import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, PenLine, BarChart3, Wallet, Settings, Scale, Eye, EyeOff } from 'lucide-react'
import { useSettingsStore } from '@/store/settings'
import { useTranslation } from '@/lib/i18n'
import clsx from 'clsx'

const tabKeys = [
  { to: '/', key: 'nav.overview', icon: LayoutDashboard, end: true },
  { to: '/entry', key: 'nav.entry', icon: PenLine },
  { to: '/analytics', key: 'nav.analytics', icon: BarChart3 },
  { to: '/compare', key: 'nav.compare', icon: Scale },
  { to: '/accounts', key: 'nav.accounts', icon: Wallet },
  { to: '/settings', key: 'nav.settings', icon: Settings },
]

function NavItems({ orientation }: { orientation: 'bottom' | 'side' }) {
  const { settings, togglePrivacy } = useSettingsStore()
  const { t } = useTranslation()
  const hide = settings?.privacy_mode ?? false
  const isSide = orientation === 'side'

  return (
    <>
      {tabKeys.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-xl transition-colors',
              isSide ? 'px-3.5 py-2.5 text-sm' : 'flex-col px-3 py-1.5 text-[11px] gap-0.5',
              isActive
                ? 'bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400 font-medium'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
            )
          }
        >
          <tab.icon size={isSide ? 19 : 22} />
          <span>{t(tab.key)}</span>
        </NavLink>
      ))}
      <button
        onClick={togglePrivacy}
        aria-label={hide ? t('common.show_amount') : t('common.hide_amount')}
        aria-pressed={hide}
        className={clsx(
          'flex items-center gap-3 rounded-xl transition-all',
          isSide ? 'px-3.5 py-2.5 text-sm' : 'flex-col px-3 py-1.5 text-[11px] gap-0.5',
          hide
            ? 'bg-slate-800/10 dark:bg-slate-200/10 text-slate-700 dark:text-slate-200 ring-1 ring-slate-300/60 dark:ring-slate-700'
            : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
        )}
      >
        {hide ? <EyeOff size={isSide ? 19 : 22} /> : <Eye size={isSide ? 19 : 22} />}
        <span>{hide ? t('nav.show_amount') : t('nav.hide_amount')}</span>
      </button>
    </>
  )
}

export default function Layout() {
  const location = useLocation()
  const { t } = useTranslation()

  if (location.pathname.startsWith('/onboarding')) {
    return <Outlet />
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 lg:border-r lg:border-slate-200 lg:dark:border-slate-800 lg:bg-white lg:dark:bg-slate-900 lg:sticky lg:top-0 lg:h-screen">
        <div className="px-5 py-6">
          <div className="text-lg font-bold tracking-tight">Snapworth</div>
          <div className="text-xs text-slate-400 mt-0.5">{t('app.tagline')}</div>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          <NavItems orientation="side" />
        </nav>
        <div className="px-5 py-4 text-[11px] text-slate-300 dark:text-slate-600">
          v0.1.0 · {t('settings.local_only')}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <main className="w-full max-w-5xl mx-auto pb-24 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className={clsx(
          'lg:hidden fixed bottom-0 left-0 right-0 z-50',
          'bg-white/90 dark:bg-slate-900/90 backdrop-blur border-t border-slate-200 dark:border-slate-800',
          'pb-[var(--safe-bottom)]',
        )}
      >
        <div className="max-w-screen-md mx-auto flex items-center justify-around px-2 py-1.5">
          <NavItems orientation="bottom" />
        </div>
      </nav>
    </div>
  )
}
