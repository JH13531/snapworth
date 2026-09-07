import EChart from '@/components/EChart'
import { useMemo, useState } from 'react'
import type { Account, SubAccount, Snapshot, ExchangeRate } from '@/types'
import { rateFor, buildSnapshotMap, formatMoney } from '@/lib/money'
import { categoryLabel, subAccountName, subAccountIcon, subAccountColor } from '@/types'
import { Icon } from '@/components/Icon'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import Decimal from 'decimal.js'

interface Props {
  accounts: Account[]
  subAccounts?: SubAccount[]
  snapshots: Snapshot[]
  rates: ExchangeRate[]
  month: string
  base: string
  hide: boolean
  type?: 'asset' | 'liability'
  focusCat?: string | null
  focusAccount?: string | null
  onClearFocus?: () => void
}

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6', '#84cc16', '#64748b']

export default function CompositionChart({ accounts, subAccounts = [], snapshots, rates, month, base, hide, type = 'asset', focusCat, focusAccount, onClearFocus }: Props) {
  const { t } = useTranslation()
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const hasSubs = subAccounts.length > 0

  // 双筛选：分类焦点直接下钻；账户焦点下钻到其所属分类并高亮该账户
  const focusAccountId = focusAccount || null
  const focusCategory =
    focusCat || (focusAccount ? accounts.find((a) => a.id === focusAccount)?.category ?? null : null)
  const drilledCategory = focusCategory ?? selectedCategory

  const accountMap = useMemo(() => {
    const m = new Map<string, Account>()
    for (const a of accounts) m.set(a.id, a)
    return m
  }, [accounts])

  const { catData } = useMemo(() => {
    const catMap = new Map<string, Decimal>()
    const snapMap = buildSnapshotMap(snapshots)
    const units = hasSubs ? subAccounts : accounts
    for (const unit of units) {
      if (unit.type !== type || unit.archived || !unit.include_in_networth) continue
      const accId = hasSubs ? (unit as SubAccount).account_id : (unit as Account).id
      const subId = hasSubs ? (unit as SubAccount).id : undefined
      const snapKey = subId ? `${accId}|${month}|${subId}` : `${unit.id}|${month}`
      const snap = subId
        ? snapMap.get(snapKey)
        : snapMap.get(snapKey) ?? snapMap.get(`${accId}|${month}`)
      if (!snap) continue
      const rate = rateFor(rates, snap.currency ?? unit.currency, month, base)
      if (!rate) continue
      const val = new Decimal(snap.balance).mul(rate)
      catMap.set(unit.category, (catMap.get(unit.category) ?? new Decimal(0)).add(val))
    }
    const data = [...catMap.entries()]
      .map(([key, val]) => ({ name: categoryLabel(key), value: val.toNumber(), key }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
    return { catData: data }
  }, [accounts, subAccounts, hasSubs, snapshots, rates, month, base, type])

  const itemList = useMemo(() => {
    if (!drilledCategory) return []
    const snapMap = buildSnapshotMap(snapshots)
    const list: { id: string; name: string; accountId: string; value: Decimal; icon: string; color: string }[] = []
    const units = hasSubs ? subAccounts : accounts
    for (const unit of units) {
      if (unit.category !== drilledCategory || unit.type !== type || unit.archived || !unit.include_in_networth) continue
      const accId = hasSubs ? (unit as SubAccount).account_id : (unit as Account).id
      const subId = hasSubs ? (unit as SubAccount).id : undefined
      const snapKey = subId ? `${accId}|${month}|${subId}` : `${unit.id}|${month}`
      const snap = subId
        ? snapMap.get(snapKey)
        : snapMap.get(snapKey) ?? snapMap.get(`${accId}|${month}`)
      if (!snap) continue
      const rate = rateFor(rates, snap.currency ?? unit.currency, month, base)
      if (!rate) continue
      const account = accountMap.get(accId)
      const name = hasSubs ? subAccountName(unit as SubAccount, accountMap.get(accId)?.name) : (unit as Account).name
      const icon = hasSubs ? subAccountIcon(unit as SubAccount) : (unit as Account).icon
      const color = hasSubs ? subAccountColor(unit as SubAccount, account?.color) : (unit as Account).color
      list.push({ id: unit.id, name, accountId: accId, value: new Decimal(snap.balance).mul(rate), icon, color })
    }
    return list.sort((a, b) => b.value.toNumber() - a.value.toNumber())
  }, [drilledCategory, accounts, subAccounts, hasSubs, accountMap, snapshots, rates, month, base, type])

  const categoryTotal = itemList.reduce((s, x) => s + x.value.toNumber(), 0)

  const pieOption = useMemo(() => {
    const data = catData.map((d, i) => ({ ...d, itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] } }))
    return {
      tooltip: {
        formatter: (p: { name: string; value: number; percent: number }) =>
          `<b>${p.name}</b><br/>${hide ? '****' : formatMoney(p.value, base)} (${p.percent}%)`,
      },
      series: [{
        type: 'pie',
        radius: ['38%', '62%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        // 小扇区（如占比 <1% 的分类）按真实角度几乎不可见，
        // 给一个最小角度保证可被看见、可 hover、可点击下钻。
        minAngle: 3,
        labelLine: { length: 12, length2: 8, smooth: true },
        itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
        data,
        label: {
          show: true,
          fontSize: 11,
          // 所有扇区都显示标签（含占比极小的分类），重叠交给 avoidLabelOverlap 处理
          formatter: (params: { name: string; percent: number }) =>
            `{name|${params.name}}\n{percent|${params.percent}%}`,
          rich: {
            name: { fontSize: 11, color: 'auto' },
            percent: { fontSize: 10, fontWeight: 'bold', color: 'auto', padding: [2, 0, 0, 0] },
          },
          minMargin: 4,
        },
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.2)' },
          scale: true,
          scaleSize: 6,
        },
      }],
    }
  }, [catData, base, hide])

  if (catData.length === 0) {
    return (
      <div className="py-8 text-center text-slate-400 text-sm">
        {t('composition.no_data_type', { type: t(type === 'asset' ? 'accounts.asset' : 'accounts.liability') })}
      </div>
    )
  }

  if (drilledCategory) {
    const backToFocus = !!(focusCat || focusAccount)
    return (
      <div>
        <button
          onClick={() => (backToFocus ? onClearFocus?.() : setSelectedCategory(null))}
          className="flex items-center gap-1 text-sm text-brand-600 mb-3 -ml-1"
        >
          <ChevronLeft size={16} /> {categoryLabel(drilledCategory)}
        </button>
        <div className="text-xs text-slate-400 mb-2">{t('composition.total')} {formatMoney(categoryTotal, base, hide)}</div>
        <div className="max-h-60 overflow-y-auto">
          {itemList.map((item) => {
            const isFocus = item.accountId === focusAccountId
            return (
            <Link
              key={item.id}
              to={`/accounts/${item.accountId}`}
              className={`flex items-center gap-2.5 py-2 border-b border-slate-50 dark:border-slate-800/50 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${isFocus ? 'bg-brand-50 dark:bg-brand-950/60' : ''}`}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                style={{ backgroundColor: item.color }}
              >
                <Icon name={item.icon} size={16} />
              </div>
              <div className="flex-1 text-sm truncate">{item.name}</div>
              <div className="text-sm tabular-nums font-medium">{formatMoney(item.value, base, hide)}</div>
            </Link>
            )
          })}
        </div>
        {itemList.length === 0 && (
          <div className="py-4 text-center text-slate-400 text-sm">{t('common.no_data')}</div>
        )}
      </div>
    )
  }

  return (
    <div>
      <EChart
        option={pieOption}
        style={{ height: 220 }}
        onEvents={{
          click: (params: { name?: string; data?: { key?: string } }) => {
            const key = params.data?.key
            if (key) setSelectedCategory(key)
          },
        }}
      />
    </div>
  )
}
