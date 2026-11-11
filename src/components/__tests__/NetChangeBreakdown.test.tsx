import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '@/lib/i18n'
import NetChangeBreakdown from '@/components/NetChangeBreakdown'
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
  account({ id: 'a1', name: '招商银行', category: 'cash' }),
  account({ id: 'a2', name: '券商', category: 'investment' }),
  account({ id: 'a3', name: '房贷', category: 'mortgage', type: 'liability' }),
]
const subAccounts = [
  sub({ id: 's1', account_id: 'a1', name: '活期', category: 'cash' }),
  sub({ id: 's2', account_id: 'a2', name: '持仓', category: 'investment' }),
  sub({ id: 's3', account_id: 'a3', name: '主贷', category: 'mortgage', type: 'liability' }),
]
// 8 月：1000 + 1000 - 500 = 1500；9 月：1000 + 2000 - 400 = 2600 → 净增 +1100
// 其中现金无变化（应被排除）、投资 +1000、房贷还本 100 → 对净资产贡献 +100
const snapshots = [
  snap({ id: 'n1', account_id: 'a1', sub_account_id: 's1', month: '2026-08', balance: '1000' }),
  snap({ id: 'n2', account_id: 'a1', sub_account_id: 's1', month: '2026-09', balance: '1000' }),
  snap({ id: 'n3', account_id: 'a2', sub_account_id: 's2', month: '2026-08', balance: '1000' }),
  snap({ id: 'n4', account_id: 'a2', sub_account_id: 's2', month: '2026-09', balance: '2000' }),
  snap({ id: 'n5', account_id: 'a3', sub_account_id: 's3', month: '2026-08', balance: '500' }),
  snap({ id: 'n6', account_id: 'a3', sub_account_id: 's3', month: '2026-09', balance: '400' }),
]

function renderBreakdown() {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <NetChangeBreakdown
          accounts={accounts}
          subAccounts={subAccounts}
          snapshots={snapshots}
          rates={[]}
          month="2026-09"
          priorMonth="2026-08"
          base="CNY"
          hide={false}
          invert={false}
        />
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('NetChangeBreakdown 净增额分解', () => {
  it('各分类贡献之和等于净资产变化，并列在合计行', () => {
    renderBreakdown()
    expect(screen.getByText('+¥1,100.00')).toBeTruthy()
    // 构成：投资 +1000、房贷 +100（负债减少）
    expect(screen.getByText('+¥1,000.00')).toBeTruthy()
    expect(screen.getByText('+¥100.00')).toBeTruthy()
  })

  it('没有变化的分类不占一行', () => {
    renderBreakdown()
    expect(screen.queryByText('现金/活期')).toBeNull()
  })

  it('点击分类可下钻到账户级明细', () => {
    renderBreakdown()
    fireEvent.click(screen.getByText('投资(基金/股票)'))
    expect(screen.getByText('该分类贡献')).toBeTruthy()
    expect(screen.getByText('券商')).toBeTruthy()
    // 账户级同样是「上月 → 本月」与变动额
    expect(screen.getByText('¥1,000.00 → ¥2,000.00')).toBeTruthy()
  })
})
