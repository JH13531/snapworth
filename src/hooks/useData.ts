import { useLiveQuery } from 'dexie-react-hooks'
import { useState, useEffect, useRef } from 'react'
import { db } from '@/db'

export function useAccounts(opts?: { includeArchived?: boolean }) {
  return useLiveQuery(
    async () => {
      const all = await db.accounts.orderBy('sort_order').toArray()
      if (opts?.includeArchived) return all
      return all.filter((a) => !a.archived)
    },
    [opts?.includeArchived],
    [],
  ) ?? []
}

/**
 * 与 useAccounts 相同，但额外返回 `ready` 标志，
 * 用于区分「首次查询尚未完成（默认空数组）」和「确实没有账户」。
 *
 * 原理：
 * - 模块级 _accountCache 保存最近一次查询结果
 * - 首次渲染时若有缓存，直接用缓存初始化 state，跳过 loading
 * - 模块级 _initialDataLoaded 标记首次加载已完成
 * - 后续导航直接跳过 loading 态，无闪烁
 */
let _initialDataLoaded = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _accountCache: any[] | null = null

export function useAccountsWithReady(opts?: { includeArchived?: boolean }) {
  const data = useLiveQuery(
    async () => {
      const all = await db.accounts.orderBy('sort_order').toArray()
      const result = opts?.includeArchived ? all : all.filter((a) => !a.archived)
      if (!opts?.includeArchived) _accountCache = result
      return result
    },
    [opts?.includeArchived],
    _accountCache ?? [],
  ) ?? (_accountCache ?? [])

  const [ready, setReady] = useState(_initialDataLoaded || _accountCache !== null)
  const checkedRef = useRef(_initialDataLoaded || _accountCache !== null)

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true
    db.accounts.count().then(() => {
      _initialDataLoaded = true
      setReady(true)
    }).catch(() => {
      _initialDataLoaded = true
      setReady(true)
    })
  }, [])

  return { accounts: data, ready }
}

export function useAllAccounts() {
  return useLiveQuery(() => db.accounts.orderBy('sort_order').toArray(), [], []) ?? []
}

export function useSubAccounts(opts?: { includeArchived?: boolean; accountId?: string }) {
  return useLiveQuery(
    async () => {
      let all: any[]
      if (opts?.accountId) {
        all = await db.subAccounts.where('account_id').equals(opts.accountId).toArray()
      } else {
        all = await db.subAccounts.orderBy('sort_order').toArray()
      }
      if (opts?.includeArchived) return all
      return all.filter((a) => !a.archived)
    },
    [opts?.accountId, opts?.includeArchived],
    [],
  ) ?? []
}

let _subAccountInitialLoaded = false
let _subAccountCache: any[] | null = null

export function useSubAccountsWithReady(opts?: { includeArchived?: boolean; accountId?: string }) {
  const data = useLiveQuery(
    async () => {
      const all: any[] = opts?.accountId
        ? await db.subAccounts.where('account_id').equals(opts.accountId).toArray()
        : await db.subAccounts.orderBy('sort_order').toArray()
      const result = opts?.includeArchived ? all : all.filter((a) => !a.archived)
      if (!opts?.includeArchived && !opts?.accountId) _subAccountCache = result
      return result
    },
    [opts?.accountId, opts?.includeArchived],
    _subAccountCache ?? [],
  ) ?? (_subAccountCache ?? [])

  const [ready, setReady] = useState(_subAccountInitialLoaded || _subAccountCache !== null)
  const checkedRef = useRef(_subAccountInitialLoaded)

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true
    db.subAccounts.count().then(() => {
      _subAccountInitialLoaded = true
      setReady(true)
    }).catch(() => {
      _subAccountInitialLoaded = true
      setReady(true)
    })
  }, [])

  return { subAccounts: data, ready }
}

export function useSnapshots() {
  return useLiveQuery(() => db.snapshots.toArray(), [], []) ?? []
}

/**
 * 按月份查询快照，利用 Dexie 的 where('month') 索引避免全表扫描。
 * 适用于只需要特定月份数据的场景（录入页、分析页等）。
 */
export function useSnapshotsForMonths(months: string[]) {
  return useLiveQuery(
    async () => {
      if (!months.length) return []
      return db.snapshots.where('month').anyOf(months).toArray()
    },
    [months.join(',')],
    [],
  ) ?? []
}

export function useExchangeRates() {
  return useLiveQuery(() => db.exchangeRates.toArray(), [], []) ?? []
}

export function useAccount(id?: string) {
  return useLiveQuery(
    async () => (id ? db.accounts.get(id) : undefined),
    [id],
  )
}

export function useAccountSnapshots(accountId: string) {
  return useLiveQuery(
    async () => db.snapshots.where('account_id').equals(accountId).toArray(),
    [accountId],
    [],
  ) ?? []
}

export function useMonthlyReview(month?: string) {
  return useLiveQuery(
    async () => (month ? db.monthlyReviews.get(month) : undefined),
    [month],
  )
}

export function useMonthlyReviews() {
  return useLiveQuery(() => db.monthlyReviews.toArray(), [], []) ?? []
}
