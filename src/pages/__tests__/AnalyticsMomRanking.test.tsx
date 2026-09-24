import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '@/lib/i18n'
import { db } from '@/db'
import AnalyticsPage from '@/pages/AnalyticsPage'
import { useSettingsStore } from '@/store/settings'

vi.mock('@/components/CompositionChart', () => ({ default: () => null }))
vi.mock('@/components/CategoryTrendChart', () => ({ default: () => null }))
vi.mock('@/components/BalanceSankeyChart', () => ({ default: () => null }))
vi.mock('@/hooks/useSwipeGesture', () => ({ useSwipeGesture: () => {} }))

vi.hoisted(() => {
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
})

afterEach(cleanup)

beforeEach(async () => {
  useSettingsStore.setState({ settings: { base_currency: 'CNY' } as any, ready: true } as any)
  await db.snapshots.clear()
  await db.accounts.clear()
  await db.subAccounts.clear()
  await db.monthlyReviews.clear()
  await db.accounts.add({
    id: 'a1', name: '招商银行', icon: 'wallet', color: '#000',
    type: 'asset', category: 'cash', currency: 'CNY',
    include_in_networth: true, hidden: false, archived: false, sort_order: 0,
    created_at: '', updated_at: '',
  } as any)
  await db.subAccounts.bulkAdd([
    { id: 's1', account_id: 'a1', name: '活期', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    // 9 月新建的子账户
    { id: 's2', account_id: 'a1', name: '理财', type: 'asset', category: 'investment', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 1, created_at: '', updated_at: '' },
  ] as any)
  // 8 月：只有活期 1000；9 月：活期 1200 + 理财 500 → 账户真实环比 +700
  // 注意 id 顺序：n3（理财 500）最后，旧逻辑按主账户取数会把它当成整个账户的 9 月余额 → 误判 -500
  await db.snapshots.bulkAdd([
    { id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-08', balance: '1000', currency: 'CNY', created_at: '', updated_at: '' },
    { id: 'n2', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '1200', currency: 'CNY', created_at: '', updated_at: '' },
    { id: 'n3', account_id: 'a1', sub_account_id: 's2', month: '2026-09', balance: '500', currency: 'CNY', created_at: '', updated_at: '' },
  ] as any)
})

describe('AnalyticsPage 环比变动排行', () => {
  it('新建子账户后，账户变动额应是各子账户之和的差（+700），不是单个子账户的差（-500）', async () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <AnalyticsPage />
        </MemoryRouter>
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.getByText('招商银行')).toBeTruthy())
    const row = screen.getByText('招商银行').parentElement!
    expect(row.textContent).toContain('+¥700.00')
  })
})
