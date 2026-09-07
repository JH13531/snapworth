/**
 * 汇率 API 客户端。
 *
 * 主数据源：欧洲央行 ECB Statistical Data Warehouse
 *   - https://data-api.ecb.europa.eu
 *   - 官方数据、免费、无需 API key
 *   - 历史可追溯至 1999 年欧元诞生，支持 30+ 主要货币
 *   - 参考汇率，每个工作日更新
 *
 * 备数据源：@fawazahmed0/currency-api（仅当月兜底用）
 *   - 币种更全（150+），最新数据更新更快
 *   - 历史数据约保留 1-2 年
 *
 * 仅在用户主动点击"获取汇率"时发起请求，不自动联网、不上传任何数据。
 */

export interface RateResult {
  date: string
  base: string
  rates: Record<string, number>
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * 从欧洲央行 ECB 获取汇率。
 * 取指定日期所在月的最后一个交易日汇率。
 *
 * ECB 数据格式：EXR.D.{CURRENCY}.EUR.SP00.A
 *   OBS_VALUE = 1 EUR = X CURRENCY（即 CURRENCY/EUR 汇率）
 */
async function fetchRatesFromECB(base: string, date: string, targetCurrencies: string[]): Promise<RateResult> {
  const baseUpper = base.toUpperCase()
  const targets = targetCurrencies.map((c) => c.toUpperCase()).filter((c) => c !== baseUpper)

  if (targets.length === 0) return { date, base, rates: {} }

  // 取月底最后 7 天范围，确保拿到最后一个交易日的数据
  const targetDate = new Date(date + 'T00:00:00Z')
  const startDate = new Date(targetDate)
  startDate.setDate(startDate.getDate() - 7)
  const startStr = startDate.toISOString().slice(0, 10)

  // 所有需要查询的货币（基准 + 目标），排除 EUR（ECB 以 EUR 为基准）
  const allCurrencies = [...new Set([baseUpper, ...targets])].filter((c) => c !== 'EUR')

  // ECB 不支持批量查询时分开查询
  const curPerEur = new Map<string, number>()
  let latestDate = ''

  for (const cur of allCurrencies) {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${cur}.EUR.SP00.A?startPeriod=${startStr}&endPeriod=${date}&format=csvdata&lastNObservations=1`
    try {
      const csv = await fetchText(url)
      const lines = csv.trim().split('\n')
      if (lines.length < 2) continue

      const header = lines[0].split(',')
      const valIdx = header.indexOf('OBS_VALUE')
      const timeIdx = header.indexOf('TIME_PERIOD')
      if (valIdx === -1 || timeIdx === -1) continue

      // 找最后一个有值的行
      for (let i = lines.length - 1; i >= 1; i--) {
        const cols = lines[i].split(',')
        const valStr = cols[valIdx]
        if (!valStr || valStr === '') continue
        const val = parseFloat(valStr)
        if (!isNaN(val) && val > 0) {
          curPerEur.set(cur, val)  // 1 EUR = val CUR
          if (cols[timeIdx] > latestDate) latestDate = cols[timeIdx]
          break
        }
      }
    } catch {
      // 单个货币失败不影响其他
    }
  }

  if (curPerEur.size === 0) throw new Error('ECB 无可用汇率数据')

  // 换算：以 base 为基准
  // ECB 值: 1 EUR = curPerEur.get(X) X
  // 求: 1 base = ? target
  //   => target/base = (target/EUR) / (base/EUR) = curPerEur.get(target) / curPerEur.get(base)
  const basePerEur = baseUpper === 'EUR' ? 1 : curPerEur.get(baseUpper)
  if (!basePerEur || basePerEur <= 0) throw new Error(`ECB 无 ${baseUpper} 汇率数据`)

  const rates: Record<string, number> = {}
  for (const t of targets) {
    const targetPerEur = t === 'EUR' ? 1 : curPerEur.get(t)
    if (!targetPerEur || targetPerEur <= 0) continue
    const rate = targetPerEur / basePerEur
    rates[t.toLowerCase()] = rate
  }

  if (Object.keys(rates).length === 0) throw new Error('ECB 无可换算的目标货币')

  const finalDate = latestDate || date
  return { date: finalDate, base, rates }
}

/**
 * 从 currency-api 获取汇率（当月兜底用）。
 */
async function fetchRatesFromCurrencyApi(base: string, date: string): Promise<RateResult> {
  const code = base.toLowerCase()
  const version = date === 'latest' ? 'latest' : date
  const path = `/v1/currencies/${code}.json`

  const primary = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${version}${path}`
  const fallback = date === 'latest' ? `https://currency-api.pages.dev${path}` : null

  const urls = fallback ? [primary, fallback] : [primary]
  let lastErr: unknown
  for (const url of urls) {
    try {
      const data = (await fetchJson(url)) as Record<string, unknown>
      const dateStr = String(data.date ?? '')
      const rates = (data[code] ?? {}) as Record<string, number>
      return { date: dateStr, base, rates }
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error('currency-api 不可用：' + (lastErr instanceof Error ? lastErr.message : String(lastErr)))
}

/**
 * 获取指定日期（YYYY-MM-DD）的汇率，基准货币为 base。
 * date 为 'latest' 时取最新。
 *
 * 优先用 ECB（历史更长、官方数据）；当月 latest 优先 currency-api（更新更快）。
 */
export async function fetchRates(
  base: string,
  date: string = 'latest',
  targetCurrencies?: string[],
): Promise<RateResult> {
  if (date === 'latest') {
    // 最新数据先走 currency-api（更新频率更高）
    try {
      return await fetchRatesFromCurrencyApi(base, date)
    } catch {
      // 失败则回退到 ECB 最近一个工作日
      if (targetCurrencies && targetCurrencies.length > 0) {
        const today = new Date().toISOString().slice(0, 10)
        try {
          return await fetchRatesFromECB(base, today, targetCurrencies)
        } catch { /* ignore */ }
      }
      throw new Error('汇率服务暂不可用')
    }
  }

  // 历史数据：优先 ECB
  if (targetCurrencies && targetCurrencies.length > 0) {
    try {
      return await fetchRatesFromECB(base, date, targetCurrencies)
    } catch { /* fall through */ }
  }

  // 回退到 currency-api
  return fetchRatesFromCurrencyApi(base, date)
}

function lastDayOfMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface MonthRateResult {
  rates: Record<string, number>
  rate_date: string
}

/**
 * 获取某个月份（YYYY-MM）的汇率，取该月最后一天；
 * 当前月取最新（避免月末还没数据时为空）。
 */
export async function fetchRatesForMonth(
  base: string,
  yyyyMm: string,
  currencies: string[],
  referenceDate?: string,  // 参考日期 YYYY-MM-DD，传了就取那天的汇率；不传则当月取最新、历史月取月底
): Promise<MonthRateResult> {
  let date: string
  const todayStr = todayISO()
  if (referenceDate) {
    // 参考日期是今天或之后：用 latest 获取最新数据（更新更快）
    // 参考日期是历史日期：正常走历史数据接口
    date = referenceDate >= todayStr ? 'latest' : referenceDate
  } else {
    const today = todayStr.slice(0, 7)
    const isCurrent = yyyyMm >= today
    date = isCurrent ? 'latest' : lastDayOfMonth(yyyyMm)
  }
  const result = await fetchRates(base, date, currencies)
  // API 返回 1 base = X foreign；本产品存储 rate_to_base = 1 foreign = X base，需取倒数。
  const rates: Record<string, number> = {}
  for (const cur of currencies) {
    const key = cur.toLowerCase()
    if (key in result.rates && key !== base.toLowerCase()) {
      const foreignPerBase = result.rates[key]
      if (foreignPerBase > 0) rates[cur] = 1 / foreignPerBase
    }
  }
  return { rates, rate_date: result.date }
}
