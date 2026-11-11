import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { I18nProvider } from '@/lib/i18n'
import { db } from '@/db'
import AccountDetailPage from '@/pages/AccountDetailPage'
import { useSettingsStore } from '@/store/settings'

const { captured } = vi.hoisted(() => ({ captured: [] as any[] }))

// 图表只截获 option，避免 jsdom 里渲染 canvas
vi.mock('@/components/EChart', () => ({
  default: ({ option }: { option: any }) => {
    captured.push(option)
    return <div data-testid="chart" />
  },
}))

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
  captured.length = 0
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
  await db.snapshots.bulkAdd([
    { id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-08', balance: '1000', currency: 'CNY', created_at: '', updated_at: '' },
    { id: 'n2', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '1200', currency: 'CNY', created_at: '', updated_at: '' },
  ] as any)
})

function renderPage() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/accounts/a1']}>
        <Routes>
          <Route path="/accounts/:id" element={<AccountDetailPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('AccountDetailPage 账户趋势', () => {
  it('主趋势图应取到各月子账户余额（回归：模板变量曾被反斜杠转义成字面量）', async () => {
    renderPage()
    await waitFor(() => expect(captured.length).toBeGreaterThan(0))
    const opt = captured[0]
    expect(opt.xAxis.data).toEqual(['2026-08', '2026-09'])
    expect(opt.series[0].data).toEqual([1000, 1200])
  })

  it('子账户列表应显示最近一个月的余额，而不是「—」', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('FUTU · 投资(基金/股票)')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('¥1,200.00')).toBeTruthy())
  })
})
