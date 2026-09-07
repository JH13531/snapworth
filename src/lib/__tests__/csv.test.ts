// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseCsvWide, exportFullCsv, buildCsvColumns } from '../csv'
import { inferAccountMeta } from '../presets'
import type { Account, SubAccount, Snapshot, Settings } from '@/types'

const base = 'CNY'

function acc(id: string, name: string, sort: number): Account {
  return {
    id, name, icon: 'wallet', color: '#3b82f6', type: 'asset', category: 'cash',
    currency: 'CNY', include_in_networth: true, archived: false, hidden: false,
    sort_order: sort, created_at: '2025-01-01', updated_at: '2025-01-01',
  }
}

function sub(id: string, accountId: string, name: string, sort: number, extra: Partial<SubAccount> = {}): SubAccount {
  return {
    id, account_id: accountId, name, type: 'asset', category: 'cash',
    currency: 'CNY', include_in_networth: true, archived: false,
    sort_order: sort, created_at: '2025-01-01', updated_at: '2025-01-01', ...extra,
  }
}

function snap(accountId: string, month: string, balance: string, subId?: string): Snapshot {
  return {
    id: `${accountId}-${month}-${subId ?? ''}`, account_id: accountId, month, balance,
    sub_account_id: subId, currency: 'CNY', created_at: '2025-01-01', updated_at: '2025-01-01',
  }
}

const settings = { base_currency: 'CNY' } as Settings

describe('parseCsvWide 数值解析', () => {
  it('快照格式解析千分位金额，不被截断', () => {
    const csv = [
      '月份,招商银行,支付宝,现金',
      '2025-01,"55,000",12000,3000',
      '2025-02,52000,"1,234,567.89",2500',
    ].join('\n')

    const data = parseCsvWide(csv, base)
    const byName = new Map(data.accounts.map((a) => [a.name, a.id]))

    const balance = (account: string, month: string) =>
      data.snapshots.find((s) => s.account_id === byName.get(account) && s.month === month)?.balance

    expect(balance('招商银行', '2025-01')).toBe('55000')
    expect(balance('支付宝', '2025-01')).toBe('12000')
    expect(balance('支付宝', '2025-02')).toBe('1234567.89')
  })

  it('普通金额与负数解析不受影响', () => {
    const csv = [
      '月份,银行卡,花呗,现金',
      '2025-01,1000,-250.5,0',
    ].join('\n')

    const data = parseCsvWide(csv, base)
    const byName = new Map(data.accounts.map((a) => [a.name, a.id]))
    const balance = (account: string) =>
      data.snapshots.find((s) => s.account_id === byName.get(account))?.balance

    expect(balance('银行卡')).toBe('1000')
    expect(balance('花呗')).toBe('-250.5')
    expect(balance('现金')).toBe('0')
  })

  it('非数字值仍被跳过', () => {
    const csv = [
      '月份,银行卡,支付宝,现金',
      '2025-01,N/A,3000,100',
    ].join('\n')

    const data = parseCsvWide(csv, base)
    const byName = new Map(data.accounts.map((a) => [a.name, a.id]))

    expect(data.snapshots.find((s) => s.account_id === byName.get('银行卡'))).toBeUndefined()
    expect(data.snapshots.find((s) => s.account_id === byName.get('支付宝'))?.balance).toBe('3000')
  })
})

describe('导入时自动归类（不再一律现金）', () => {
  it('房贷/富途证券等被正确推断类型与分类', () => {
    const csv = [
      '月份,房贷,富途证券,招商银行,花呗',
      '2025-01,2000000,150000,50000,-3000',
    ].join('\n')

    const data = parseCsvWide(csv, base)
    const byName = new Map(data.accounts.map((a) => [a.name, a]))
    const mortgage = byName.get('房贷')!
    const futu = byName.get('富途证券')!
    const bank = byName.get('招商银行')!
    const huabei = byName.get('花呗')!

    expect(mortgage.type).toBe('liability')
    expect(mortgage.category).toBe('mortgage')
    expect(futu.type).toBe('asset')
    expect(futu.category).toBe('investment')
    expect(bank.category).toBe('cash')
    expect(huabei.type).toBe('liability')
    expect(huabei.category).toBe('credit_card')
  })

  it('无提示词的账户回退为现金/活期', () => {
    const csv = [
      '月份,招商银行,现金,我的神秘账户',
      '2025-01,50000,3000,999',
    ].join('\n')
    const data = parseCsvWide(csv, base)
    const mystery = new Map(data.accounts.map((a) => [a.name, a])).get('我的神秘账户')!
    expect(mystery.type).toBe('asset')
    expect(mystery.category).toBe('cash')
  })
})

