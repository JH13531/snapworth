import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '@/lib/i18n'
import { db } from '@/db'
import DashboardPage from '@/pages/DashboardPage'
import { useSettingsStore } from '@/store/settings'
import { currentMonth } from '@/lib/date'

// 捕获 EChart 收到的 option，验证图表数据
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
vi.mock('@/components/CompositionChart', () => ({ default: () => null }))
vi.mock('@/components/GoalForecast', () => ({ default: () => null }))
// 数字动画直接渲染原值，便于断言顶部净资产
vi.mock('@/components/AnimatedNumber', () => ({
  default: ({ value }: { value: number }) => <span data-testid="animated-num">{value}</span>,
}))

afterEach(cleanup)

const month = currentMonth()

beforeEach(async () => {
  captured.length = 0
  useSettingsStore.setState({ settings: { base_currency: 'CNY', onboarded: true } as any, ready: true, loading: false } as any)
  await db.snapshots.clear()
  await db.accounts.clear()
  await db.subAccounts.clear()
  // 一个主账户 + 两个子账户：100 + 200，真实净资产应为 300
  await db.accounts.add({
    id: 'a1', name: '招商银行', icon: 'wallet', color: '#000',
    type: 'asset', category: 'cash', currency: 'CNY',
    include_in_networth: true, hidden: false, archived: false, sort_order: 0,
    created_at: '', updated_at: '',
  } as any)
  await db.subAccounts.bulkAdd([
    { id: 's1', account_id: 'a1', name: '活期', type: 'asset', category: 'cash', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 's2', account_id: 'a1', name: '理财', type: 'asset', category: 'investment', currency: 'CNY', include_in_networth: true, archived: false, sort_order: 1, created_at: '', updated_at: '' },
  ] as any)
  await db.snapshots.bulkAdd([
    { id: 'n1', account_id: 'a1', sub_account_id: 's1', month, balance: '100', currency: 'CNY', created_at: '', updated_at: '' },
    { id: 'n2', account_id: 'a1', sub_account_id: 's2', month, balance: '200', currency: 'CNY', created_at: '', updated_at: '' },
  ] as any)
})

describe('DashboardPage 净资产趋势图', () => {
  it('图表当月净资产应与顶部卡片一致（各子账户求和=300，而不是只算到最后一个子账户）', async () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </I18nProvider>,
    )
    // 顶部卡片显示 300
    await waitFor(() => {
      expect(screen.getAllByTestId('animated-num').some((el) => el.textContent === '300')).toBe(true)
    })
    // 图表净资产线（series[2]）当月值也必须是 300
    // （subAccounts 异步加载完成后图表会重算，用 waitFor 等到最终一帧）
    await waitFor(() => {
      expect(captured.length).toBeGreaterThan(0)
      const option = captured[captured.length - 1]
      const netSeries = option.series[2]
      const monthIdx = (option.xAxis.data as string[]).length - 1
      expect(netSeries.data[monthIdx]).toBe(300)
    })
  })
})
