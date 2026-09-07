import { describe, it, expect, vi } from 'vitest'

// jsdom 无 matchMedia；必须在模块 import 之前注入
const { captured } = vi.hoisted(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as any
  }
  return { captured: [] as Record<string, any>[] }
})

vi.mock('@/components/EChart', () => ({
  default: ({ option }: { option: Record<string, any> }) => {
    captured.push(option)
    return null
  },
}))

import { render } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n'
import { useSettingsStore } from '@/store/settings'
import type { Account, SubAccount, Snapshot, ExchangeRate } from '@/types'

import BalanceSankeyChart from '@/components/BalanceSankeyChart'

const accounts: Account[] = [
  { id: 'a1', name: '富途证券', icon: 'trending-up', color: '#3b82f6', type: 'asset', category: 'investment', currency: 'CNY', include_in_networth: true, hidden: false, archived: false, sort_order: 0, created_at: '', updated_at: '' },
  { id: 'a2', name: '招商银行', icon: 'wallet', color: '#10b981', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, hidden: false, archived: false, sort_order: 1, created_at: '', updated_at: '' },
]

const subAccounts: SubAccount[] = [
  { id: 's1', account_id: 'a1', name: '投资现金', icon: 'wallet', color: '#3b82f6', type: 'asset', category: 'investment', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
  { id: 's2', account_id: 'a1', name: '股票', icon: 'trending-up', color: '#3b82f6', type: 'asset', category: 'investment', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 1, created_at: '', updated_at: '' },
  { id: 's3', account_id: 'a2', name: '活期', icon: 'wallet', color: '#10b981', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
]

const snapshots: Snapshot[] = [
  { id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '100', currency: 'CNY', recorded_at: '', created_at: '', updated_at: '' },
  { id: 'n2', account_id: 'a1', sub_account_id: 's2', month: '2026-09', balance: '200', currency: 'CNY', recorded_at: '', created_at: '', updated_at: '' },
  { id: 'n3', account_id: 'a2', sub_account_id: 's3', month: '2026-09', balance: '300', currency: 'CNY', recorded_at: '', created_at: '', updated_at: '' },
]

const rates: ExchangeRate[] = []

function leafNames(option: Record<string, any>): string[] {
  const data = option.series?.[0]?.data ?? []
  return data.map((n: any) => n.name)
}

describe('BalanceSankeyChart 受筛选器控制', () => {
  it('无筛选时包含全部账户/子账户叶子', () => {
    captured.length = 0
    render(
      <I18nProvider><BalanceSankeyChart
        accounts={accounts}
        subAccounts={subAccounts}
        snapshots={snapshots}
        rates={rates}
        month="2026-09"
        base="CNY"
      /></I18nProvider>,
    )
    const names = leafNames(captured[0])
    expect(names).toContain('投资现金')
    expect(names).toContain('股票')
    expect(names).toContain('活期')
  })

  it('focusAccount 时只显示该账户的子账户', () => {
    captured.length = 0
    render(
      <I18nProvider><BalanceSankeyChart
        accounts={accounts}
        subAccounts={subAccounts}
        snapshots={snapshots}
        rates={rates}
        month="2026-09"
        base="CNY"
        focusAccount="a2"
      /></I18nProvider>,
    )
    const names = leafNames(captured[0])
    expect(names).toContain('活期')
    expect(names).not.toContain('投资现金')
    expect(names).not.toContain('股票')
  })

  it('focusCat 时只显示该分类的节点', () => {
    captured.length = 0
    render(
      <I18nProvider><BalanceSankeyChart
        accounts={accounts}
        subAccounts={subAccounts}
        snapshots={snapshots}
        rates={rates}
        month="2026-09"
        base="CNY"
        focusCat="cash"
      /></I18nProvider>,
    )
    const names = leafNames(captured[0])
    expect(names).toContain('活期')
    expect(names).not.toContain('投资现金')
  })

  it('子账户名与分类名冲突时，去重为「主账户 · 子账户」顺序', () => {
    // 设 zh：分类 cash 渲染为「现金/活期」；子账户也叫「现金/活期」时与分类节点撞名 → 触发去重分支
    useSettingsStore.setState({ settings: { base_currency: 'CNY', language: 'zh' } as any, ready: true } as any)
    const dupAccounts: Account[] = [
      { id: 'a1', name: '富途证券', icon: 'wallet', color: '#3b82f6', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, hidden: false, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    ]
    const dupSubs: SubAccount[] = [
      // 子账户名 "现金/活期" 与分类 label "现金/活期" 完全撞名
      { id: 's1', account_id: 'a1', name: '现金/活期', icon: 'wallet', color: '#3b82f6', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    ]
    const dupSnaps: Snapshot[] = [
      { id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '100', currency: 'CNY', recorded_at: '', created_at: '', updated_at: '' },
    ]
    captured.length = 0
    render(
      <I18nProvider><BalanceSankeyChart
        accounts={dupAccounts}
        subAccounts={dupSubs}
        snapshots={dupSnaps}
        rates={rates}
        month="2026-09"
        base="CNY"
      /></I18nProvider>,
    )
    const names = leafNames(captured[0])
    // 旧顺序「子 · 主」是错的；正确应为「主 · 子」
    expect(names).toContain('富途证券 · 现金/活期')
    expect(names).not.toContain('现金/活期 · 富途证券')
  })

  it('自定义分类的账户也出现在 Funds Flow（不消失）', () => {
    const customAccounts: Account[] = [
      { id: 'a1', name: '养老金账户', icon: 'wallet', color: '#3b82f6', type: 'asset', category: '养老金', currency: 'CNY', include_in_networth: true, hidden: false, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    ]
    const customSubs: SubAccount[] = [
      { id: 's1', account_id: 'a1', name: '个人养老金', icon: 'wallet', color: '#3b82f6', type: 'asset', category: '养老金', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    ]
    const customSnaps: Snapshot[] = [
      { id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '100', currency: 'CNY', recorded_at: '', created_at: '', updated_at: '' },
    ]
    captured.length = 0
    render(
      <I18nProvider><BalanceSankeyChart
        accounts={customAccounts}
        subAccounts={customSubs}
        snapshots={customSnaps}
        rates={rates}
        month="2026-09"
        base="CNY"
      /></I18nProvider>,
    )
    const names = leafNames(captured[0])
    // 「养老金」不在 CATEGORIES 里；以前遍历固定 CATEGORIES 会把它漏掉，导致该账户在图里消失
    expect(names).toContain('个人养老金')
    expect(names).toContain('养老金')
  })
})
