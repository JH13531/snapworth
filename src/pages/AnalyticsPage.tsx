import { useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { useAccounts, useSubAccountsWithReady, useSnapshotsForMonths, useExchangeRates, useMonthlyReviews, useSnapshots } from '@/hooks/useData'
import { useSettingsStore } from '@/store/settings'
import { summarizeMonth, formatMoney, rateFor, buildSnapshotMap, snapCurrency, allMonths, assessDebtHealth, summarizeMonthByCategory, pctChange } from '@/lib/money'
import { categoryLabel } from '@/types'
import { currentMonth, prevMonth, nextMonth, formatMonth, addMonths } from '@/lib/date'
import CompositionChart from '@/components/CompositionChart'
import CategoryTrendChart from '@/components/CategoryTrendChart'
import { FilterDropdown } from '@/components/FilterDropdown'
import BalanceSankeyChart from '@/components/BalanceSankeyChart'
import { Icon } from '@/components/Icon'
import { MonthPicker } from '@/components/MonthPicker'
import { useSwipeGesture } from '@/hooks/useSwipeGesture'
import { useTranslation } from '@/lib/i18n'
import Decimal from 'decimal.js'

export default function AnalyticsPage() {
  const accounts = useAccounts()
  const { subAccounts } = useSubAccountsWithReady()
  const rates = useExchangeRates()
  const reviews = useMonthlyReviews()
  const allSnapshots = useSnapshots()
  const { settings } = useSettingsStore()
  const navigate = useNavigate()
  const base = settings?.base_currency ?? 'CNY'
  const hide = settings?.privacy_mode ?? false
  const invert = settings?.invert_change_color ?? false
  const [tab, setTab] = useState<'asset' | 'liability'>('asset')
  const [filterCat, setFilterCat] = useState('') // 空 = 全部分类
  const [filterAccount, setFilterAccount] = useState('') // 空 = 全部账户
  // 切换资产/负债时重置双筛选，否则筛选项可能不属于当前类型
  const switchTab = (t2: 'asset' | 'liability') => { setTab(t2); setFilterCat(''); setFilterAccount('') }
  const [changePage, setChangePage] = useState(0)
  const [changePageSize, setChangePageSize] = useState(5)
  const [changeTab, setChangeTab] = useState<'up' | 'down'>('up')
  const [selectedMonth, setSelectedMonth] = useState(currentMonth())
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const { t } = useTranslation()
  const yearStart = `${new Date().getFullYear()}-01`

  // 加载所有快照月份，支持月份切换
  const allSnapMonths = useMemo(() => {
    const months = new Set([selectedMonth, prevMonth(selectedMonth), addMonths(selectedMonth, -12), yearStart])
    for (const r of reviews) { months.add(r.month); months.add(prevMonth(r.month)) }
    return [...months]
  }, [selectedMonth, yearStart, reviews])
  const snapshots = useSnapshotsForMonths(allSnapMonths)

  const current = useMemo(() => summarizeMonth(accounts, snapshots, rates, selectedMonth, base, subAccounts), [accounts, snapshots, rates, selectedMonth, base])

  // KPI 计算：环比（上月）、同比（12 个月前）、本月最佳分类（对净值的净贡献）
  const prevM = prevMonth(selectedMonth)
  const yoyM = addMonths(selectedMonth, -12)
  const monthSet = useMemo(() => new Set(allMonths(snapshots)), [snapshots])
  const hasPrev = monthSet.has(prevM)
  const hasYoy = monthSet.has(yoyM)
  // 稳定的最早数据月份：取自全库快照，而非随选中月移动的窗口，
  // 避免 goPrev 的下界随窗口自我锁死（例如起始月无数据时回退一步即被永久锁住）。
  const firstDataMonth = useMemo(() => allMonths(allSnapshots)[0], [allSnapshots])

  const prevSum = useMemo(() => summarizeMonth(accounts, snapshots, rates, prevM, base, subAccounts), [accounts, snapshots, rates, prevM, base, subAccounts])
  const yoySum = useMemo(() => summarizeMonth(accounts, snapshots, rates, yoyM, base, subAccounts), [accounts, snapshots, rates, yoyM, base, subAccounts])

  const momChange = current.networth.sub(prevSum.networth)
  const yoyChange = current.networth.sub(yoySum.networth)
  const momPct = pctChange(current.networth, prevSum.networth)
  const yoyPct = pctChange(current.networth, yoySum.networth)

  const bestCategory = useMemo(() => {
    const curA = summarizeMonthByCategory(accounts, snapshots, rates, selectedMonth, base, 'asset', subAccounts)
    const prevA = summarizeMonthByCategory(accounts, snapshots, rates, prevM, base, 'asset', subAccounts)
    const curL = summarizeMonthByCategory(accounts, snapshots, rates, selectedMonth, base, 'liability', subAccounts)
    const prevL = summarizeMonthByCategory(accounts, snapshots, rates, prevM, base, 'liability', subAccounts)
    const cats = new Set<string>([...curA.keys(), ...prevA.keys(), ...curL.keys(), ...prevL.keys()])
    const ZERO = new Decimal(0)
    let best: { key: string; net: Decimal } | null = null
    for (const c of cats) {
      const assetDelta = (curA.get(c) ?? ZERO).sub(prevA.get(c) ?? ZERO)
      const liabDelta = (curL.get(c) ?? ZERO).sub(prevL.get(c) ?? ZERO)
      const net = assetDelta.sub(liabDelta) // 负债增加会拖累净值，故扣减
      if (net.gt(0) && (!best || net.gt(best.net))) best = { key: c, net }
    }
    return best
  }, [accounts, snapshots, rates, selectedMonth, prevM, base, subAccounts])

  // 页面级焦点筛选选项：分类（按当前 type 汇总排序）与账户（当前 type 且有数据）
  const focusCatOptions = useMemo(() => {
    const map = new Map<string, Decimal>()
    for (const m of allMonths(snapshots)) {
      summarizeMonthByCategory(accounts, snapshots, rates, m, base, tab, subAccounts).forEach((v, c) =>
        map.set(c, (map.get(c) ?? new Decimal(0)).add(v)),
      )
    }
    return [...map.keys()].sort((a, b) => map.get(b)!.minus(map.get(a)!).toNumber())
  }, [accounts, snapshots, rates, base, tab, subAccounts])

  const focusAccountOptions = useMemo(() => {
    const present = new Set(snapshots.map((s) => s.account_id))
    // 选中分类后，账户下拉只列出该分类下的账户：
    // 有子账户时按子账户的分类归属账户，否则按账户自身分类
    let catAccountIds: Set<string> | null = null
    if (filterCat) {
      catAccountIds = new Set()
      if (subAccounts.length > 0) {
        for (const s of subAccounts) {
          if (s.type === tab && s.category === filterCat) catAccountIds.add(s.account_id)
        }
      } else {
        for (const a of accounts) {
          if (a.type === tab && a.category === filterCat) catAccountIds.add(a.id)
        }
      }
    }
    return accounts
      .filter((a) => a.type === tab && present.has(a.id))
      .filter((a) => catAccountIds === null || catAccountIds.has(a.id))
      .sort((a, b) => a.sort_order - b.sort_order)
  }, [accounts, subAccounts, snapshots, tab, filterCat])

  const snapMap = useMemo(() => buildSnapshotMap(snapshots), [snapshots])

  const topChanges = useMemo(() => {
    return accounts
      .filter((a) => !a.archived && a.include_in_networth)
      .map((a) => {
        const cur = snapMap.get(`${a.id}|${selectedMonth}`)
        const prevM = prevMonth(selectedMonth)
        const prevS = snapMap.get(`${a.id}|${prevM}`)
        if (!cur && !prevS) return null
        const curRate = cur ? rateFor(rates, snapCurrency(cur, a), selectedMonth, base) : null
        const prevRate = prevS ? rateFor(rates, snapCurrency(prevS, a), prevM, base) : null
        const curB = cur && curRate ? new Decimal(cur.balance).mul(curRate) : new Decimal(0)
        const prevB = prevS && prevRate ? new Decimal(prevS.balance).mul(prevRate) : new Decimal(0)
        if (curB.isZero() && prevB.isZero()) return null
        const raw = curB.sub(prevB)
        const diff = a.type === 'asset' ? raw : raw.neg()
        return { account: a, diff }
      })
      .filter((x): x is { account: typeof accounts[0]; diff: Decimal } => x !== null && !x.diff.isZero())
      .sort((a, b) => b.diff.abs().minus(a.diff.abs()).toNumber())
  }, [accounts, snapMap, rates, selectedMonth, base])

  const filteredChanges = useMemo(() => {
    const filtered = topChanges.filter((x) => (changeTab === 'up' ? x.diff.gt(0) : x.diff.lt(0)))
    return filtered.sort((a, b) => (changeTab === 'up'
      ? b.diff.minus(a.diff).toNumber()
      : a.diff.minus(b.diff).toNumber()))
  }, [topChanges, changeTab])

  const totalChangePages = Math.max(1, Math.ceil(filteredChanges.length / changePageSize))
  const safeChangePage = Math.min(changePage, totalChangePages - 1)
  const paginatedChanges = filteredChanges.slice(safeChangePage * changePageSize, (safeChangePage + 1) * changePageSize)

  const debtRatio = current.assets.isZero() ? new Decimal(0) : current.liabilities.div(current.assets).mul(100)
  const warn = settings?.health_threshold_warn ?? 50
  const danger = settings?.health_threshold_danger ?? 70

  const positive = (v: Decimal) => v.gte(0)
  const changeColorClass = (v: Decimal) => {
    const up = positive(v)
    if (v.isZero()) return 'text-slate-400'
    return invert
      ? (up ? 'text-green-500' : 'text-red-500')
      : (up ? 'text-red-500' : 'text-green-500')
  }

  // 当前选中月份的复盘「本月总结」
  const currentReview = reviews.find((r) => r.month === selectedMonth)

  function goPrev() {
    const pm = prevMonth(selectedMonth)
    if (firstDataMonth && pm < firstDataMonth) return
    setSelectedMonth(pm)
  }
  function goNext() {
    const nm = nextMonth(selectedMonth)
    if (nm <= currentMonth()) setSelectedMonth(nm)
  }

  const swipeRef = useRef<HTMLDivElement>(null)
  useSwipeGesture(swipeRef, {
    onLeft: goNext,
    onRight: goPrev,
  })

  return (
    <div ref={swipeRef} className="px-4 lg:px-8 pt-4 pb-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t('analytics.title')}</h1>
        <div className="flex items-center gap-1">
          <button onClick={goPrev} className="btn-ghost p-1.5"><ChevronLeft size={18} /></button>
          <button
            onClick={() => setShowMonthPicker(true)}
            className="flex items-center gap-1 px-1.5 py-1.5 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors group"
          >
            <span className="text-sm font-medium min-w-[4.5em] text-center">{formatMonth(selectedMonth)}</span>
            <ChevronDown size={14} className="text-slate-400 group-hover:text-brand-500 transition-colors" />
          </button>
          <button onClick={goNext} disabled={selectedMonth >= currentMonth()} className="btn-ghost p-1.5 disabled:opacity-30"><ChevronRight size={18} /></button>
        </div>
      </div>

      {/* KPI 条：净资产 / 环比 / 同比 / 本月最佳分类 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="card p-4">
          <div className="text-xs text-slate-500">{t('analytics.kpi_net_worth')}</div>
          <div className="text-xl font-bold mt-1 tabular-nums">{formatMoney(current.networth, base, hide)}</div>
          <div className={`text-xs mt-1 tabular-nums ${changeColorClass(momChange)}`}>
            {hasPrev ? `${momChange.gte(0) ? '+' : ''}${formatMoney(momChange, base, hide)}` : '—'}
            <span className="text-slate-400 ml-1">{t('analytics.kpi_mom_short')}</span>
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500">{t('analytics.kpi_mom')}</div>
          <div className={`text-xl font-bold mt-1 tabular-nums ${changeColorClass(momChange)}`}>
            {hasPrev && momPct ? `${momPct.gte(0) ? '+' : ''}${momPct.toFixed(1)}%` : '—'}
          </div>
          <div className="text-xs text-slate-400 mt-1 tabular-nums">
            {hasPrev ? `${momChange.gte(0) ? '+' : ''}${formatMoney(momChange, base, hide)}` : t('analytics.kpi_no_data')}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500">{t('analytics.kpi_yoy')}</div>
          <div className={`text-xl font-bold mt-1 tabular-nums ${changeColorClass(yoyChange)}`}>
            {hasYoy && yoyPct ? `${yoyPct.gte(0) ? '+' : ''}${yoyPct.toFixed(1)}%` : '—'}
          </div>
          <div className="text-xs text-slate-400 mt-1 tabular-nums">
            {hasYoy ? `${yoyChange.gte(0) ? '+' : ''}${formatMoney(yoyChange, base, hide)}` : t('analytics.kpi_no_data')}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500">{t('analytics.kpi_best_category')}</div>
          <div className="text-xl font-bold mt-1 truncate">
            {bestCategory ? categoryLabel(bestCategory.key) : t('analytics.kpi_best_none')}
          </div>
          <div className={`text-xs mt-1 tabular-nums ${changeColorClass(bestCategory ? bestCategory.net : new Decimal(0))}`}>
            {bestCategory ? `${bestCategory.net.gte(0) ? '+' : ''}${formatMoney(bestCategory.net, base, hide)}` : ''}
          </div>
        </div>
      </div>

      {/* 资产负债率 + 本月总结（桌面端并排） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div className="card p-4">
        <div className="text-xs text-slate-500">{t('analytics.debt_ratio')}</div>
        {/* 比率不是金额，隐私模式下保持可见 */}
        <div className="text-2xl font-bold mt-1 tabular-nums">{debtRatio.toFixed(1)}%</div>
        <div className="group relative">
          {(() => {
            const h = assessDebtHealth(debtRatio, warn, danger)
            return <div className={`text-xs mt-1 cursor-help ${h.color}`}>{h.label}</div>
          })()}
          <div className="absolute top-full left-0 mt-2 w-52 p-3 rounded-lg bg-slate-800 dark:bg-slate-700 text-white text-xs leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
            <div className="font-semibold mb-1.5">{t('health.criteria_title')}</div>
            <div>· <span className="text-green-400">{t('health.criteria_healthy')}</span>：{t('health.debt_ratio')} {'<'} {warn}%</div>
            <div>· <span className="text-yellow-400">{t('health.criteria_warning')}</span>：{warn}% ~ {danger}%</div>
            <div>· <span className="text-red-400">{t('health.criteria_danger')}</span>：{'≥'} {danger}%</div>
          </div>
        </div>
      </div>

      {/* 本月总结：当前选中月份的复盘笔记，点击可跳转复盘页查看/编辑 */}
      <div className="card p-4 flex flex-col">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">{t('review.monthly_note')}</div>
          <button
            onClick={() => navigate(`/review/${selectedMonth}`)}
            className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 shrink-0"
          >
            {currentReview?.note ? t('analytics.summary_view') : t('analytics.summary_write')}
          </button>
        </div>
        {currentReview?.note ? (
          <p className="text-sm mt-2 leading-relaxed whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200 line-clamp-6">{currentReview.note}</p>
        ) : (
          <button
            onClick={() => navigate(`/review/${selectedMonth}`)}
            className="text-sm mt-2 text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 text-left transition-colors"
          >
            {t('analytics.summary_empty')}
          </button>
        )}
      </div>
      </div>

      {/* 双筛选：分类 + 账户，趋势图与构成图共同跟随（与账户页一致的两个独立下拉） */}
      <div className="flex gap-2 mb-4">
        {/* 始终保留筛选器位置：当前类型（如负债）暂无账户/数据时置灰，避免布局跳动 */}
        <FilterDropdown
          value={filterCat || '__all__'}
          onChange={(v) => { setFilterCat(v === '__all__' ? '' : v); setFilterAccount('') }}
          placeholder={t('category_trend.all_categories')}
          className="flex-1 min-w-0"
          disabled={focusCatOptions.length === 0}
          options={[
            { value: '__all__' as string, label: t('category_trend.all_categories') },
            ...focusCatOptions.map((cat) => ({ value: cat, label: categoryLabel(cat) })),
          ]}
        />
        <FilterDropdown
          value={filterAccount || '__all__'}
          onChange={(v) => setFilterAccount(v === '__all__' ? '' : v)}
          placeholder={t('category_trend.all_accounts')}
          className="flex-1 min-w-0"
          disabled={focusAccountOptions.length === 0}
          options={[
            { value: '__all__' as string, label: t('category_trend.all_accounts') },
            ...focusAccountOptions.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
      </div>

      <div className="card p-4 mb-4">
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => switchTab('asset')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium ${tab === 'asset' ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}
          >{t('dashboard.assets_total')}</button>
          <button
            onClick={() => switchTab('liability')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium ${tab === 'liability' ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}
          >{t('dashboard.liabilities_total')}</button>
        </div>
        <CompositionChart accounts={accounts} subAccounts={subAccounts} snapshots={snapshots} rates={rates} month={selectedMonth} base={base} hide={hide} type={tab} focusCat={filterCat} focusAccount={filterAccount} onClearFocus={() => { setFilterCat(''); setFilterAccount('') }} />
      </div>

      <div className="card p-4 mb-4">
        <h2 className="font-semibold text-sm mb-2">{t('analytics.category_trend')}</h2>
        <CategoryTrendChart
          accounts={accounts}
          subAccounts={subAccounts}
          snapshots={snapshots}
          rates={rates}
          base={base}
          hide={hide}
          type={tab}
          focusCat={filterCat}
          focusAccount={filterAccount}
        />
      </div>

      <div className="card p-4 mb-4">
        <h2 className="font-semibold text-sm mb-2">{t('analytics.balance_flow')}</h2>
        <BalanceSankeyChart
          accounts={accounts}
          subAccounts={subAccounts}
          snapshots={snapshots}
          rates={rates}
          month={selectedMonth}
          base={base}
          hide={hide}
          type={tab}
          focusCat={filterCat}
          focusAccount={filterAccount}
        />
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-sm">{t('analytics.mom_ranking')}</h2>
            <div className="flex items-center rounded-md bg-slate-100 dark:bg-slate-800 p-0.5">
              <button
                onClick={() => { setChangeTab('up'); setChangePage(0) }}
                className={`px-2 py-0.5 text-xs rounded-md transition-colors ${
                  changeTab === 'up'
                    ? 'bg-white dark:bg-slate-700 text-red-500 font-medium shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {t("analytics.gainers")}
              </button>
              <button
                onClick={() => { setChangeTab('down'); setChangePage(0) }}
                className={`px-2 py-0.5 text-xs rounded-md transition-colors ${
                  changeTab === 'down'
                    ? 'bg-white dark:bg-slate-700 text-green-500 font-medium shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {t("analytics.losers")}
              </button>
            </div>
          </div>
          {filteredChanges.length > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-400 mr-1">{t('analytics.per_page')}</span>
              {[5, 10].map((size) => (
                <button
                  key={size}
                  onClick={() => { setChangePageSize(size); setChangePage(0) }}
                  className={`px-2 py-0.5 rounded-md transition-colors ${
                    changePageSize === size
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          )}
        </div>
        {filteredChanges.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-4">{t('analytics.no_change_data')}</div>
        ) : (
          <>
            <div className="space-y-2.5">
              {paginatedChanges.map(({ account, diff }) => (
                <div key={account.id} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: account.color }}>
                    <Icon name={account.icon} size={18} />
                  </div>
                  <div className="flex-1 text-sm">{account.name}</div>
                  <div className={`text-sm font-medium tabular-nums ${changeColorClass(diff)}`}>
                    {diff.gte(0) ? '+' : ''}{formatMoney(diff, base, hide)}
                  </div>
                </div>
              ))}
            </div>
            {totalChangePages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => setChangePage((p) => Math.max(0, p - 1))}
                  disabled={safeChangePage === 0}
                  className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-slate-500 tabular-nums">
                  {safeChangePage + 1} / {totalChangePages}
                </span>
                <button
                  onClick={() => setChangePage((p) => Math.min(totalChangePages - 1, p + 1))}
                  disabled={safeChangePage === totalChangePages - 1}
                  className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 月份选择器（与记账页一致） */}
      {showMonthPicker && (
        <MonthPicker
          month={selectedMonth}
          onSelect={setSelectedMonth}
          onClose={() => setShowMonthPicker(false)}
        />
      )}
    </div>
  )
}
