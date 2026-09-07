import { useState, useMemo, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Download, Loader2, Globe, MoreVertical } from 'lucide-react'
import { useExchangeRates, useSnapshots, useAccounts } from '@/hooks/useData'
import EChart from '@/components/EChart'
import { useSettingsStore } from '@/store/settings'
import { db } from '@/db'
import { CURRENCIES, currencyName } from '@/lib/currency'
import { allMonths } from '@/lib/money'
import { currentMonth } from '@/lib/date'
import { fetchRatesForMonth } from '@/lib/rates-api'
import Decimal from 'decimal.js'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/lib/i18n'

export default function RatesPage() {
  const rates = useExchangeRates()
  const snapshots = useSnapshots()
  const accounts = useAccounts({ includeArchived: true })
  const { settings, update: updateSettings } = useSettingsStore()
  const base = settings?.base_currency ?? 'CNY'
  const { toast } = useToast()
  const { t } = useTranslation()
  const [month, setMonth] = useState(currentMonth())
  const [newCurrency, setNewCurrency] = useState('')
  const [newRate, setNewRate] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchMsg, setFetchMsg] = useState('')
  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const usedForeignCurrencies = useMemo(
    () => [...new Set(accounts.map((a) => a.currency).filter((cur) => cur !== base))].sort(),
    [accounts, base],
  )

  const monthRates = rates.filter((r) => r.month === month)

  // Determine which foreign currencies have snapshots in this month but no rate yet
  // (We don't have accounts here directly; infer from rate history and snapshots' accounts.)
  // For the picker, just offer all non-base currencies.
  const availableCurrencies = CURRENCIES.filter((c) => c.code !== base)

  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  async function saveRate(currency: string, value: string, rateDate?: string) {
    const val = value.trim()
    if (val === '') return
    try { new Decimal(val) } catch { toast(t('toast.invalid_number'), 'warning'); return }
    const now = new Date().toISOString()
    const existing = await db.exchangeRates.get([month, currency])
    if (existing) {
      await db.exchangeRates.update([month, currency], { rate_to_base: val, rate_date: rateDate, updated_at: now })
    } else {
      await db.exchangeRates.add({
        month, currency, rate_to_base: val, rate_date: rateDate, created_at: now, updated_at: now,
      })
    }
    setNewCurrency('')
    setNewRate('')
  }

  async function deleteRate(currency: string) {
    await db.exchangeRates.delete([month, currency])
  }

  async function autoFetch() {
    setFetching(true)
    setFetchMsg('')
    let success = false
    try {
      const targetCurrencies = usedForeignCurrencies.length > 0 ? usedForeignCurrencies : CURRENCIES.map((c) => c.code).filter((c) => c !== base)
      const result = await fetchRatesForMonth(base, month, targetCurrencies)
      const now = new Date().toISOString()
      let count = 0
      for (const [cur, rate] of Object.entries(result.rates)) {
        const val = rate.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
        const existing = await db.exchangeRates.get([month, cur])
        if (existing) {
          if (existing.rate_to_base !== val || existing.rate_date !== result.rate_date) {
            await db.exchangeRates.update([month, cur], { rate_to_base: val, rate_date: result.rate_date, updated_at: now })
            count++
          }
        } else {
          await db.exchangeRates.add({ month, currency: cur, rate_to_base: val, rate_date: result.rate_date, created_at: now, updated_at: now })
          count++
        }
      }
      setFetchMsg(count > 0 ? t('rates.status_updated', { count, date: result.rate_date }) : t('rates.status_already_latest', { date: result.rate_date }))
      success = true
    } catch (e) {
      setFetchMsg(e instanceof Error ? e.message : t('toast.fetch_failed'))
    } finally {
      setFetching(false)
      if (success) setTimeout(() => setFetchMsg(''), 5000)
    }
  }

  /**
   * 补全所有历史月份缺失的外币汇率。
   * 扫描全部快照找出外币账户出现过的月份，逐月拉取。
   */
  async function backfillAll(force = false) {
    if (usedForeignCurrencies.length === 0) {
      setBackfillMsg(t('rates.status_no_foreign'))
      setTimeout(() => setBackfillMsg(''), 4000)
      return
    }
    setBackfilling(true)
    setBackfillMsg('')
    try {
      // 找出所有快照出现过的月份
      const allMonths = [...new Set(snapshots.map((s) => s.month))].sort()
      if (allMonths.length === 0) {
        setBackfillMsg(t('rates.status_no_snapshots'))
        return
      }

      // 已有汇率键集合
      const existingRates = await db.exchangeRates.toArray()
      const rateKeys = new Set(existingRates.map((r) => `${r.month}|${r.currency}`))

      // 按月份找需要处理的币种
      const monthToMissing: Array<[string, string[]]> = []
      for (const m of allMonths) {
        if (force) {
          // 强制重获取：所有有快照的外币月份都处理
          monthToMissing.push([m, usedForeignCurrencies])
        } else {
          const missing = usedForeignCurrencies.filter((cur) => !rateKeys.has(`${m}|${cur}`))
          if (missing.length > 0) monthToMissing.push([m, missing])
        }
      }

      if (monthToMissing.length === 0) {
        setBackfillMsg(force ? t('rates.status_nothing_to_refetch') : t('rates.status_all_complete'))
        setTimeout(() => setBackfillMsg(''), 4000)
        return
      }

      const now = new Date().toISOString()
      let totalWritten = 0
      const successMonths: string[] = []
      const failedMonths: string[] = []
      const rateDates = new Set<string>()
      for (const [m, missing] of monthToMissing) {
        try {
          const result = await fetchRatesForMonth(base, m, missing)
          for (const [cur, rate] of Object.entries(result.rates)) {
            const rateStr = rate.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
            const key: [string, string] = [m, cur]
            const existing = await db.exchangeRates.get(key)
            if (existing) {
              await db.exchangeRates.update(key, { rate_to_base: rateStr, rate_date: result.rate_date, updated_at: now })
            } else {
              await db.exchangeRates.add({
                month: m, currency: cur, rate_to_base: rateStr,
                rate_date: result.rate_date, created_at: now, updated_at: now,
              })
            }
            totalWritten++
          }
          successMonths.push(m)
          if (result.rate_date) rateDates.add(result.rate_date)
        } catch {
          failedMonths.push(m)
        }
      }
      const parts: string[] = []
      parts.push(t('rates.status_backfill_done', { months: successMonths.length, records: totalWritten }))
      if (successMonths.length > 0) {
        const sortedDates = [...rateDates].sort()
        if (sortedDates.length > 0) {
          parts.push(t('rates.status_date_range', { from: sortedDates[0], to: sortedDates[sortedDates.length - 1] }))
        }
        const uniqueVals = new Set<string>()
        const allRates = await db.exchangeRates.toArray()
        for (const r of allRates) {
          if (usedForeignCurrencies.includes(r.currency)) {
            uniqueVals.add(r.rate_to_base + '|' + r.currency)
          }
        }
      }
      if (failedMonths.length > 0) {
        parts.push(t('rates.status_failed_months', { count: failedMonths.length, months: failedMonths.slice(0, 5).join(', ') + (failedMonths.length > 5 ? '...' : '') }))
        parts.push(t('rates.status_failed_api_note'))
      }
      setBackfillMsg(parts.join('\n'))
      // 失败时保持显示，成功 12 秒后消失
      if (failedMonths.length === 0) {
        setTimeout(() => setBackfillMsg(''), 12000)
      }
    } catch (e) {
      setBackfillMsg(t('rates.status_backfill_failed'))
      return  // 失败时不自动消失，让用户看清错误
    } finally {
      setBackfilling(false)
    }
  }

  const monthsWithRates = useMemo(() => {
    const set = new Set(rates.map((r) => r.month))
    for (const m of allMonths(snapshots)) set.add(m)
    set.add(currentMonth())
    return [...set].sort().reverse()
  }, [rates, snapshots])

  return (
    <div className="px-4 lg:max-w-2xl lg:mx-auto pt-4 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/settings" className="btn-ghost p-2 -ml-2"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold">{t('rates.title')}</h1>
      </div>

      <div className="card p-4 mb-4">
        <label className="label">{t('rates.month')}</label>
        <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
          {monthsWithRates.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <p className="text-xs text-slate-400 mt-2">
          {t('rates.rate_desc', { base })}
        </p>
        {usedForeignCurrencies.length === 0 ? (
          <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
            <div className="font-medium mb-1">{t('rates.no_foreign_accounts')}</div>
              <p className="text-amber-600/80 dark:text-amber-200/80">
                {t('rates.no_foreign_accounts_desc', { base })}
              </p>
          </div>
        ) : (
          <div ref={menuRef} className="relative mt-3">
            <div className="flex gap-2">
              <button
                onClick={() => backfillAll(false)}
                disabled={backfilling}
                className="btn-secondary flex-1"
              >
                {backfilling ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {backfilling ? t('rates.fetching') : t('rates.fetch_rates')}
              </button>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                disabled={backfilling}
                className="btn-secondary px-3"
                title={t('rates.more_options')}
              >
                <MoreVertical size={16} />
              </button>
            </div>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-100 dark:border-slate-800 py-1 z-50 text-sm">
                <button
                  onClick={() => { setMenuOpen(false); autoFetch() }}
                  disabled={backfilling || fetching}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-50"
                >
                  <Download size={14} className="shrink-0" />
                  <span>{t('rates.update_this_month')}</span>
                </button>

              </div>
            )}
            <div className="group relative mt-2">
              <p className="text-xs text-slate-400">
                <span className="border-b border-dashed border-slate-300 dark:border-slate-600 cursor-help">{t('rates.only_fill_missing')} ↗</span>
              </p>
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-10 w-60 p-3 rounded-lg bg-slate-800 text-white text-xs leading-relaxed shadow-lg">
                <div className="font-medium mb-1">{t('rates.rules_title')}</div>
                <div>• {t('rates.rules_only_missing')}</div>
                <div>• {t('rates.rules_current')}</div>
                <div>• {t('rates.rules_source')}</div>
              </div>
            </div>
            {(fetchMsg || backfillMsg) && (
              <p className="text-xs text-slate-500 mt-2 whitespace-pre-line leading-relaxed">
                {backfillMsg || fetchMsg}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 自动获取设置 + 数据来源 */}
      <div className="card p-4 mb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{t('rates.auto_fetch_settings')}</div>
            <div className="text-xs text-slate-400 mt-0.5">{t('rates.auto_fetch_desc')}</div>
          </div>
          <button
            onClick={() => updateSettings({ auto_fetch_rates: !settings?.auto_fetch_rates })}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-3 ${settings?.auto_fetch_rates ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings?.auto_fetch_rates ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        <div className="flex items-start gap-2 text-xs text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Globe size={14} className="shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 leading-relaxed">
            <div>
              {t('rates.history_ecb')}
            </div>
            <div className="mt-0.5">
              {t('rates.current_api')}
            </div>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-sm font-medium">{t('rates.month_rates', { month })}</span>
          <span className="text-xs text-slate-400">{t('rates.per_foreign', { base })}</span>
        </div>
        {monthRates.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="text-sm text-slate-400 mb-2">{t('rates.no_records')}</div>
            {usedForeignCurrencies.length > 0 && (
              <div className="text-xs text-slate-400">
                {t('rates.have_foreign_accounts', { count: usedForeignCurrencies.length, names: usedForeignCurrencies.join('、') })}
              </div>
            )}
          </div>
        ) : (
          monthRates
            .slice()
            .sort((a, b) => a.currency.localeCompare(b.currency))
            .map((r) => (
              <div key={r.currency} className="px-4 py-3 flex items-center gap-3 border-b border-slate-50 dark:border-slate-800/50 last:border-0">
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.currency}</div>
                  <div className="text-xs text-slate-400">
                    {CURRENCIES.find((c) => c.code === r.currency)?.name ? currencyName(CURRENCIES.find((c) => c.code === r.currency)!) : r.currency}
                    {r.rate_date && <span className="ml-2">· {r.rate_date}</span>}
                  </div>
                </div>
                <input
                  key={`${month}-${r.currency}`}
                  type="number"
                  step="0.0001"
                  defaultValue={r.rate_to_base}
                  className="w-28 text-right rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500 bg-transparent"
                  onBlur={(e) => { if (e.target.value !== r.rate_to_base) saveRate(r.currency, e.target.value) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                />
                <button onClick={() => deleteRate(r.currency)} className="p-2 text-slate-400 hover:text-red-500">
                  <Trash2 size={16} />
                </button>
              </div>
            ))
        )}
      </div>

      {/* 汇率历史概览 */}
      {usedForeignCurrencies.length > 0 && monthsWithRates.length > 1 && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">{t('rates.rate_overview')}</div>
            <div className="text-[10px] text-slate-400">{t('rates.click_to_switch')}</div>
          </div>
          <div className="space-y-2">
            {usedForeignCurrencies.map((cur) => {
              const curRates = rates
                .filter((r) => r.currency === cur)
                .sort((a, b) => a.month.localeCompare(b.month))
              const uniqueVals = new Set(curRates.map((r) => r.rate_to_base))
              const allSame = uniqueVals.size <= 1
              const chartOption = {
                grid: { left: 40, right: 10, top: 10, bottom: 20, containLabel: true },
                tooltip: {
                  trigger: 'axis',
                  formatter: (params: { name: string; value: number }[]) => {
                    const p = params[0]
                    const r = curRates.find((x) => x.month === p.name)
                    const dateLine = r?.rate_date ? `<br/><span style="opacity:0.7">${t('rates.data_date', { date: r.rate_date })}</span>` : ''
                    return `<b>${p.name}</b><br/>1 ${cur} = ${p.value} ${base}${dateLine}`
                  },
                },
                xAxis: {
                  type: 'category',
                  data: curRates.map((r) => r.month),
                  axisLabel: { color: '#94a3b8', fontSize: 10, formatter: (v: string) => v.slice(5) },
                  axisLine: { lineStyle: { color: '#e2e8f0' } },
                  axisTick: { show: false },
                },
                yAxis: {
                  type: 'value',
                  scale: true,
                  axisLabel: { color: '#94a3b8', fontSize: 10, formatter: (v: number) => v.toFixed(4) },
                  splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } },
                },
                series: [{
                  type: 'line',
                  data: curRates.map((r) => parseFloat(r.rate_to_base)),
                  smooth: true,
                  symbol: 'circle',
                  symbolSize: (_val: number, params: { dataIndex: number }) => curRates[params.dataIndex].month === month ? 8 : 4,
                  lineStyle: { width: 2, color: '#3b82f6' },
                  itemStyle: {
                    color: (params: { dataIndex: number }) => curRates[params.dataIndex].month === month ? '#3b82f6' : '#93c5fd',
                    borderColor: '#fff',
                    borderWidth: 1,
                  },
                  areaStyle: { opacity: 0.1, color: '#3b82f6' },
                }],
              }
              return (
                <div key={cur}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">{cur}</span>
                    <span className={`text-[10px] ${allSame ? 'text-amber-500' : 'text-slate-400'}`}>
                      {allSame && curRates.length > 1 ? t('rates.all_same') : t('rates.different_values', { count: uniqueVals.size })}
                    </span>
                  </div>
                  <EChart
                    option={chartOption}
                    style={{ height: 100 }}
                    onEvents={{
                      click: (params: { name?: string }) => {
                        if (params.name && curRates.some((r) => r.month === params.name)) {
                          setMonth(params.name)
                        }
                      },
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="text-sm font-medium mb-3">{t('rates.add_custom_rate')}</div>
        <div className="flex gap-2">
          <select
            className="input flex-1"
            value={newCurrency}
            onChange={(e) => setNewCurrency(e.target.value)}
          >
            <option value="">{t('rates.select_currency')}</option>
            {availableCurrencies
              .filter((c) => !monthRates.some((r) => r.currency === c.code))
              .map((c) => <option key={c.code} value={c.code}>{c.code} - {currencyName(c)}</option>)}
          </select>
          <input
            type="number"
            step="0.0001"
            className="input w-32"
            placeholder={t('rates.enter_rate')}
            value={newRate}
            onChange={(e) => setNewRate(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newCurrency) saveRate(newCurrency, newRate) }}
          />
          <button
            onClick={() => newCurrency && saveRate(newCurrency, newRate)}
            disabled={!newCurrency || !newRate}
            className="btn-primary px-3"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
