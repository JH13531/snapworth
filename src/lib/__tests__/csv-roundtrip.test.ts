// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { exportFullCsv, parseCsvWide } from '../csv'
import type { Account, SubAccount, Snapshot, ExchangeRate, Settings } from '@/types'

/**
 * CSV 导出 → 导入 的往返一致性：
 * 分区格式（金额表 + 账户信息 + 汇率 + 币种覆盖）必须完整保留
 * 账户结构、子账户、币种、类型、分类、余额、汇率。
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
    // 改过币种的历史：列币种是 USD，这条快照是 EUR → 应进入「币种覆盖」区
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

describe('CSV 分区格式导出', () => {
  const { accounts, subAccounts, snapshots, rates } = makeLedger()
  const csv = exportFullCsv(accounts, snapshots, rates, settings, subAccounts)
  const lines = csv.split('\n')

  it('金额表纯净：表头之后直接是数据行，归档状态已挪走', () => {
    expect(lines[0].startsWith('月份,')).toBe(true)
    expect(lines[1].startsWith('2025-01,')).toBe(true)
    expect(csv).not.toContain('\n归档状态,')
  })

  it('包含账户信息、汇率、币种覆盖三个区块', () => {
    expect(csv).toContain('\n账户信息\n')
    expect(csv).toContain('\n汇率(基准:CNY)\n')
    expect(csv).toContain('\n币种覆盖\n')
    // 币种覆盖按列名登记了 2025-03 那条 EUR 快照（招商银行 信用卡列）
    expect(csv).toContain('2025-03,招商银行 信用卡,EUR')
  })

  it('含逗号的备注被正确转义', () => {
    expect(csv).toContain('"note, with comma"')
  })

  it('汇率表带备注列：无日期的手动汇率标注「手动填写」', () => {
    expect(csv).toContain('月份,币种,汇率,日期,备注')
    // USD 2025-01 有 rate_date（自动获取）→ 备注为空；EUR 与 2025-02 USD 无日期 → 手动填写
    expect(csv).toContain('2025-01,USD,7.1,2025-01-31,')
    expect(csv).toContain('2025-01,EUR,7.8,,手动填写')
    expect(csv).toContain('2025-02,USD,7.2,,手动填写')
  })
})

describe('CSV 导出→导入 往返一致（同基准币种）', () => {
  const { accounts, subAccounts, snapshots, rates } = makeLedger()
  const csv = exportFullCsv(accounts, snapshots, rates, settings, subAccounts)
  const data = parseCsvWide(csv, 'CNY')

  it('账户结构完整保留', () => {
    expect(data.accounts.map((a) => a.name)).toEqual(['招商银行', '支付宝', '房贷'])
    const [bank, alipay, mortgage] = data.accounts
    expect(bank).toMatchObject({
      type: 'asset', category: 'cash', currency: 'CNY',
      hidden: false, archived: false, note: 'note, with comma',
      include_in_networth: true,
    })
    expect(alipay).toMatchObject({
      type: 'asset', category: 'savings', currency: 'CNY',
      hidden: true, include_in_networth: false,
    })
    expect(mortgage).toMatchObject({
      type: 'liability', category: 'mortgage', currency: 'CNY',
      archived: true, archived_at: '2025-06',
    })
  })

  it('子账户完整保留（归属、名称、币种、类型、顺序）', () => {
    expect(data.sub_accounts).toHaveLength(4)
    const bank = data.accounts[0]
    const bankSubs = data.sub_accounts!.filter((s) => s.account_id === bank.id)
    expect(bankSubs).toHaveLength(2)
    expect(bankSubs[0]).toMatchObject({ name: '储蓄卡', currency: 'CNY', type: 'asset', category: 'cash', sort_order: 0 })
    expect(bankSubs[1]).toMatchObject({ name: '信用卡', currency: 'USD', type: 'liability', category: 'credit_card', sort_order: 1 })

    const alipaySub = data.sub_accounts!.find((s) => s.account_id === data.accounts[1].id)!
    expect(alipaySub).toMatchObject({ name: '', category: 'savings', include_in_networth: false })

    const mortgageSub = data.sub_accounts!.find((s) => s.account_id === data.accounts[2].id)!
    expect(mortgageSub).toMatchObject({ type: 'liability', category: 'mortgage', archived: true, archived_at: '2025-06' })
  })

  it('快照余额与币种完整保留（含币种覆盖）', () => {
    expect(data.snapshots).toHaveLength(6)
    const bankSubs = data.sub_accounts!.filter((s) => s.account_id === data.accounts[0].id)
    const savings = bankSubs[0]
    const credit = bankSubs[1]
    const snapOf = (subId: string, month: string) =>
      data.snapshots.find((s) => s.sub_account_id === subId && s.month === month)

    expect(snapOf(savings.id, '2025-01')).toMatchObject({ balance: '10000.55', currency: 'CNY' })
    expect(snapOf(savings.id, '2025-02')).toMatchObject({ balance: '12000', currency: 'CNY' })
    expect(snapOf(credit.id, '2025-01')).toMatchObject({ balance: '-500.25', currency: 'USD' })
    // 币种覆盖：列币种 USD，该月快照应为 EUR
    expect(snapOf(credit.id, '2025-03')).toMatchObject({ balance: '100', currency: 'EUR' })
  })

  it('汇率完整保留（含汇率日期）', () => {
    expect(data.exchange_rates).toHaveLength(3)
    const rate = (month: string, cur: string) =>
      data.exchange_rates.find((r) => r.month === month && r.currency === cur)
    expect(rate('2025-01', 'USD')).toMatchObject({ rate_to_base: '7.1', rate_date: '2025-01-31' })
    expect(rate('2025-01', 'EUR')?.rate_to_base).toBe('7.8')
    expect(rate('2025-02', 'USD')?.rate_to_base).toBe('7.2')
  })
})

describe('CSV 导入时基准币种不同的汇率换算', () => {
  const { accounts, subAccounts, snapshots, rates } = makeLedger()
  const csv = exportFullCsv(accounts, snapshots, rates, settings, subAccounts)
  const data = parseCsvWide(csv, 'EUR')

  it('汇率按新基准重算，新基准自身的行不需要记录', () => {
    const curs = data.exchange_rates.map((r) => `${r.month}|${r.currency}`).sort()
    // 2025-01：USD 与 CNY（旧基准补发）；2025-02 缺 EUR 锚点整月跳过
    expect(curs).toEqual(['2025-01|CNY', '2025-01|USD'])
    const usd = data.exchange_rates.find((r) => r.month === '2025-01' && r.currency === 'USD')!
    const cny = data.exchange_rates.find((r) => r.month === '2025-01' && r.currency === 'CNY')!
    // USD: 7.1 / 7.8 ≈ 0.9102564103；CNY: 1 / 7.8 ≈ 0.1282051282
    expect(usd.rate_to_base).toBe('0.9102564103')
    expect(cny.rate_to_base).toBe('0.1282051282')
  })
})

describe('旧格式 CSV 兼容', () => {
  it('无区块的旧导出文件仍按猜测逻辑导入，且区块数据不会混进金额表', () => {
    const legacy = [
      '月份,房贷,招商银行,资产合计,负债合计,净资产',
      '归档状态,否,否,,,',
      '2025-01,2000000,50000,50000,2000000,-1950000',
    ].join('\n')
    const data = parseCsvWide(legacy, 'CNY')
    expect(data.sub_accounts).toBeUndefined()
    expect(data.accounts.map((a) => a.name)).toEqual(['房贷', '招商银行'])
    expect(data.accounts[0]).toMatchObject({ type: 'liability', category: 'mortgage' })
    expect(data.snapshots).toHaveLength(2)
  })

  it('旧版列号写法的币种覆盖仍能解析', () => {
    const legacy = [
      '月份,储蓄卡,信用卡,资产合计,负债合计,净资产',
      '2025-03,,100,0,100,-100',
      '',
      '账户信息',
      '列,父账户,子账户,币种,类型,分类,计入净资产,归档状态,归档月份,隐藏,图标,颜色,备注',
      '1,招商银行,储蓄卡,CNY,asset,cash,是,否,,否,wallet,#3b82f6,',
      '2,招商银行,信用卡,USD,liability,credit_card,是,否,,否,credit-card,#ef4444,',
      '',
      '币种覆盖',
      '月份,列,币种',
      '2025-03,2,EUR',
    ].join('\n')
    const data = parseCsvWide(legacy, 'CNY')
    const bankSubs = data.sub_accounts!.filter((s) => s.account_id === data.accounts[0].id)
    const snap = data.snapshots.find((s) => s.sub_account_id === bankSubs[1].id && s.month === '2025-03')
    expect(snap?.currency).toBe('EUR')
  })

  it('新格式的汇率/账户信息区块不会污染快照', () => {
    const { accounts, subAccounts, snapshots, rates } = makeLedger()
    const csv = exportFullCsv(accounts, snapshots, rates, settings, subAccounts)
    const data = parseCsvWide(csv, 'CNY')
    // 恰好 6 条快照：汇率行（2025-01,USD,7.1）等没有被误当成金额行
    expect(data.snapshots).toHaveLength(6)
    for (const s of data.snapshots) {
      expect(['储蓄卡', '信用卡', '']).toContain(
        data.sub_accounts!.find((u) => u.id === s.sub_account_id)?.name ?? '',
      )
    }
  })
})