describe('inferAccountMeta 关键词推断', () => {
  it('中英文片段都能命中', () => {
    expect(inferAccountMeta('房贷').category).toBe('mortgage')
    expect(inferAccountMeta('车贷').category).toBe('car_loan')
    expect(inferAccountMeta('富途证券').category).toBe('investment')
    expect(inferAccountMeta('Futu Securities').category).toBe('investment')
    expect(inferAccountMeta('Mortgage').type).toBe('liability')
    expect(inferAccountMeta('招商银行储蓄卡').category).toBe('cash')
    expect(inferAccountMeta('公积金').category).toBe('savings')
    expect(inferAccountMeta('房产').category).toBe('real_estate')
    // 常见写法补全：避免明显非现金账户被误判为现金
    expect(inferAccountMeta('我的房子').category).toBe('real_estate')
    expect(inferAccountMeta('住宅').category).toBe('real_estate')
    expect(inferAccountMeta('某券商账户').category).toBe('investment')
    expect(inferAccountMeta('余额宝').category).toBe('savings')
    expect(inferAccountMeta('理财通').category).toBe('savings')
  })
})

describe('buildCsvColumns 子账户摊平', () => {
  it('无子账户时，每个账户一列且为唯一记账单元', () => {
    const cols = buildCsvColumns([acc('a1', '招商银行', 0), acc('a2', '支付宝', 1)], [])
    expect(cols.map((c) => c.header)).toEqual(['招商银行', '支付宝'])
    expect(cols.every((c) => c.soleUnit)).toBe(true)
  })

  it('单个子账户时列名仍是账户名（可原样导回）', () => {
    const a1 = acc('a1', '招商银行', 0)
    const cols = buildCsvColumns([a1], [sub('s1', 'a1', '储蓄卡', 0)])
    expect(cols.map((c) => c.header)).toEqual(['招商银行'])
    expect(cols[0].sub?.id).toBe('s1')
    expect(cols[0].soleUnit).toBe(true)
  })

  it('多个子账户时每子账户一列，列名「账户 子账户」', () => {
    const a1 = acc('a1', '招商银行', 0)
    const cols = buildCsvColumns(
      [a1],
      [sub('s1', 'a1', '储蓄卡', 0), sub('s2', 'a1', '信用卡', 1)],
    )
    expect(cols.map((c) => c.header)).toEqual(['招商银行 储蓄卡', '招商银行 信用卡'])
    expect(cols.every((c) => c.soleUnit)).toBe(false)
  })
})

describe('exportFullCsv 含子账户', () => {
  it('多子账户余额落在对应列并正确计入资产/负债合计', () => {
    const a1 = acc('a1', '招商银行', 0)
    const a2 = acc('a2', '支付宝', 1)
    const s1 = sub('s1', 'a1', '储蓄卡', 0)
    const s2 = sub('s2', 'a1', '信用卡', 1, { type: 'liability' })
    const subs = [s1, s2]
    const snaps = [
      snap('a1', '2025-01', '10000', 's1'),
      snap('a1', '2025-01', '-2000', 's2'),
      snap('a2', '2025-01', '5000'),
    ]
    const csv = exportFullCsv([a1, a2], snaps, [], settings, subs)
    const lines = csv.split('\n')
    const header = lines[0].split(',')
    const data = lines[2].split(',') // 行1为「归档状态」
    // 表头：月份, 招商银行 储蓄卡, 招商银行 信用卡, 支付宝, 资产合计, 负债合计, 净资产
    expect(header.slice(1, 4)).toEqual(['招商银行 储蓄卡', '招商银行 信用卡', '支付宝'])
    expect(data[1]).toBe('10000.00')
    expect(data[2]).toBe('-2000.00')
    expect(data[3]).toBe('5000.00')
    // 资产合计 15000，负债合计 2000，净资产 13000
    expect(data[4]).toBe('15000.00')
    expect(data[5]).toBe('2000.00')
    expect(data[6]).toBe('13000.00')
  })

  it('不传子账户参数时退化为按账户导出（兼容旧调用）', () => {
    const a1 = acc('a1', '招商银行', 0)
    const snaps = [snap('a1', '2025-01', '8000', 'a1')]
    const csv = exportFullCsv([a1], snaps, [], settings)
    const header = csv.split('\n')[0].split(',')
    expect(header.slice(1, 2)).toEqual(['招商银行'])
    expect(csv.split('\n')[2].split(',')[1]).toBe('8000.00')
  })
})
