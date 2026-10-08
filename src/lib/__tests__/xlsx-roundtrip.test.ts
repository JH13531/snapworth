// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { exportFullCsv, parseCsvWide } from '../csv'
import { buildXlsxWorkbook, workbookToCsvText } from '../xlsx'
import type { Account, SubAccount, Snapshot, ExchangeRate, Settings, ExportData } from '@/types'

/**
 * xlsx 多工作表导出 → 导入 的往返一致性：
 * 与 CSV 分区格式同源的四个 sheet 必须完整还原账户结构、余额、汇率、币种覆盖。
 */

const settings = { base_currency: 'CNY' } as Settings
const T = '2025-01-01T00:00:00.000Z'

function makeLedger() {
  const accounts: Account[] = [
    {
      id: 'a1', name: '招商银行', icon: 'wallet', color: '#3b82f6',
      type: 'asset', category: 'cash', currency: 'CNY',
      include_in_networth: true, archived: false, hidden: false,
      sort_order: 0, note: 'note, with comma', created_at: T, updated_at: T,
    },
    {
      id: 'a2', name: '支付宝', icon: 'smartphone', color: '#06b6d4',
      type: 'asset', category: 'savings', currency: 'CNY',
      include_in_networth: false, archived: false, hidden: true,
      sort_order: 1, created_at: T, updated_at: T,
    },
    {
      id: 'a3', name: '房贷', icon: 'house', color: '#8b5cf6',
      type: 'liability', category: 'mortgage', currency: 'CNY',
      include_in_networth: true, archived: true, archived_at: '2025-06', hidden: false,
      sort_order: 2, created_at: T, updated_at: T,
    },
  ]
  const subAccounts: SubAccount[] = [
    {
      id: 's1', account_id: 'a1', name: '储蓄卡', type: 'asset', category: 'cash',
      currency: 'CNY', include_in_networth: true, archived: false,
      sort_order: 0, created_at: T, updated_at: T,
    },
    {
      id: 's2', account_id: 'a1', name: '信用卡', type: 'liability', category: 'credit_card',
      currency: 'USD', include_in_networth: true, archived: false,
      sort_order: 1, icon: 'credit-card', color: '#ef4444', created_at: T, updated_at: T,
    },
    {
      id: 's3', account_id: 'a2', name: '', type: 'asset', category: 'savings',
      currency: 'CNY', include_in_networth: false, archived: false,
      sort_order: 0, created_at: T, updated_at: T,
    },
    {
      id: 's4', account_id: 'a3', name: '', type: 'liability', category: 'mortgage',
      currency: 'CNY', include_in_networth: true, archived: true, archived_at: '2025-06',
      sort_order: 0, created_at: T, updated_at: T,
    },
  ]
  const mkSnap = (id: string, accountId: string, subId: string, month: string, balance: string, currency: string): Snapshot => ({
    id, account_id: accountId, sub_account_id: subId, month, balance, currency,
    created_at: T, updated_at: T,
  })
  const snapshots: Snapshot[] = [
    mkSnap('n1', 'a1', 's1', '2025-01', '10000.55', 'CNY'),
    mkSnap('n2', 'a1', 's1', '2025-02', '12000', 'CNY'),
    mkSnap('n3', 'a1', 's2', '2025-01', '-500.25', 'USD'),
    mkSnap('n4', 'a1', 's2', '2025-03', '100', 'EUR'),
    mkSnap('n5', 'a2', 's3', '2025-01', '3000', 'CNY'),
    mkSnap('n6', 'a3', 's4', '2025-01', '2000000', 'CNY'),
  ]
  const rates: ExchangeRate[] = [
    { month: '2025-01', currency: 'USD', rate_to_base: '7.1', rate_date: '2025-01-31', created_at: T, updated_at: T },
    { month: '2025-01', currency: 'EUR', rate_to_base: '7.8', created_at: T, updated_at: T },
    { month: '2025-02', currency: 'USD', rate_to_base: '7.2', created_at: T, updated_at: T },
  ]
  return { accounts, subAccounts, snapshots, rates }
}

