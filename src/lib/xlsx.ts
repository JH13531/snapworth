import type { Account, SubAccount, Snapshot, ExchangeRate, Settings } from '@/types'
import { buildExportSections, esc } from '@/lib/csv'
import { tl } from '@/lib/i18n-locale'
import type * as XLSXTypes from 'xlsx'

type XLSX = typeof XLSXTypes

/**
 * 多工作表 xlsx 导出：金额 / 账户信息 / 汇率 / 币种覆盖 各占一个 sheet，
 * 与 CSV 分区格式同源（buildExportSections），导入时也能完整还原。
 *
 * sheet 约定：
 *   - 第一个 sheet「金额」：纯金额表（数字单元格为真正的数值，方便 Excel 求和）
 *   - 其余 sheet：A1 为区块标题（如「汇率(基准:CNY)」，导入时据此识别），第 2 行起为表格
 */

export function buildXlsxWorkbook(
  XLSX: XLSX,
  accounts: Account[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  settings: Settings,
  subAccounts: SubAccount[] = [],
): XLSXTypes.WorkBook {
  const s = buildExportSections(accounts, snapshots, rates, settings, subAccounts)
  const wb = XLSX.utils.book_new()

  // 金额 sheet：数据行的数字列写成数值类型，Excel 里可直接求和/做图
  const amountsAoa = s.amounts.map((row, ri) =>
    row.map((cell, ci) => {
      if (ri > 0 && ci > 0 && cell !== '' && !isNaN(Number(cell))) return Number(cell)
      return cell
    }),
  )
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(amountsAoa), s.markers.amounts)

  const addSectionSheet = (title: string, rows: string[][], sheetName: string) => {
    // Excel sheet 名不允许 : \ / ? * [ ]，且区块标题可能含「(基准:CNY)」，故 sheet 名用纯名称、标题写在 A1
    const safeName = sheetName.replace(/[:\\/?*[\]]/g, '').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[title], ...rows]), safeName)
  }

  if (s.accountsInfo.length > 0) addSectionSheet(s.markers.accounts, s.accountsInfo, s.markers.accounts)
  if (s.rates) addSectionSheet(s.rates.marker, s.rates.rows, tl('csv.section_rates'))
  if (s.overrides) addSectionSheet(s.markers.overrides, s.overrides, s.markers.overrides)

  return wb
}

/** 导出并下载 .xlsx 文件 */
export async function downloadFullXlsx(
  accounts: Account[],
  snapshots: Snapshot[],
  rates: ExchangeRate[],
  settings: Settings,
  subAccounts: SubAccount[],
  filename: string,
): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = buildXlsxWorkbook(XLSX, accounts, snapshots, rates, settings, subAccounts)
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const SECTION_RE = /^(账户信息|account info|汇率|exchange rates|币种覆盖|currency overrides)/i

function sheetRows(XLSX: XLSX, ws: XLSXTypes.WorkSheet): string[][] {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as (string | number)[][]
  return aoa
    .map((row) => row.map((c) => (typeof c === 'number' ? String(c) : String(c ?? ''))))
    .filter((row) => row.some((c) => c.trim() !== ''))
}

/**
 * 把多工作表 xlsx 还原成分区 CSV 文本（喂给 parseCsvWide，复用同一套解析逻辑）。
 * 不是本应用导出的多 sheet 格式时返回 null，调用方退回「第一个 sheet 转 CSV」的旧逻辑。
 */
export function workbookToCsvText(XLSX: XLSX, wb: XLSXTypes.WorkBook): string | null {
  const sheets = wb.SheetNames.map((name) => ({ name, rows: sheetRows(XLSX, wb.Sheets[name]) }))
  const isSection = (sh: { name: string; rows: string[][] }) =>
    SECTION_RE.test(sh.name.trim()) || SECTION_RE.test(sh.rows[0]?.[0]?.trim() ?? '')

  // 至少存在一个区块 sheet 才认为是本应用的多表格式
  if (!sheets.some(isSection)) return null

  const parts: string[] = []
  for (const sh of sheets) {
    if (isSection(sh)) {
      const titleIsMarker = SECTION_RE.test(sh.rows[0]?.[0]?.trim() ?? '')
      const marker = titleIsMarker ? sh.rows[0][0].trim() : sh.name.trim()
      const body = titleIsMarker ? sh.rows.slice(1) : sh.rows
      parts.push([marker, ...body.map((r) => r.map(esc).join(','))].join('\n'))
    } else {
      parts.push(sh.rows.map((r) => r.map(esc).join(',')).join('\n'))
    }
  }
  return parts.join('\n')
}
