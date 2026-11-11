import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n'
import CompositionShift from '@/components/CompositionShift'
import type { Account, SubAccount, Snapshot } from '@/types'

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

function account(over: Partial<Account>): Account {
  return {
    id: 'a', name: 'A', icon: 'wallet', color: '#000', type: 'asset', category: 'cash',
    currency: 'CNY', include_in_networth: true, hidden: false, archived: false,
    sort_order: 0, created_at: '', updated_at: '', ...over,
  }
}
function sub(over: Partial<SubAccount>): SubAccount {
  return {
    id: 's', account_id: 'a', name: '', type: 'asset', category: 'cash', currency: 'CNY',
    include_in_networth: true, archived: false, sort_order: 0, created_at: '', updated_at: '', ...over,
  }
}
function snap(over: Partial<Snapshot>): Snapshot {
  return { id: 'n', account_id: 'a', month: '2026-08', balance: '0', currency: 'CNY', created_at: '', updated_at: '', ...over }
}

const accounts = [
  account({ id: 'a1', name: '银行', category: 'cash' }),
  account({ id: 'a2', name: '券商', category: 'investment' }),
]
const subAccounts = [
  sub({ id: 's1', account_id: 'a1', category: 'cash' }),
  sub({ id: 's2', account_id: 'a2', category: 'investment' }),
]
// 8 月：现金 1000 / 投资 3000 → 25% / 75%
// 9 月：现金 1000 / 投资 5000 → 16.7% / 83.3%
const snapshots = [
  snap({ id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-08', balance: '1000' }),
  snap({ id: 'n2', account_id: 'a2', sub_account_id: 's2', month: '2026-08', balance: '3000' }),
  snap({ id: 'n3', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '1000' }),
  snap({ id: 'n4', account_id: 'a2', sub_account_id: 's2', month: '2026-09', balance: '5000' }),
]

function renderShift() {
  return render(
    <I18nProvider>
      <CompositionShift
        accounts={accounts}
        subAccounts={subAccounts}
        snapshots={snapshots}
        rates={[]}
        month="2026-09"
        priorMonth="2026-08"
        base="CNY"
        hide={false}
      />
    </I18nProvider>,
  )
}

describe('CompositionShift 资产结构变化', () => {
  it('按两月总量分别计算占比，并给出百分点变化', () => {
    renderShift()
    // 本月占比
    expect(screen.getByText('83.3%')).toBeTruthy()
    expect(screen.getByText('16.7%')).toBeTruthy()
    // 占比变化：投资 +8.3pp、现金 -8.3pp（按绝对值排序，两者都在列）
    expect(screen.getByText('+8.3pp')).toBeTruthy()
    expect(screen.getByText('-8.3pp')).toBeTruthy()
  })

  it('两个月总量分别展示', () => {
    renderShift()
    expect(screen.getByText('¥4,000.00')).toBeTruthy()
    expect(screen.getByText('¥6,000.00')).toBeTruthy()
  })
})
