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
  // jsdom 未实现 scrollIntoView
  Element.prototype.scrollIntoView = function () {} as any
})

afterEach(cleanup)

const MONTH = '2026-09'
const COLLAPSED_KEY = 'snapworth:collapsed-accounts'

beforeEach(async () => {
  useSettingsStore.setState({ settings: { base_currency: 'CNY' } as any, ready: true } as any)
  localStorage.clear()
  await db.snapshots.clear()
  await db.accounts.clear()
  await db.subAccounts.clear()
  await db.accounts.bulkAdd([
    {
      id: 'a1', name: '招商银行', icon: 'wallet', color: '#000',
      type: 'asset', category: 'cash', currency: 'CNY',
      include_in_networth: true, hidden: false, archived: false, sort_order: 0,
      created_at: '', updated_at: '',
    },
    {
      id: 'a2', name: '券商', icon: 'trending-up', color: '#111',
      type: 'asset', category: 'investment', currency: 'CNY',
      include_in_networth: true, hidden: false, archived: false, sort_order: 1,
      created_at: '', updated_at: '',
    },
  ] as any)
  await db.subAccounts.bulkAdd([
    // 已有余额：不会成为「下一个未填」
    { id: 's1', account_id: 'a1', name: '活期', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    // 位于折叠分组 a2 内的未填行
    { id: 's2', account_id: 'a2', name: '持仓', type: 'asset', category: 'investment', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
  ] as any)
  await db.snapshots.add({
    id: 'n1', account_id: 'a1', sub_account_id: 's1', month: MONTH,
    balance: '100', currency: 'CNY', created_at: '', updated_at: '',
  } as any)
  // 券商分组处于折叠状态（持久化 key 为 account_id）
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(['a2']))
})

function renderEntry() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[`/entry/${MONTH}`]}>
        <Routes>
          <Route path="/entry/:month" element={<EntryPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('EntryPage 跳到下一个未填', () => {
  it('目标行位于折叠分组时，应展开该分组并把输入框聚焦到位', async () => {
    renderEntry()

    // 前置：折叠分组内的输入框确实不在 DOM 里
    // 24 个测试文件并行时 jsdom+React 首次渲染可能被拖到数秒，等待上限放宽到 15s
    await waitFor(() => expect(document.getElementById('entry-input-s1')).not.toBeNull(), { timeout: 15000 })
    expect(document.getElementById('entry-input-s2')).toBeNull()

    fireEvent.click(screen.getByTitle('跳到下一个未填'))

    // 修复前：这里永远是 null（折叠集合用 category 去查 account_id，且查询早于重渲染）
    await waitFor(() => {
      const input = document.getElementById('entry-input-s2') as HTMLInputElement | null
      expect(input).not.toBeNull()
    }, { timeout: 15000 })

    // 聚焦是延迟执行的，避免打断平滑滚动
    await waitFor(
      () => expect(document.activeElement).toBe(document.getElementById('entry-input-s2')),
      { timeout: 15000 },
    )
  })
})
