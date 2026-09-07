import type { Account, AccountType } from '@/types'
import { uuid } from '@/db'
import { getCurrentLang } from '@/lib/i18n-locale'

export interface AccountPreset {
  name: string
  nameEn: string
  icon: string
  color: string
  type: AccountType
  category: string
  currency: string
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']

/**
 * 通用账户模板。
 * name 只是占位符/默认值，用户应在添加时修改为自己的别名（如"中国银行储蓄卡"）。
 * 分析按 category 分组，不按具体银行名枚举。
 * name / nameEn 分别提供中英文占位名，创建账户时按当前语言选用。
 */
export const ACCOUNT_PRESETS: AccountPreset[] = [
  { name: '储蓄卡', nameEn: 'Debit Card', icon: 'credit-card', color: COLORS[0], type: 'asset', category: 'cash', currency: 'CNY' },
  { name: '微信零钱', nameEn: 'WeChat Balance', icon: 'smartphone', color: COLORS[1], type: 'asset', category: 'cash', currency: 'CNY' },
  { name: '支付宝余额', nameEn: 'Alipay Balance', icon: 'smartphone', color: '#3b82f6', type: 'asset', category: 'cash', currency: 'CNY' },
  { name: '现金', nameEn: 'Cash', icon: 'wallet', color: COLORS[3], type: 'asset', category: 'cash', currency: 'CNY' },
  { name: '定期存款', nameEn: 'Time Deposit', icon: 'piggy-bank', color: COLORS[4], type: 'asset', category: 'savings', currency: 'CNY' },
  { name: '公积金', nameEn: 'Housing Fund', icon: 'building', color: COLORS[5], type: 'asset', category: 'savings', currency: 'CNY' },
  { name: '股票账户', nameEn: 'Stock Account', icon: 'trending-up', color: '#ef4444', type: 'asset', category: 'investment', currency: 'CNY' },
  { name: '基金账户', nameEn: 'Fund Account', icon: 'trending-up', color: COLORS[7], type: 'asset', category: 'investment', currency: 'CNY' },
  { name: '房产', nameEn: 'Real Estate', icon: 'house', color: COLORS[0], type: 'asset', category: 'real_estate', currency: 'CNY' },
  { name: '信用卡', nameEn: 'Credit Card', icon: 'credit-card', color: COLORS[3], type: 'liability', category: 'credit_card', currency: 'CNY' },
  { name: '花呗', nameEn: 'Huabei', icon: 'shopping-bag', color: COLORS[2], type: 'liability', category: 'credit_card', currency: 'CNY' },
  { name: '房贷', nameEn: 'Mortgage', icon: 'house', color: COLORS[3], type: 'liability', category: 'mortgage', currency: 'CNY' },
  { name: '车贷', nameEn: 'Auto Loan', icon: 'car', color: COLORS[4], type: 'liability', category: 'car_loan', currency: 'CNY' },
]

/** 按当前语言返回预设的占位名。 */
export function presetName(p: AccountPreset): string {
  return getCurrentLang() === 'en' ? p.nameEn : p.name
}

/**
 * 常用银行快捷选择——仅用于快速填入账户名称，不创建独立预设或分类。
 * 用户也可以完全不选，直接手输任意银行/别名。
 */
export const COMMON_BANKS = [
  '中国银行', '工商银行', '建设银行', '农业银行', '交通银行',
  '招商银行', '邮储银行', '兴业银行', '浦发银行', '中信银行',
  '民生银行', '光大银行', '平安银行', '华夏银行', '广发银行',
]

export const COMMON_BANKS_EN = [
  'Bank of China', 'ICBC', 'China Construction Bank', 'Agricultural Bank of China', 'Bank of Communications',
  'China Merchants Bank', 'Postal Savings Bank', 'Industrial Bank', 'SPD Bank', 'CITIC Bank',
  'China Minsheng Bank', 'China Everbright Bank', 'Ping An Bank', 'Huaxia Bank', 'Guangfa Bank',
]

/** 按当前语言返回常用银行列表。 */
export function commonBanks(): string[] {
  return getCurrentLang() === 'en' ? COMMON_BANKS_EN : COMMON_BANKS
}

/** 从账户名推断出的元数据。 */
export interface InferredMeta {
  type: AccountType
  category: string
  icon: string
  color: string
}

/**
 * 关键词 → 元数据的推断规则，按数组顺序匹配（先命中的先返回）。
 * 覆盖中英文常见账户名片段，用于导入 CSV/Excel 时给账户自动归类，
 * 避免一律被录成「现金」。无匹配时回退为现金/活期。
 */
const INFER_RULES: { keywords: string[]; meta: InferredMeta }[] = [
  // 负债类（优先于现金判断）
  { keywords: ['房贷', '按揭', 'mortgage'], meta: { type: 'liability', category: 'mortgage', icon: 'house', color: COLORS[3] } },
  { keywords: ['车贷', 'auto loan', 'car loan'], meta: { type: 'liability', category: 'car_loan', icon: 'car', color: COLORS[4] } },
  { keywords: ['信用卡', 'credit card', '花呗', '借呗', '白条', 'credit'], meta: { type: 'liability', category: 'credit_card', icon: 'credit-card', color: COLORS[3] } },
  { keywords: ['消费贷', '网贷', '消费金融', 'consumer loan', 'personal loan', 'loan'], meta: { type: 'liability', category: 'consumer_loan', icon: 'landmark', color: COLORS[5] } },
  { keywords: ['应付', 'accounts payable', 'payable'], meta: { type: 'liability', category: 'payable', icon: 'coins', color: COLORS[6] } },
  { keywords: ['负债', '欠款', 'debt'], meta: { type: 'liability', category: 'other_liability', icon: 'circle-dot', color: COLORS[7] } },
  // 资产类
  // 货币基金（余额宝/理财通）——放在投资/现金规则之前，避免被"理财""余额"误命中
  { keywords: ['余额宝', '理财通'], meta: { type: 'asset', category: 'savings', icon: 'piggy-bank', color: COLORS[4] } },
  { keywords: ['证券', '股票', '基金', 'etf', '富途', 'futu', '老虎', 'tiger', '雪盈', '期权', '期货', '投资', '理财', '券商', 'broker', 'investment', 'stock', 'fund', 'equity', 'brokerage'], meta: { type: 'asset', category: 'investment', icon: 'trending-up', color: '#ef4444' } },
  { keywords: ['房产', '不动产', '物业', '房子', '住宅', '公寓', '自住房', '商铺', '车位', 'real estate', 'property'], meta: { type: 'asset', category: 'real_estate', icon: 'building', color: COLORS[0] } },
  { keywords: ['保险', 'insurance', '保单'], meta: { type: 'asset', category: 'insurance', icon: 'shield', color: COLORS[1] } },
  { keywords: ['黄金', 'gold', '比特币', 'btc', 'crypto', '数字资产', '另类', '收藏', 'art', 'collectible'], meta: { type: 'asset', category: 'alternative', icon: 'gem', color: COLORS[2] } },
  // 现金/活期（银行、钱包、借记卡）——放在「储蓄/存款」之前，避免"储蓄卡"被误判为储蓄
  { keywords: ['银行', 'bank', '储蓄卡', '借记卡', 'debit', '微信', 'wechat', '支付宝', 'alipay', '零钱', '现金', '钱包', 'wallet', 'cash', '活期', '余额', 'balance', '卡'], meta: { type: 'asset', category: 'cash', icon: 'wallet', color: '#6366f1' } },
  // 储蓄/定期（"储蓄"单独出现时归此类；带"卡"的已在上条命中现金）
  { keywords: ['公积金', 'housing fund', '定期', '存款', '储蓄', '储蓄存款', '年金', 'deposit', 'savings'], meta: { type: 'asset', category: 'savings', icon: 'piggy-bank', color: COLORS[4] } },
]

/** 从账户名推断类型/分类/图标/颜色，用于导入时自动归类。 */
export function inferAccountMeta(name: string): InferredMeta {
  const n = name.trim().toLowerCase()
  for (const rule of INFER_RULES) {
    if (rule.keywords.some((k) => n.includes(k.toLowerCase()))) {
      return rule.meta
    }
  }
  return { type: 'asset', category: 'cash', icon: 'wallet', color: '#6366f1' }
}

export function presetToAccount(p: AccountPreset, sortOrder: number): Account {
  const now = new Date().toISOString()
  return {
    id: uuid(),
    name: presetName(p),
    icon: p.icon,
    color: p.color,
    type: p.type,
    category: p.category,
    currency: p.currency,
    include_in_networth: true,
    hidden: false,
    archived: false,
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
  }
}

