import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Pencil, ChevronRight } from 'lucide-react'
import EChart from '@/components/EChart'
import Skeleton from '@/components/Skeleton'
import { useAccount, useSubAccounts, useAccountSnapshots, useExchangeRates } from '@/hooks/useData'
import { useSettingsStore } from '@/store/settings'
import { rateFor, formatMoney, buildSnapshotMap } from '@/lib/money'
import { formatMonth } from '@/lib/date'
import { subAccountName, subAccountIcon, subAccountColor } from '@/types'
import { formatCompact } from '@/lib/i18n-locale'
import Decimal from 'decimal.js'
import { Icon } from '@/components/Icon'
import { useTranslation } from '@/lib/i18n'

export default function AccountDetailPage() {
  const { id } = useParams()
  const account = useAccount(id)
  const subAccounts = useSubAccounts({ accountId: id ?? '', includeArchived: true })
  const snaps = useAccountSnapshots(id ?? '')
  const rates = useExchangeRates()
  const { settings } = useSettingsStore()
  const base = settings?.base_currency ?? 'CNY'
  const hide = settings?.privacy_mode ?? false
  const invert = settings?.invert_change_color ?? false
  const { t } = useTranslation()
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null)

  const activeSubs = useMemo(() =>
    subAccounts.filter((s) => !s.archived).sort((a, b) => a.sort_order - b.sort_order),
    [subAccounts]
  )

  const allMonths = useMemo(() => {
    const set = new Set(snaps.map((s) => s.month))
    return [...set].sort()
  }, [snaps])

  const snapMap = useMemo(() => buildSnapshotMap(snaps), [snaps])

  // Total trend (all sub-accounts combined in base currency)
  const totalChartOption = useMemo(() => {
    if (!account || activeSubs.length === 0) return {}
    const values = allMonths.map((month) => {
      let total = new Decimal(0)
      for (const sa of activeSubs) {
        const snap = snapMap.get(`\${account.id}|\${month}|\${sa.id}`)
        if (!snap || !snap.balance) continue
        const rate = rateFor(rates, snap.currency ?? sa.currency, month, base)
        if (!rate) continue
        const balance = new Decimal(snap.balance)
        if (sa.type === 'asset') total = total.add(balance.mul(rate))
        else total = total.sub(balance.mul(rate))
      }
      return total.isZero() && allMonths.indexOf(month) === 0 ? null : total.toNumber()
    })
    return {
      grid: { left: 10, right: 10, top: 10, bottom: 30, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: (p: { axisValue: string; value: number }[]) =>
          `<b>${formatMonth(p[0].axisValue)}</b><br/>${hide ? '****' : formatMoney(p[0].value, base)}`,
      },
      xAxis: { type: 'category', data: allMonths, axisLabel: { color: '#94a3b8', fontSize: 11, formatter: (v: string) => v.slice(5) }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: '#94a3b8', fontSize: 11, formatter: (v: number) => hide ? '****' : (formatCompact(v)) }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } } },
      series: [{
        type: 'line', data: values, smooth: true, symbol: 'circle', symbolSize: 5,
        lineStyle: { width: 2.5, color: account.color },
        itemStyle: { color: account.color },
        areaStyle: { opacity: 0.1, color: account.color },
      }],
    }
  }, [allMonths, snapMap, rates, account, base, hide, activeSubs])

  // Individual sub-account trend
  const selectedSub = selectedSubId ? activeSubs.find((s) => s.id === selectedSubId) : null
  const subChartOption = useMemo(() => {
    if (!selectedSub || !account) return {}
    const values = allMonths.map((month) => {
      const snap = snapMap.get(`\${account.id}|\${month}|\${selectedSub.id}`)
      if (!snap || !snap.balance) return null
      const rate = rateFor(rates, snap.currency ?? selectedSub.currency, month, base)
      if (!rate) return null
      return new Decimal(snap.balance).mul(rate).toNumber()
    })
    const isLiability = selectedSub.type === 'liability'
    return {
      grid: { left: 10, right: 10, top: 10, bottom: 30, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: (p: { axisValue: string; value: number }[]) =>
          `<b>${formatMonth(p[0].axisValue)}</b><br/>${hide ? '****' : formatMoney(p[0].value, base)}`,
      },
      xAxis: { type: 'category', data: allMonths, axisLabel: { color: '#94a3b8', fontSize: 11, formatter: (v: string) => v.slice(5) }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: '#94a3b8', fontSize: 11, formatter: (v: number) => hide ? '****' : (formatCompact(v)) }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } } },
      series: [{
        type: 'line', data: values, smooth: true, symbol: 'circle', symbolSize: 5,
        lineStyle: { width: 2.5, color: isLiability ? '#ef4444' : account.color },
        itemStyle: { color: isLiability ? '#ef4444' : account.color },
        areaStyle: { opacity: 0.1, color: isLiability ? '#ef4444' : account.color },
      }],
    }
  }, [selectedSub, allMonths, snapMap, rates, account, base, hide])

  // Latest balances per sub-account
  const latestBalances = useMemo(() => {
    return activeSubs.map((sa) => {
      const latest = allMonths
        .slice()
        .reverse()
        .find((m) => snapMap.has(`${account?.id}|${m}|${sa.id}`) || snapMap.has(`${account?.id}|${m}`))
      const snap = snapMap.get(`\${account?.id}|\${latest}|\${sa.id}`)
      return {
        sub: sa,
        balance: snap?.balance ?? null,
        currency: snap?.currency ?? sa.currency,
        month: latest,
        
      }
    })
  }, [activeSubs, allMonths, snapMap, rates, base, account?.id])

  if (!account) {
    return (
      <div className="px-4 lg:px-8 pt-4">
        <div className="flex items-center gap-3 mb-4">
          <Skeleton width="2.5rem" height="2.5rem" circle />
          <div className="space-y-1.5">
            <Skeleton width="6rem" height="1.25rem" />
            <Skeleton width="4rem" height="0.75rem" />
          </div>
        </div>
        <div className="card p-4 mb-4">
          <Skeleton width="100%" height="12.5rem" />
        </div>
        <div className="card overflow-hidden">
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton width="4rem" height="0.875rem" />
                <Skeleton width="5rem" height="0.875rem" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 lg:px-8 pt-4 pb-8">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/accounts" className="btn-ghost p-2 -ml-2"><ArrowLeft size={20} /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{account.name}</h1>
          <div className="text-xs text-slate-500">{t('accounts.subaccount_count', { count: activeSubs.length })}</div>
        </div>
        <Link to={`/accounts/${account.id}/edit`} className="btn-ghost p-2 text-slate-400">
          <Pencil size={18} />
        </Link>
      </div>

      <div className="card p-4 mb-4">
        <div className="text-xs text-slate-500 mb-1">{t('dashboard.assets_total')} ({base})</div>
        <EChart option={totalChartOption} style={{ height: 200 }} />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium text-slate-500">{t("account_edit.subaccounts")}</div>
        <Link to={`/accounts/${account.id}/edit`} className="text-xs text-brand-600">
          {t("common.edit")}
        </Link>
      </div>

      <div className="card overflow-hidden mb-4">
        {latestBalances.length === 0 && (
          <div className="p-8 text-center text-slate-400">{t("account_detail.no_subaccounts")}</div>
        )}
        {latestBalances.map(({ sub, balance, currency, month }) => {
          const isSelected = selectedSubId === sub.id
          return (
            <button
              key={sub.id}
              onClick={() => setSelectedSubId(isSelected ? null : sub.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-3 text-left border-b border-slate-50 dark:border-slate-800/50 last:border-b-0 ${
                isSelected ? 'bg-slate-50 dark:bg-slate-800/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
              }`}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                style={{ backgroundColor: subAccountColor(sub, account.color) }}
              >
                <Icon name={subAccountIcon(sub)} size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{subAccountName(sub, account?.name)}</div>
                <div className="text-[11px] text-slate-400">
                  {currency}
                  {sub.type === 'liability' && t('account_detail.liability_suffix')}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm tabular-nums font-medium">
                  {balance != null ? formatMoney(balance, currency ?? sub.currency, hide) : '—'}
                </div>
                {month && (
                  <div className="text-[10px] text-slate-400">{formatMonth(month)}</div>
                )}
              </div>
              <ChevronRight size={14} className={`text-slate-300 shrink-0 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
            </button>
          )
        })}
      </div>

      {selectedSub && (
        <div className="card p-4 mb-4">
          <div className="text-xs text-slate-500 mb-1">
            {subAccountName(selectedSub, account?.name)} · {t('account_detail.balance_trend')} ({base})
          </div>
          <EChart option={subChartOption} style={{ height: 180 }} />
        </div>
      )}

      {selectedSub && allMonths.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100 dark:border-slate-800">
                <th className="text-left px-4 py-2.5 font-medium">{t('rates.month')}</th>
                <th className="text-right px-4 py-2.5 font-medium">{t('entry.this_month')} ({selectedSub.currency})</th>
                <th className="text-right px-4 py-2.5 font-medium">{t('dashboard.mom_change')}</th>
              </tr>
            </thead>
            <tbody>
              {allMonths.slice().reverse().map((m, i, arr) => {
                const snap = snapMap.get(`\${account.id}|\${m}|\${selectedSub.id}`)
                const prevM = arr[i + 1]
                const prevSnap = prevM ? (snapMap.get(`\${account.id}|\${prevM}|\${selectedSub.id}`)) : null
                const diff = snap && prevSnap && snap.balance && prevSnap.balance
                  ? new Decimal(snap.balance).sub(new Decimal(prevSnap.balance))
                  : null
                const diffUp = diff ? (selectedSub.type === 'asset' ? diff.gte(0) : diff.lte(0)) : false
                const diffColor = !diff || diff.isZero() ? 'text-slate-300'
                  : invert
                    ? (diffUp ? 'text-green-500' : 'text-red-500')
                    : (diffUp ? 'text-red-500' : 'text-green-500')
                return (
                  <tr key={m} className="border-b border-slate-50 dark:border-slate-800/50 last:border-b-0">
                    <td className="px-4 py-3">
                      <div>{formatMonth(m)}</div>
                      {snap?.recorded_at && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {t("entry.recorded_on")} {new Date(snap.recorded_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                        </div>
                      )}
                    </td>
                    <td className="text-right px-4 py-3 tabular-nums">
                      {snap?.balance ? formatMoney(snap.balance, snap.currency ?? selectedSub.currency, hide) : '—'}
                    </td>
                    <td className={`text-right px-4 py-3 tabular-nums ${diffColor}`}>
                      {diff ? `${diff.gte(0) ? '+' : ''}${diff.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
