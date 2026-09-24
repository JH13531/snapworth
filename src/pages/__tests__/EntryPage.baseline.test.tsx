import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { I18nProvider } from '@/lib/i18n'
import { db } from '@/db'
import EntryPage from '@/pages/EntryPage'
import { useSettingsStore } from '@/store/settings'

vi.mock('@/hooks/useSwipeGesture', () => ({ useSwipeGesture: () => {} }))
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/rates-api', () => ({ fetchRatesForMonth: vi.fn() }))
vi.mock('@/lib/backup-file', () => ({ writeFileAutoBackup: vi.fn() }))

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
    id: 'a1', name: '招商银行', icon: 'wallet', color: '#000',
    type: 'asset', category: 'cash', currency: 'CNY',
    include_in_networth: true, hidden: false, archived: false, sort_order: 0,
    created_at: '', updated_at: '',
  } as any)
  await db.subAccounts.bulkAdd([
    // 老子账户：8 月有余额 1000
    { id: 's_old', account_id: 'a1', name: '活期', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    // 9 月新建的子账户：无任何历史快照
    { id: 's_new', account_id: 'a1', name: '理财', type: 'asset', category: 'investment', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 1, created_at: '', updated_at: '' },
  ] as any)
  await db.snapshots.add({
    id: 'n1', account_id: 'a1', sub_account_id: 's_old', month: '2026-08',
    balance: '1000', currency: 'CNY', created_at: '', updated_at: '',
  } as any)
})

function renderEntry(month = '2026-09') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[`/entry/${month}`]}>
        <Routes>
          <Route path="/entry/:month" element={<EntryPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('EntryPage 子账户对比基线', () => {
  it('9 月新建的子账户不应显示其他子账户的「最近 08月」金额', async () => {
    renderEntry()
    // 老子账户正常显示「上月」基线（「上月 ¥1,000.00」同处一个元素内，用正则匹配）
    await waitFor(() => expect(screen.getAllByText(/上月/).length).toBeGreaterThan(0))
    // 新子账户没有历史：整页不应出现「最近 xx月」的兜底基线
    expect(screen.queryByText(/最近 \d+月/)).toBeNull()
  })

  it('老子账户点「同上」能填入自己上月的余额', async () => {
    renderEntry()
    const btn = await waitFor(() => screen.getByText('同上'))
    fireEvent.click(btn)
    const inputs = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
    // 第一个输入框（s_old 活期）应被填入 1,000.00
    await waitFor(() => expect(inputs[0].value).toBe('1,000.00'))
  })
})
