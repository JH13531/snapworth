import { tl } from '@/lib/i18n-locale'

export type AccountType = 'asset' | 'liability'

export interface Account {
  id: string
  name: string
  icon: string
  color: string
  type: AccountType
  category: string
  currency: string
  include_in_networth: boolean
  hidden: boolean
  archived: boolean
  archived_at?: string  // 归档月份 YYYY-MM，表示从该月起归档；归档前月份仍计入历史净资产
  sort_order: number
  note?: string
  created_at: string
  updated_at: string
}

export interface SubAccount {
  id: string
  account_id: string
  name: string  // 子账户名称，空则显示分类名
  type: AccountType
  category: string
  icon?: string  // 子账户独立图标；缺省则按分类派生
  color?: string  // 子账户独立颜色；缺省则按「负债红 / 主账户色」派生
  currency: string
  include_in_networth: boolean
  archived: boolean
  archived_at?: string  // 归档月份 YYYY-MM
  sort_order: number
  note?: string
  created_at: string
  updated_at: string
}

export interface Snapshot {
  id: string
  account_id: string
  sub_account_id?: string  // 子账户ID，为空则属于主账户（旧数据兼容）
  month: string
  balance: string
  currency?: string
  recorded_at?: string
  note?: string
  tags?: string[]
  created_at: string
  updated_at: string
}

export interface ExchangeRate {
  month: string
  currency: string
  rate_to_base: string
  rate_date?: string
  created_at: string
  updated_at: string
}

export interface MonthlyReview {
  month: string
  note: string
  tags: string[]
  created_at: string
  updated_at: string
}

export interface BackupRecord {
  id: string
  kind: 'auto-import' | 'manual' | 'auto-export'
  created_at: string
  /** 明文备份数据（auto-import 撤销导入用，以及历史遗留的 auto-export） */
  data?: {
    accounts: Account[]
    /** 子账户。旧版备份缺失此字段。 */
    sub_accounts?: SubAccount[]
    snapshots: Snapshot[]
    exchange_rates: ExchangeRate[]
    monthly_reviews: MonthlyReview[]
  }
  /** 加密 vault blob（auto-export 加密备份用） */
  encrypted_blob?: any  // VaultBlob（加密 vault blob，定义见 crypto.ts）
}

export type Theme = 'light' | 'dark' | 'system'

export interface Settings {
  id: 'singleton'
  base_currency: string
  theme: Theme
  privacy_mode: boolean
  invert_change_color: boolean
  book_name: string
  schema_version: number
  onboarded: boolean
  vault_id?: string
  net_worth_goal?: string  // 净资产目标金额（Decimal string），如 "1000000"
  health_threshold_warn?: number  // 负债率健康阈值（%），低于为健康，默认 50
  health_threshold_danger?: number  // 负债率危险阈值（%），高于为偏高，默认 70
  auto_fetch_rates?: boolean  // 记账完成后自动获取外币汇率
  auto_file_backup?: boolean  // 记账/导入后自动把加密备份写入已授权的本地文件夹
  last_backup_export_at?: string  // 上次手动导出备份的时间（ISO 字符串），用于判断是否需要提醒导出
  language?: 'zh' | 'en'  // 界面语言
  updated_at: string
}

export interface Tombstone {
  id: string
  entity: 'account' | 'snapshot' | 'exchange_rate'
  deleted: true
  updated_at: string
  device_id: string
}

export type CategoryDef = {
  key: string
  label: string
  type: AccountType
  icon: string
}

export const CATEGORIES: CategoryDef[] = [
  { key: 'cash', label: '现金/活期', type: 'asset', icon: 'wallet' },
  { key: 'savings', label: '储蓄/定期', type: 'asset', icon: 'piggy-bank' },
  { key: 'investment', label: '投资(基金/股票)', type: 'asset', icon: 'trending-up' },
  { key: 'alternative', label: '另类投资', type: 'asset', icon: 'gem' },
  { key: 'real_estate', label: '不动产', type: 'asset', icon: 'building' },
  { key: 'insurance', label: '保险现金价值', type: 'asset', icon: 'shield' },
  { key: 'receivable', label: '应收款', type: 'asset', icon: 'hand-coins' },
  { key: 'other_asset', label: '其他资产', type: 'asset', icon: 'circle-dot' },
  { key: 'credit_card', label: '信用卡', type: 'liability', icon: 'credit-card' },
  { key: 'mortgage', label: '房贷', type: 'liability', icon: 'house' },
  { key: 'car_loan', label: '车贷', type: 'liability', icon: 'car' },
  { key: 'consumer_loan', label: '消费贷', type: 'liability', icon: 'landmark' },
  { key: 'payable', label: '应付款', type: 'liability', icon: 'coins' },
  { key: 'other_liability', label: '其他负债', type: 'liability', icon: 'circle-dot' },
]

export function categoryLabel(key: string): string {
  // 预设分类走 i18n 翻译；非预设（用户自定义分类名）直接返回原名，
  // 否则 tl('category.'+中文名) 会查不到键而返回 "category.xxx" 这样的错误值。
  const def = CATEGORIES.find((c) => c.key === key)
  if (def) return tl(`category.${key}`)
  return key
}

export function subAccountName(sub: { name: string; category: string }, accountName?: string): string {
  if (sub.name) return sub.name
  if (accountName) return `${accountName} · ${categoryLabel(sub.category)}`
  return categoryLabel(sub.category)
}

/** 解析子账户展示样式所需的最小字段集合（主账户 SubAccount 与编辑表单 SubAccountForm 均满足）。 */
export type SubStyleSource = { icon?: string; color?: string; category: string }

/**
 * 子账户展示图标：优先用自身 icon，否则回退到分类图标。
 */
export function subAccountIcon(sa: SubStyleSource): string {
  if (sa.icon) return sa.icon
  const catDef = CATEGORIES.find((c) => c.key === sa.category)
  return catDef?.icon ?? 'circle-dot'
}

/**
 * 子账户展示颜色：优先用自身 color，否则负债项固定红、资产项回退主账户色。
 */
export function subAccountColor(sa: SubStyleSource, accountColor?: string): string {
  if (sa.color) return sa.color
  const catDef = CATEGORIES.find((c) => c.key === sa.category)
  if (catDef?.type === 'liability') return '#ef4444'
  return accountColor ?? '#3b82f6'
}
