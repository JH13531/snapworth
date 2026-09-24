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
    id: 'a1', name: '信用卡', icon: 'credit-card', color: '#000',
    type: 'liability', category: 'credit', currency: 'CNY',
    include_in_networth: true, hidden: false, archived: false, sort_order: 0,
    created_at: '', updated_at: '',
  } as any)
  await db.subAccounts.add({
    id: 'sub1', account_id: 'a1', name: '', type: 'liability', category: 'credit',
    currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0,
    created_at: '', updated_at: '',
  } as any)
  // 上月有快照 → 渲染时会计算 diff（对比基线存在）
  await db.snapshots.add({
    id: 's1', account_id: 'a1', sub_account_id: 'sub1', month: '2026-08',
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

describe('EntryPage 负数输入', () => {
  it('输入负号（不完整数字）不应白屏崩溃', async () => {
    renderEntry()
    const input = await waitFor(() => screen.getByPlaceholderText('0.00')) as HTMLInputElement
    // 输入负数时的第一个按键是 "-"
    fireEvent.change(input, { target: { value: '-' } })
    // 页面仍存活：输入框还在，值是 "-"
    expect(screen.getByPlaceholderText('0.00')).toBeTruthy()
    expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('-')
  })

  it('完整负数能正常显示并参与 diff 计算', async () => {
    renderEntry()
    const input = await waitFor(() => screen.getByPlaceholderText('0.00'))
    fireEvent.change(input, { target: { value: '-' } })
    fireEvent.change(input, { target: { value: '-500' } })
    await waitFor(() => expect(screen.getByText(/-1500\.00/)).toBeTruthy())
  })
})
