import { getCurrentLang } from '@/lib/i18n-locale'

export interface CurrencyDef {
  code: string
  name: string
  nameEn: string
  symbol: string
  decimals: number
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'CNY', name: '人民币', nameEn: 'Chinese Yuan', symbol: '¥', decimals: 2 },
  { code: 'USD', name: '美元', nameEn: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: '欧元', nameEn: 'Euro', symbol: '€', decimals: 2 },
  { code: 'HKD', name: '港币', nameEn: 'Hong Kong Dollar', symbol: 'HK$', decimals: 2 },
  { code: 'JPY', name: '日元', nameEn: 'Japanese Yen', symbol: '¥', decimals: 0 },
  { code: 'GBP', name: '英镑', nameEn: 'British Pound', symbol: '£', decimals: 2 },
  { code: 'SGD', name: '新加坡元', nameEn: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
  { code: 'AUD', name: '澳元', nameEn: 'Australian Dollar', symbol: 'A$', decimals: 2 },
  { code: 'CAD', name: '加元', nameEn: 'Canadian Dollar', symbol: 'C$', decimals: 2 },
]

/** 按当前语言返回货币名称。 */
export function currencyName(c: CurrencyDef): string {
  return getCurrentLang() === 'en' ? c.nameEn : c.name
}

export function currencyDef(code: string): CurrencyDef {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]
}
