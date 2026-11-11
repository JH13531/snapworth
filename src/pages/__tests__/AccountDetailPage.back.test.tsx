import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { I18nProvider } from '@/lib/i18n'
import { db } from '@/db'
import AccountDetailPage from '@/pages/AccountDetailPage'
import { useSettingsStore } from '@/store/settings'

vi.mock('@/components/EChart', () => ({ default: () => <div data-testid="chart" /> }))

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
  localStorage.clear()
  await db.snapshots.clear()
  await db.accounts.clear()
  await db.subAccounts.clear()
  await db.accounts.add({
    id: 'a1', name: 'FUTU', icon: 'trending-up', color: '#f59e0b',
    type: 'asset', category: 'investment', currency: 'CNY',
    include_in_networth: true, hidden: false, archived: false, sort_order: 0,
    created_at: '', updated_at: '',
  } as any)
  await db.subAccounts.add({
    id: 's1', account_id: 'a1', name: '', type: 'asset', category: 'investment',
    currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0,
    created_at: '', updated_at: '',
  } as any)
  await db.snapshots.add({
    id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-09',
    balance: '1000', currency: 'CNY', created_at: '', updated_at: '',
  } as any)
})

describe('AccountDetailPage 返回按钮', () => {
  it('从复盘页下钻进来时，返回应回到复盘页而不是账户列表', async () => {
    render(
      <I18nProvider>
        {/* 模拟「复盘页 → 账户详情」的浏览历史 */}
        <MemoryRouter initialEntries={['/review/2026-09', '/accounts/a1']} initialIndex={1}>
          <Routes>
            <Route path="/review/:month" element={<div>REVIEW_PAGE</div>} />
            <Route path="/accounts" element={<div>ACCOUNTS_PAGE</div>} />
            <Route path="/accounts/:id" element={<AccountDetailPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    )

    await waitFor(() => expect(screen.getByText('FUTU')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('返回'))

    await waitFor(() => expect(screen.getByText('REVIEW_PAGE')).toBeTruthy())
    expect(screen.queryByText('ACCOUNTS_PAGE')).toBeNull()
  })
})
