import { useMemo } from 'react'
import EChart from './EChart'
import { CATEGORIES, categoryLabel } from '@/types'
import type { Account, SubAccount, Snapshot, ExchangeRate } from '@/types'
import { buildSnapshotMap, rateFor, formatMoney } from '@/lib/money'
import { useTranslation } from '@/lib/i18n'
import Decimal from 'decimal.js'

interface Props {
  accounts: Account[]
  subAccounts?: SubAccount[]
  snapshots: Snapshot[]
  rates: ExchangeRate[]
  month: string
  base: string
  hide?: boolean
  /** 资产 / 负债视图；只渲染该类型的资金流向，与构成图、趋势图的 tab 保持一致 */
  type?: 'asset' | 'liability'
  focusCat?: string | null
  focusAccount?: string | null
}

export default function BalanceSankeyChart({ accounts, subAccounts = [], snapshots, rates, month, base, hide, type = 'asset', focusCat, focusAccount }: Props) {
  const { t } = useTranslation()
  const option = useMemo(() => {
    const rootAssets = t('sankey.total_assets')
    const rootLiabilities = t('sankey.total_liabilities')
    const amountLabel = t('sankey.amount')
    const snapMap = buildSnapshotMap(snapshots)
    const hasSubs = subAccounts.length > 0
    const accountMap = new Map<string, Account>()
    for (const a of accounts) accountMap.set(a.id, a)

    // 双筛选：分类焦点直接下钻；账户焦点下钻到其所属分类（与 CompositionChart 一致）
    const focusAccountId = focusAccount || null
    const focusCategory =
      focusCat || (focusAccount ? accounts.find((a) => a.id === focusAccount)?.category ?? null : null)

    const units = hasSubs ? subAccounts : accounts

    const visibleUnits = units.filter((u) => {
      if (u.archived || !u.include_in_networth) return false
      if (u.type !== type) return false
      if (hasSubs) {
        const acc = accountMap.get((u as SubAccount).account_id)
        if (!acc || acc.archived) return false
      }
      if (focusCategory && u.category !== focusCategory) return false
      if (focusAccountId) {
        const accId = hasSubs ? (u as SubAccount).account_id : (u as Account).id
        if (accId !== focusAccountId) return false
      }
      return true
    })

    const unitBalances = new Map<string, Decimal>()
    const unitNames = new Map<string, string>()
    const unitColors = new Map<string, string>()
    const unitCategories = new Map<string, string>()
    const unitTypes = new Map<string, 'asset' | 'liability'>()
    let totalAssets = new Decimal(0)
    let totalLiabilities = new Decimal(0)

    for (const u of visibleUnits) {
      const accId = hasSubs ? (u as SubAccount).account_id : (u as Account).id
      const subId = hasSubs ? (u as SubAccount).id : undefined
      const snapKey = subId ? `${accId}|${month}|${subId}` : `${u.id}|${month}`
      const snap = subId
        ? snapMap.get(snapKey)
        : snapMap.get(snapKey) ?? snapMap.get(`${accId}|${month}`)
      if (!snap) {
        unitBalances.set(u.id, new Decimal(0))
        continue
      }
      const rate = rateFor(rates, snap.currency ?? u.currency, month, base)
      const bal = new Decimal(snap.balance).mul(rate ?? 1)
      const absBal = bal.abs()
      unitBalances.set(u.id, absBal)
      unitCategories.set(u.id, u.category)
      unitTypes.set(u.id, u.type)
      if (hasSubs) {
        const sub = u as SubAccount
        const acc = accountMap.get(sub.account_id)
        unitNames.set(u.id, sub.name || categoryLabel(sub.category))
        unitColors.set(u.id, acc?.color ?? '#3b82f6')
      } else {
        unitNames.set(u.id, (u as Account).name)
        unitColors.set(u.id, (u as Account).color)
      }
      if (u.type === 'asset') {
        totalAssets = totalAssets.add(absBal)
      } else {
        totalLiabilities = totalLiabilities.add(absBal)
      }
    }

    const categorySums = new Map<string, Decimal>()
    const categoryUnits = new Map<string, string[]>()
    for (const u of visibleUnits) {
      const bal = unitBalances.get(u.id) ?? new Decimal(0)
      if (bal.isZero()) continue
      const cat = unitCategories.get(u.id)!
      categorySums.set(cat, (categorySums.get(cat) ?? new Decimal(0)).add(bal))
      if (!categoryUnits.has(cat)) categoryUnits.set(cat, [])
      categoryUnits.get(cat)!.push(u.id)
    }

    const nodes: Array<{ name: string; itemStyle?: { color: string } }> = []
    const links: Array<{ source: string; target: string; value: number; lineStyle?: { color: string; opacity: number } }> = []

    const usedRoots = new Set<string>()

    // 实际出现的分类（含用户自定义分类），按「资产在前、负债在后」排序。
    // 不能遍历固定 CATEGORIES，否则自定义分类的账户余额会在图里消失。
    const presentCats = Array.from(new Set(visibleUnits.map((u) => u.category)))
    const catMetaOf = (key: string): { type: 'asset' | 'liability' } => {
      const def = CATEGORIES.find((c) => c.key === key)
      if (def) return { type: def.type }
      const t = visibleUnits.find((u) => u.category === key)?.type
      return { type: t ?? 'asset' }
    }
    const catColorOf = (type: 'asset' | 'liability') => (type === 'asset' ? '#f97316' : '#06b6d4')
    presentCats.sort((a, b) => {
      const ta = catMetaOf(a).type === 'asset' ? 0 : 1
      const tb = catMetaOf(b).type === 'asset' ? 0 : 1
      return ta - tb || a.localeCompare(b)
    })

    for (const catKey of presentCats) {
      const sum = categorySums.get(catKey)
      if (!sum || sum.isZero()) continue
      const catName = categoryLabel(catKey)
      const cColor = catColorOf(catMetaOf(catKey).type)
      nodes.push({
        name: catName,
        itemStyle: { color: cColor },
      })
      const rootName = catMetaOf(catKey).type === 'asset' ? rootAssets : rootLiabilities
      usedRoots.add(rootName)
      links.push({
        source: rootName,
        target: catName,
        value: Number(sum.toFixed(2)),
        lineStyle: { color: cColor, opacity: 0.15 },
      })
    }

    for (const rootName of usedRoots) {
      nodes.push({
        name: rootName,
        itemStyle: { color: rootName === rootAssets ? '#ef4444' : '#22c55e' },
      })
    }

    for (const catKey of presentCats) {
      const unitIds = categoryUnits.get(catKey)
      if (!unitIds) continue
      const catName = categoryLabel(catKey)
      for (const uid of unitIds) {
        const u = visibleUnits.find((x) => x.id === uid)
        if (!u) continue
        const bal = unitBalances.get(uid) ?? new Decimal(0)
        if (bal.isZero()) continue
        let leafName = unitNames.get(uid)!
        // 节点名去重：若与已有节点（如分类名）冲突，追加父账户名而不是丢弃该节点，
        // 否则聚焦单个账户时该分支可能完全消失。顺序与 CategoryTrendChart 一致：
        // 「主账户 · 子账户」—— 容器先于细节。
        const existingNames = new Set(nodes.map((n) => n.name))
        if (existingNames.has(leafName)) {
          const accId = hasSubs ? (u as SubAccount).account_id : (u as Account).id
          const acc = accountMap.get(accId)
          leafName = `${acc?.name ?? uid} · ${leafName}`
        }
        nodes.push({
          name: leafName,
          itemStyle: { color: unitColors.get(uid) ?? "#3b82f6" },
        })
        links.push({
          source: catName,
          target: leafName,
          value: Number(bal.toFixed(2)),
          lineStyle: { color: unitColors.get(uid) ?? '#3b82f6', opacity: 0.25 },
        })
      }
    }

    const fmt = (v: number) => formatMoney(new Decimal(v), base, hide ?? false)

    return {
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        formatter: (params: { dataType: string; name: string; value: number }) => {
          if (params.dataType === 'edge') {
            return `${params.name}<br/>${amountLabel}: ${fmt(params.value)}`
          }
          return `${params.name}<br/>${amountLabel}: ${fmt(params.value)}`
        },
      },
      series: [
        {
          type: 'sankey',
          layout: 'none',
          emphasis: { focus: 'adjacency' },
          nodeAlign: 'justify',
          nodeGap: 8,
          nodeWidth: 12,
          layoutIterations: 32,
          left: '2%',
          right: '16%',
          top: '3%',
          bottom: '3%',
          data: nodes,
          links: links,
          label: {
            show: true,
            fontSize: 11,
            color: 'auto',
            // 不再硬截断节点名：完整显示，超长名字靠 series 的 right 边距留白容纳；
            // 用户悬停时 tooltip 同样给出完整名称兜底。
          },
          lineStyle: {
            curveness: 0.5,
          },
        },
      ],
    }
  }, [accounts, subAccounts, snapshots, rates, month, base, hide, type, t, focusCat, focusAccount])

  const hasData = option?.series?.[0]?.data?.length > 0 && option?.series?.[0]?.links?.length > 0

  if (!hasData) {
    return (
      <div className="w-full flex items-center justify-center text-sm text-slate-400" style={{ height: 320 }}>
        {t('common.no_data')}
      </div>
    )
  }

  return <EChart option={option} className="w-full" style={{ height: 320 }} />
}
