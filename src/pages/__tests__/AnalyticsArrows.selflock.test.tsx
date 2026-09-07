import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '@/lib/i18n'
import { db } from '@/db'
import AnalyticsPage from '@/pages/AnalyticsPage'
import { useSettingsStore } from '@/store/settings'

// 重型图表与手势：mock 掉，只验证月份状态链路
vi.mock('@/components/CompositionChart', () => ({ default: () => null }))
vi.mock('@/components/CategoryTrendChart', () => ({ default: () => null }))
vi.mock('@/components/BalanceSankeyChart', () => ({ default: () => null }))
vi.mock('@/hooks/useSwipeGesture', () => ({ useSwipeGesture: () => {} }))

// jsdom 无 matchMedia；必须在模块 import 之前注入（vi.hoisted 早于 import 执行）
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

beforeEach(async () => {
  useSettingsStore.setState({ settings: { base_currency: 'CNY' } as any, ready: true } as any)
  await db.snapshots.clear()
  await db.accounts.clear()
  await db.subAccounts.clear()
  await db.monthlyReviews.clear()
  await db.accounts.add({
    id: 'a1', name: 'Cash', type: 'asset', icon: 'cash', color: '#000',
    sort_order: 0, currency: 'CNY', include_in_networth: true, archived: false,
  } as any)
  // 刻意让年份起点 2026-01 无数据；2025-12 与 2026-09 有数据
  await db.snapshots.bulkAdd([
    { id: 's1', account_id: 'a1', month: '2026-09', balance: '1200', currency: 'CNY' },
    { id: 's2', account_id: 'a1', month: '2025-12', balance: '500', currency: 'CNY' },
  ] as any)
})

describe('AnalyticsPage goPrev 自锁修复', () => {
  it('能一路回退到最早数据月 2025-12（旧逻辑会在 2026-09 立即锁死）', async () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <AnalyticsPage />
        </MemoryRouter>
      </I18nProvider>,
    )
    // 初始应显示当前月 2026-09
    await waitFor(() => expect(screen.getByRole('button', { name: /2026年9月/ })).toBeTruthy())
    // 月份按钮的前一个兄弟元素即左箭头
    const monthBtn = screen.getByRole('button', { name: /2026年9月/ })
    const leftArrow = monthBtn.previousElementSibling as HTMLButtonElement
    for (let i = 0; i < 10; i++) {
      fireEvent.click(leftArrow)
    }
    await waitFor(() => expect(screen.getByRole('button', { name: /2025年12月/ })).toBeTruthy())
  })
})
