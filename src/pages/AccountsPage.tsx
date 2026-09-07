import { useState, useMemo, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Archive, Pencil, GripVertical, Search, X, MoreVertical, ChevronDown } from 'lucide-react'
import { useAllAccounts, useSubAccountsWithReady } from '@/hooks/useData'
import { Icon } from '@/components/Icon'
import { FilterDropdown } from '@/components/FilterDropdown'
import { categoryLabel, type Account, type SubAccount, subAccountName, subAccountIcon, subAccountColor } from '@/types'
import { currentMonth } from '@/lib/date'
import { db } from '@/db'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/lib/i18n'

function SortableAccountCard({
  account,
  subAccounts,
  expanded,
  onToggleExpand,
  onArchive,
  filterCategory,
}: {
  account: Account
  subAccounts: SubAccount[]
  expanded: boolean
  onToggleExpand: () => void
  onArchive: (archivedAt?: string) => void
  filterCategory?: string
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: account.id })

  const [menuOpen, setMenuOpen] = useState(false)
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [archiveMonth, setArchiveMonth] = useState(currentMonth())
  const menuRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0 : undefined,
  }

  const activeSubs = subAccounts.filter((s) => !s.archived)
  const displayedSubs = filterCategory
    ? activeSubs.filter((s) => s.category === filterCategory)
    : activeSubs
  const showSubs = filterCategory ? displayedSubs : activeSubs
  const catSummary = showSubs.length > 0
    ? showSubs.map((s) => categoryLabel(s.category)).join(' · ')
    : ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card relative ${isDragging ? 'overflow-hidden shadow-2xl ring-2 ring-brand-500/40 bg-brand-50/50 dark:bg-brand-950/20' : 'overflow-visible'}`}
    >
      <div className="flex items-center gap-2 p-2.5">
        <button
          {...attributes}
          {...listeners}
          className="p-1 -ml-0.5 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400 cursor-grab active:cursor-grabbing touch-none shrink-0"
          title={t('common.drag_reorder')}
        >
          <GripVertical size={14} />
        </button>
        <button
          onClick={onToggleExpand}
          className="flex-1 flex items-center gap-2 min-w-0 text-left"
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
            style={{ backgroundColor: account.color }}
          >
            <Icon name={account.icon} size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{account.name}</div>
            <div className="text-[11px] text-slate-400 truncate">
              {t('accounts.subaccount_count', { count: showSubs.length })}
              {catSummary && ` · ${catSummary}`}
            </div>
          </div>
          <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ${expanded ? '' : '-rotate-90'}`} />
        </button>
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((v) => !v) }}
            className="p-1 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-32 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg z-20 py-1 text-sm">
              <Link
                to={`/accounts/${account.id}/edit`}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Pencil size={14} /> {t("common.edit")}
              </Link>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); setArchiveMonth(currentMonth()); setArchiveDialogOpen(true) }}
                className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 w-full text-left"
              >
                <Archive size={14} /> {t("accounts.archive")}
              </button>
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-2 space-y-1.5">
          {displayedSubs.map((sa) => {
            return (
              <div
                key={sa.id}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-800/70"
              >
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: subAccountColor(sa, account.color) }}
                >
                  <Icon name={subAccountIcon(sa)} size={12} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{subAccountName(sa, account.name)}</div>
                  <div className="text-[10px] text-slate-400">
                    {sa.currency}
                    {sa.type === 'liability' && t('account_detail.liability_suffix')}
                    {!sa.include_in_networth && t('accounts.not_counted')}
                  </div>
                </div>
                <Link
                  to={`/accounts/${account.id}/edit`}
                  className="p-1 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
                  title={t('accounts.edit_subaccount')}
                >
                  <Pencil size={13} />
                </Link>
              </div>
            )
          })}
          <Link
            to={`/accounts/${account.id}/edit`}
            className="flex items-center justify-center gap-1.5 py-2 text-xs text-brand-600 hover:bg-white dark:hover:bg-slate-800/70 rounded-lg w-full"
          >
            <Plus size={13} /> {t('accounts.manage_subaccounts')}
          </Link>
        </div>
      )}

      {archiveDialogOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setArchiveDialogOpen(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-1">{t('accounts.archive_account')}</h3>
            <p className="text-sm text-slate-500 mb-4">{t('accounts.archive_desc')}</p>
            <div className="mb-4">
              <label className="text-sm text-slate-600 dark:text-slate-400 block mb-1.5">{t('accounts.select_archive_month')}</label>
              <input
                type="month"
                value={archiveMonth}
                onChange={(e) => setArchiveMonth(e.target.value)}
                max={currentMonth()}
                className="input"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setArchiveDialogOpen(false)}
                className="btn-secondary flex-1 py-2.5"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => { setArchiveDialogOpen(false); onArchive(archiveMonth) }}
                className="btn flex-1 py-2.5 bg-brand-600 text-white hover:bg-brand-700"
              >
                {t("accounts.confirm_archive")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AccountsPage() {
  const accounts = useAllAccounts()
  const { subAccounts: allSubAccounts } = useSubAccountsWithReady({ includeArchived: true })
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filterType, setFilterType] = useState<'all' | 'asset' | 'liability'>('all')
  const filterCategory = searchParams.get('category') || ''
  const [filterCurrency, setFilterCurrency] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const { toast } = useToast()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const subsByAccount = useMemo(() => {
    const map = new Map<string, SubAccount[]>()
    for (const sa of allSubAccounts) {
      if (!map.has(sa.account_id)) map.set(sa.account_id, [])
      map.get(sa.account_id)!.push(sa)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order)
    }
    return map
  }, [allSubAccounts])

  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts])
  const archivedAccounts = useMemo(() => accounts.filter((a) => a.archived), [accounts])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const sa of allSubAccounts) {
      if (!sa.archived) set.add(sa.category)
    }
    return [...set]
  }, [allSubAccounts])

  const currencies = useMemo(() => {
    const set = new Set<string>()
    for (const sa of allSubAccounts) {
      if (!sa.archived) set.add(sa.currency)
    }
    return [...set]
  }, [allSubAccounts])

  const filtered = useMemo(() => {
    let result = activeAccounts
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((a) => {
        if (a.name.toLowerCase().includes(q)) return true
        const subs = subsByAccount.get(a.id) ?? []
        return subs.some((s) =>
          subAccountName(s, a.name).toLowerCase().includes(q),
        )
      })
    }
    if (filterType !== 'all') {
      result = result.filter((a) => {
        const subs = subsByAccount.get(a.id) ?? []
        return subs.some((s) => !s.archived && s.type === filterType)
      })
    }
    if (filterCategory) {
      result = result.filter((a) => {
        const subs = subsByAccount.get(a.id) ?? []
        return subs.some((s) => !s.archived && s.category === filterCategory)
      })
    }
    if (filterCurrency) {
      result = result.filter((a) => {
        const subs = subsByAccount.get(a.id) ?? []
        return subs.some((s) => !s.archived && s.currency === filterCurrency)
      })
    }
    return result
  }, [activeAccounts, search, filterType, filterCategory, filterCurrency, subsByAccount])

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function toggleArchive(accountId: string, archive: boolean, archiveMonth?: string) {
    const now = new Date().toISOString()
    const subs = subsByAccount.get(accountId) ?? []
    if (archive) {
      await db.accounts.update(accountId, { archived: true, archived_at: archiveMonth, updated_at: now })
      for (const sa of subs) {
        await db.subAccounts.update(sa.id, { archived: true, archived_at: archiveMonth, updated_at: now })
      }
      toast(t('toast.archived'), 'success')
    } else {
      await db.accounts.update(accountId, { archived: false, archived_at: undefined, updated_at: now })
      for (const sa of subs) {
        await db.subAccounts.update(sa.id, { archived: false, archived_at: undefined, updated_at: now })
      }
      toast(t('toast.unarchived'), 'success')
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = filtered.findIndex((a) => a.id === active.id)
    const newIndex = filtered.findIndex((a) => a.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const newItems = arrayMove(filtered, oldIndex, newIndex)
    // 同步更新 updated_at，让合并导入能感知排序变化并覆盖旧值
    const now = new Date().toISOString()
    const updates = newItems.map((item, idx) => db.accounts.update(item.id, { sort_order: idx, updated_at: now }))
    Promise.all(updates)
  }

  const leftColumn = useMemo(
    () => filtered.filter((_, i) => i % 2 === 0),
    [filtered],
  )
  const rightColumn = useMemo(
    () => filtered.filter((_, i) => i % 2 === 1),
    [filtered],
  )

  return (
    <div className="px-4 lg:max-w-2xl lg:mx-auto pt-4 pb-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">{t('accounts.title')}</h1>
        <Link to="/accounts/new" className="btn-primary py-2 px-3.5 text-sm flex items-center gap-1.5">
          <Plus size={16} /> {t('common.add')}
        </Link>
      </div>

      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder={t("accounts.search_placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <FilterDropdown
          value={filterType}
          onChange={(v) => setFilterType(v as 'all' | 'asset' | 'liability')}
          placeholder={t("accounts.all_types")}
          className="flex-1 min-w-0"
          options={[
            { value: 'all', label: t('accounts.all_types') },
            { value: 'asset', label: t('accounts.asset') },
            { value: 'liability', label: t('accounts.liability') },
          ]}
        />
        {categories.length > 0 && (
          <FilterDropdown
            value={filterCategory || '__all__'}
            onChange={(v) => {
              const newCat = v === '__all__' ? '' : v
              if (newCat) {
                setSearchParams({ category: newCat })
              } else {
                setSearchParams({})
              }
            }}
            placeholder={t("accounts.all_categories")}
            className="flex-1 min-w-0"
            options={[
              { value: '__all__' as string, label: t('accounts.all_categories') },
              ...categories.map((cat) => ({ value: cat, label: categoryLabel(cat) })),
            ]}
          />
        )}
        {currencies.length > 1 && (
          <FilterDropdown
            value={filterCurrency || '__all__'}
            onChange={(v) => setFilterCurrency(v === '__all__' ? '' : v)}
            placeholder={t("accounts.all_currencies")}
            className="flex-1 min-w-0"
            options={[
              { value: '__all__' as string, label: t('accounts.all_currencies') },
              ...currencies.map((cur) => ({ value: cur, label: cur })),
            ]}
          />
        )}
      </div>

      {filtered.length === 0 && accounts.length > 0 && (
        <div className="card p-6 text-center text-slate-500 text-sm">
          {t("accounts.empty")}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex gap-2 mb-6">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex-1 flex flex-col gap-2 w-0 min-w-0">
              <SortableContext
                items={leftColumn.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                {leftColumn.map((a) => (
                  <SortableAccountCard
                    key={a.id}
                    account={a}
                    subAccounts={subsByAccount.get(a.id) ?? []}
                    expanded={expandedIds.has(a.id)}
                    onToggleExpand={() => toggleExpand(a.id)}
                    onArchive={(month) => toggleArchive(a.id, true, month)}
                    filterCategory={filterCategory}
                  />
                ))}
              </SortableContext>
            </div>
            <div className="flex-1 flex flex-col gap-2 w-0 min-w-0">
              <SortableContext
                items={rightColumn.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                {rightColumn.map((a) => (
                  <SortableAccountCard
                    key={a.id}
                    account={a}
                    subAccounts={subsByAccount.get(a.id) ?? []}
                    expanded={expandedIds.has(a.id)}
                    onToggleExpand={() => toggleExpand(a.id)}
                    onArchive={(month) => toggleArchive(a.id, true, month)}
                    filterCategory={filterCategory}
                  />
                ))}
              </SortableContext>
            </div>
            <DragOverlay dropAnimation={null}>
              {activeId ? (() => {
                const acc = filtered.find(a => a.id === activeId)
                if (!acc) return null
                const subs = subsByAccount.get(acc.id) ?? []
                return (
                  <div className="card shadow-2xl ring-2 ring-brand-500/40 bg-white dark:bg-slate-900">
                    <div className="flex items-center gap-2 p-2.5">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: acc.color }}
                      >
                        <Icon name={acc.icon} size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{acc.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {t('accounts.subaccount_count', { count: subs.filter(s => !s.archived).length })}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })() : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {archivedAccounts.length > 0 && (
        <>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex items-center gap-1.5 text-sm text-slate-500 mb-2"
          >
            <Archive size={14} /> {t('accounts.archived_count', { count: archivedAccounts.length })} {showArchived ? '▾' : '▸'}
          </button>
          {showArchived && (
            <div className="space-y-2">
              {archivedAccounts.map((a) => {
                const subs = subsByAccount.get(a.id) ?? []
                return (
                  <div key={a.id} className="card p-3.5 flex items-center gap-3 opacity-60">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-300 dark:bg-slate-700 text-white">
                      <Icon name={a.icon} size={20} />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-slate-500">
                        {t('accounts.subaccount_count', { count: subs.length })}
                        {a.archived_at && ` · ${a.archived_at} ${t('accounts.archive')}`}
                      </div>
                    </div>
                    <button onClick={() => toggleArchive(a.id, false)} className="text-sm text-brand-600">
                      {t("accounts.unarchive")}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