/** 忽略 id/时间戳，比较两份 ExportData 的业务内容 */
function normalize(data: ExportData) {
  const accName = new Map(data.accounts.map((a) => [a.id, a.name]))
  const subKey = new Map(data.sub_accounts?.map((s) => [s.id, s]))
  return {
    accounts: data.accounts.map((a) => ({
      name: a.name, type: a.type, category: a.category, currency: a.currency,
      include_in_networth: a.include_in_networth, archived: a.archived,
      archived_at: a.archived_at ?? null, hidden: a.hidden, note: a.note ?? null,
      icon: a.icon, color: a.color, sort_order: a.sort_order,
    })),
    subs: (data.sub_accounts ?? []).map((s) => ({
      parent: accName.get(s.account_id), name: s.name, type: s.type, category: s.category,
      currency: s.currency, include_in_networth: s.include_in_networth,
      archived: s.archived, archived_at: s.archived_at ?? null, sort_order: s.sort_order,
    })),
    snapshots: data.snapshots.map((n) => ({
      parent: accName.get(n.account_id),
      sub: subKey.get(n.sub_account_id ?? '')?.name ?? null,
      month: n.month, balance: Number(n.balance), currency: n.currency ?? null,
    })),
    rates: data.exchange_rates.map((r) => ({
      month: r.month, currency: r.currency, rate: r.rate_to_base, date: r.rate_date ?? null,
    })),
  }
}

describe('xlsx 多工作表导出', () => {
  const { accounts, subAccounts, snapshots, rates } = makeLedger()
  const wb = buildXlsxWorkbook(XLSX, accounts, snapshots, rates, settings, subAccounts)

  it('金额 / 账户信息 / 汇率 / 币种覆盖 各占一个 sheet', () => {
    expect(wb.SheetNames).toEqual(['金额', '账户信息', '汇率', '币种覆盖'])
  })

  it('金额 sheet 的数字单元格是数值类型（Excel 可直接求和）', () => {
    const ws = wb.Sheets['金额']
    // B2 = 2025-01 储蓄卡余额 10000.55
    const cell = ws['B2']
    expect(cell.t).toBe('n')
    expect(cell.v).toBe(10000.55)
    // 月份列保持字符串
    expect(ws['A2'].v).toBe('2025-01')
  })

  it('汇率 sheet 的 A1 标题带基准币种标记', () => {
    const ws = wb.Sheets['汇率']
    expect(ws['A1'].v).toBe('汇率(基准:CNY)')
    expect(ws['A2'].v).toBe('月份')
  })
})

describe('xlsx 导出→导入 往返一致', () => {
  const { accounts, subAccounts, snapshots, rates } = makeLedger()
  const wb = buildXlsxWorkbook(XLSX, accounts, snapshots, rates, settings, subAccounts)
  const csvText = workbookToCsvText(XLSX, wb)
  const viaCsv = parseCsvWide(exportFullCsv(accounts, snapshots, rates, settings, subAccounts), 'CNY')

  it('能识别为本应用的多表格式', () => {
    expect(csvText).not.toBeNull()
    expect(csvText).toContain('汇率(基准:CNY)')
    // 含逗号的备注被正确转义
    expect(csvText).toContain('"note, with comma"')
  })

  it('与 CSV 分区格式解析结果业务内容完全一致', () => {
    const viaXlsx = parseCsvWide(csvText!, 'CNY')
    expect(normalize(viaXlsx)).toEqual(normalize(viaCsv))
  })

  it('快照、汇率、币种覆盖完整保留', () => {
    const data = parseCsvWide(csvText!, 'CNY')
    expect(data.snapshots).toHaveLength(6)
    expect(data.exchange_rates).toHaveLength(3)
    // 币种覆盖：2025-03 信用卡（第 2 列）应为 EUR
    const bankSubs = data.sub_accounts!.filter((s) => s.account_id === data.accounts[0].id)
    const snap = data.snapshots.find((s) => s.sub_account_id === bankSubs[1].id && s.month === '2025-03')
    expect(snap?.currency).toBe('EUR')
    expect(Number(snap?.balance)).toBe(100)
  })
})

describe('workbookToCsvText 对非本应用格式的 xlsx 返回 null', () => {
  it('普通单表 xlsx 退回旧逻辑', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['月份', '招商银行', '现金'],
      ['2025-01', 50000, 3000],
    ]), 'Sheet1')
    expect(workbookToCsvText(XLSX, wb)).toBeNull()
  })
})
