import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom'
import { ArrowLeft, Trash2, AlertTriangle, X, Plus, ChevronDown, GripVertical } from 'lucide-react'
import { db, uuid } from '@/db'
import { useAccount, useSubAccounts, useAccountSnapshots } from '@/hooks/useData'
import { CATEGORIES, type AccountType, categoryLabel, subAccountIcon, subAccountColor } from '@/types'
import { CURRENCIES, currencyName } from '@/lib/currency'
import { ACCOUNT_PRESETS, commonBanks, presetName } from '@/lib/presets'
import { Icon } from '@/components/Icon'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/lib/i18n'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const ICONS = ['wallet', 'piggy-bank', 'trending-up', 'gem', 'building', 'shield', 'hand-coins', 'credit-card', 'house', 'car', 'landmark', 'coins', 'smartphone', 'shopping-bag', 'circle-dot']
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6']
const EMOJIS = ['💰', '💳', '🏦', '🏠', '🚗', '📈', '📊', '💎', '🪙', '💵', '🎁', '🎓', '💻', '🌐', '🐶']

interface SubAccountForm {
  id: string
  name: string
  type: AccountType
  category: string
  currency: string
  include_in_networth: boolean
  icon?: string
  color?: string
  note?: string
  isNew?: boolean
  toDelete?: boolean
  sort_order: number
}

function subAccountDisplay(sa: SubAccountForm): string {
  return sa.name || categoryLabel(sa.category)
}

/**
 * 可拖拽排序的子账户卡片。
 *
 * 拖拽把手单独放在左侧，不与「展开/收起」按钮抢事件——
 * 整卡可拖会让点开表单变成拖拽，很难用。
 */
function SortableSubAccountCard({
  sa,
  color,
  expanded,
  sortable,
  onToggle,
  onRemove,
  onUpdate,
}: {
  sa: SubAccountForm
  color: string
  expanded: boolean
  sortable: boolean
  onToggle: () => void
  onRemove: () => void
  onUpdate: (patch: Partial<SubAccountForm>) => void
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sa.id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 30 : undefined,
        opacity: isDragging ? 0.4 : undefined,
      }}
      className={`border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900 ${
        isDragging ? 'ring-2 ring-brand-500/50 shadow-lg' : ''
      }`}
    >
      <div className="flex items-center gap-2.5 p-2.5">
        {sortable && (
          <button
            {...attributes}
            {...listeners}
            type="button"
            aria-label={t('account_edit.drag_reorder')}
            title={t('account_edit.drag_reorder')}
            className="p-0.5 -ml-1 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400 cursor-grab active:cursor-grabbing touch-none shrink-0"
          >
            <GripVertical size={14} />
          </button>
        )}
        <button onClick={onToggle} type="button" className="flex-1 flex items-center gap-2.5 min-w-0 text-left">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
            style={{ backgroundColor: subAccountColor(sa, color) }}
          >
            <Icon name={subAccountIcon(sa)} size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{subAccountDisplay(sa)}</div>
            <div className="text-[11px] text-slate-400">
              {sa.currency} · {sa.type === 'liability' ? t('accounts.liability') : t('accounts.asset')}
              {!sa.include_in_networth && ` · ${t('accounts.not_included')}`}
            </div>
          </div>
          <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {sortable && (
          <button
            onClick={onRemove}
            type="button"
            aria-label={t('account_edit.delete_subaccount')}
            title={t('account_edit.delete_subaccount')}
            className="p-1 text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 shrink-0"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="p-3 pt-0 border-t border-slate-100 dark:border-slate-700 space-y-3">
          <div>
            <label className="label">{t('account_edit.type')}</label>
            <div className="flex gap-2">
              {(['asset', 'liability'] as const).map((typeVal) => (
                <button
                  key={typeVal}
                  type="button"
                  onClick={() => {
                    const firstCat = CATEGORIES.find((c) => c.type === typeVal)
                    const isCustom = !CATEGORIES.some((c) => c.key === sa.category)
                    onUpdate({
                      type: typeVal,
                      // 自定义分类名切换资产/负债时保留原名，不被预设默认值覆盖
                      category: isCustom ? sa.category : (firstCat?.key ?? sa.category),
                    })
                  }}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium ${
                    sa.type === typeVal ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {typeVal === 'asset' ? t('accounts.asset') : t('accounts.liability')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">{t('account_edit.category')}</label>
            <select
              className="input mb-2"
              // 预设分类直接存 key；自定义分类（不在 CATEGORIES）统一选中「自定义」项
              value={CATEGORIES.some((c) => c.key === sa.category) ? sa.category : '__custom__'}
              onChange={(e) => {
                const v = e.target.value
                if (v === '__custom__') {
                  // 切到自定义：若当前已是自定义名则保留，否则清空等待输入
                  const isCustom = !CATEGORIES.some((c) => c.key === sa.category)
                  onUpdate({ category: isCustom ? sa.category : '' })
                } else {
                  onUpdate({ category: v })
                }
              }}
            >
              {CATEGORIES.filter((c) => c.type === sa.type).map((c) => (
                <option key={c.key} value={c.key}>{categoryLabel(c.key)}</option>
              ))}
              <option value="__custom__">＋ {t('account_edit.custom_category')}</option>
            </select>
            {!CATEGORIES.some((c) => c.key === sa.category) && (
              <input
                className="input"
                placeholder={t('account_edit.custom_category_placeholder')}
                value={sa.category}
                onChange={(e) => onUpdate({ category: e.target.value })}
                autoFocus
              />
            )}
          </div>

          <div>
            <label className="label">{t('account_edit.subaccount_name')}</label>
            <input
              className="input"
              placeholder={t("account_edit.subaccount_name_placeholder")}
              value={sa.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
            />
          </div>

          <div>
            <label className="label">{t('account_edit.sub_icon')}</label>
            <div className="flex flex-wrap gap-1.5">
              {ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onUpdate({ icon: i })}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${sa.icon === i ? 'bg-brand-100 dark:bg-brand-900 ring-2 ring-brand-500' : 'bg-slate-100 dark:bg-slate-800'}`}
                >
                  <Icon name={i} size={16} />
                </button>
              ))}
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onUpdate({ icon: e })}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${sa.icon === e ? 'bg-brand-100 dark:bg-brand-900 ring-2 ring-brand-500' : 'bg-slate-100 dark:bg-slate-800'}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              className="input mt-2"
              placeholder={t("account_edit.sub_icon_custom")}
              value={sa.icon && (ICONS.includes(sa.icon) || EMOJIS.includes(sa.icon)) ? '' : (sa.icon ?? '')}
              onChange={(e) => { const v = e.target.value.trim(); if (v) onUpdate({ icon: v }) }}
              maxLength={4}
            />
          </div>

          <div>
            <label className="label">{t('account_edit.sub_color')}</label>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdate({ color: c })}
                  className={`w-8 h-8 rounded-lg ${sa.color === c ? 'ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-slate-900' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-slate-400">{t('account_edit.sub_color_preview')}</span>
              <span className="w-6 h-6 rounded-md" style={{ backgroundColor: subAccountColor(sa, color) }} />
              <button
                type="button"
                onClick={() => onUpdate({ icon: undefined, color: undefined })}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline ml-auto"
              >
                {t('account_edit.sub_reset_style')}
              </button>
            </div>
          </div>

          <div>
            <label className="label">{t('account_edit.currency')}</label>
            <select
              className="input"
              value={sa.currency}
              onChange={(e) => onUpdate({ currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.code} - {currencyName(c)}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sa.include_in_networth}
              onChange={(e) => onUpdate({ include_in_networth: e.target.checked })}
              className="w-5 h-5 rounded"
            />
            <span className="text-sm">{t('account_edit.include_in_networth')}</span>
          </label>
        </div>
      )}
    </div>
  )
}

export default function AccountEditPage() {
  const { toast } = useToast()
  const { id } = useParams()
  const location = useLocation()
  const isNew = location.pathname === '/accounts/new'
  const navigate = useNavigate()
  const existing = useAccount(isNew ? undefined : id)
  const existingSubs = useSubAccounts({ accountId: isNew ? '' : (id ?? ''), includeArchived: true })
  const existingSnaps = useAccountSnapshots(isNew ? '' : (id ?? ''))

  const [name, setName] = useState('')
  const [icon, setIcon] = useState('wallet')
  const [color, setColor] = useState(COLORS[0])
  const [note, setNote] = useState('')
  const [subAccounts, setSubAccounts] = useState<SubAccountForm[]>([])
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const { t } = useTranslation()
  const [deleteConfirmName, setDeleteConfirmName] = useState('')


  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setIcon(existing.icon)
      setColor(existing.color)
      setNote(existing.note ?? '')
    }
  }, [existing])

  useEffect(() => {
    if (isNew) {
      if (subAccounts.length === 0) {
        setSubAccounts([{
          id: uuid(),
          name: '',
          type: 'asset',
          category: 'cash',
          currency: 'CNY',
          include_in_networth: true,
          isNew: true,
          sort_order: 0,
        }])
        setExpandedSubId(subAccounts[0]?.id ?? null)
      }
      return
    }
    if (existing && existingSubs.length > 0 && subAccounts.length === 0) {
      const forms: SubAccountForm[] = existingSubs
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          category: s.category,
          currency: s.currency,
          include_in_networth: s.include_in_networth,
          icon: s.icon,
          color: s.color,
          note: s.note,
          sort_order: s.sort_order,
        }))
      setSubAccounts(forms)
    }
  }, [existing, existingSubs, isNew])

  const showBankPicker = subAccounts.some((s) => s.category === 'cash' || s.category === 'credit_card')

  function applyPreset(p: typeof ACCOUNT_PRESETS[number]) {
    setName(presetName(p))
    setIcon(p.icon)
    setColor(p.color)
    if (subAccounts.length === 1 && subAccounts[0].isNew) {
      setSubAccounts([{
        ...subAccounts[0],
        type: p.type,
        category: p.category,
        currency: p.currency,
      }])
    }
  }

  function applyBank(bank: string) {
    const firstCat = subAccounts[0]?.category
    const suffix = firstCat === 'credit_card'
      ? t('account_edit.suffix_credit_card')
      : firstCat === 'cash'
        ? t('account_edit.suffix_debit_card')
        : ''
    setName(`${bank}${suffix}`)
  }

  function addSubAccount() {
    const newSub: SubAccountForm = {
      id: uuid(),
      name: '',
      type: 'asset',
      category: 'cash',
      currency: 'CNY',
      include_in_networth: true,
      isNew: true,
      sort_order: subAccounts.filter((s) => !s.toDelete).length,
    }
    setSubAccounts([...subAccounts.filter((s) => !s.toDelete), newSub])
    setExpandedSubId(newSub.id)
  }

  function updateSubAccount(id: string, patch: Partial<SubAccountForm>) {
    setSubAccounts(subAccounts.map((s) => s.id === id ? { ...s, ...patch } : s))
  }

  function removeSubAccount(id: string) {
    const target = subAccounts.find((s) => s.id === id)
    if (!target) return
    if (target.isNew) {
      setSubAccounts(subAccounts.filter((s) => s.id !== id))
    } else {
      setSubAccounts(subAccounts.map((s) => s.id === id ? { ...s, toDelete: true } : s))
    }
    if (expandedSubId === id) setExpandedSubId(null)
  }

  async function save() {
    if (!name.trim()) return
    const activeSubs = subAccounts.filter((s) => !s.toDelete)
    if (activeSubs.length === 0) {
      toast(t('account_edit.need_one_subaccount'), 'error')
      return
    }
    const now = new Date().toISOString()

    if (isNew) {
      const last = await db.accounts.orderBy('sort_order').last()
      const sortOrder = (last?.sort_order ?? -1) + 1
      const accountId = uuid()

      await db.accounts.add({
        id: accountId,
        name: name.trim(),
        icon,
        color,
        type: activeSubs[0].type,
        category: activeSubs[0].category,
        currency: activeSubs[0].currency,
        include_in_networth: activeSubs.some((s) => s.include_in_networth),
        hidden: false,
        archived: false,
        sort_order: sortOrder,
        note: note || undefined,
        created_at: now,
        updated_at: now,
      })

      for (let i = 0; i < activeSubs.length; i++) {
        const s = activeSubs[i]
        await db.subAccounts.add({
          id: s.id,
          account_id: accountId,
          name: s.name.trim(),
          type: s.type,
          category: s.category,
          currency: s.currency,
          include_in_networth: s.include_in_networth,
          icon: s.icon,
          color: s.color,
          archived: false,
          sort_order: i,
          note: s.note || undefined,
          created_at: now,
          updated_at: now,
        })
      }
    } else if (existing) {
      await db.accounts.update(existing.id, {
        name: name.trim(),
        icon,
        color,
        type: activeSubs[0]?.type ?? existing.type,
        category: activeSubs[0]?.category ?? existing.category,
        currency: activeSubs[0]?.currency ?? existing.currency,
        note: note || undefined,
        updated_at: now,
      })

      for (const s of subAccounts) {
        if (s.toDelete && !s.isNew) {
          await db.subAccounts.delete(s.id)
          await db.snapshots.where('account_id').equals(existing.id)
            .filter((sn) => sn.sub_account_id === s.id)
            .delete()
        } else if (!s.toDelete && s.isNew) {
          const idx = subAccounts.filter((x) => !x.toDelete).findIndex((x) => x.id === s.id)
          await db.subAccounts.add({
            id: s.id,
            account_id: existing.id,
            name: s.name.trim(),
            type: s.type,
            category: s.category,
            currency: s.currency,
            include_in_networth: s.include_in_networth,
            icon: s.icon,
            color: s.color,
            archived: false,
            sort_order: idx,
            note: s.note || undefined,
            created_at: now,
            updated_at: now,
          })
        } else if (!s.toDelete && !s.isNew) {
          const idx = subAccounts.filter((x) => !x.toDelete).findIndex((x) => x.id === s.id)
          await db.subAccounts.update(s.id, {
            name: s.name.trim(),
            type: s.type,
            category: s.category,
            currency: s.currency,
            include_in_networth: s.include_in_networth,
            icon: s.icon,
            color: s.color,
            sort_order: idx,
            note: s.note || undefined,
            updated_at: now,
          })
        }
      }
    }
    toast(t('common.saved'), 'success')
    navigate('/accounts')
  }

  function remove() {
    setDeleteConfirmName('')
    setShowDeleteModal(true)
  }

  async function confirmDelete() {
    if (!existing || deleteConfirmName !== existing.name) return
    await db.snapshots.where('account_id').equals(existing.id).delete()
    await db.subAccounts.where('account_id').equals(existing.id).delete()
    await db.accounts.delete(existing.id)
    toast(t('account_edit.account_deleted'), 'success')
    navigate('/accounts')
  }

  const visibleSubs = subAccounts.filter((s) => !s.toDelete)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /**
   * 子账户拖拽排序。save() 会按数组下标重排 sort_order，这里只需改本地顺序。
   * 待删除的项留在数组末尾，不参与展示也不影响最终下标。
   */
  function handleSubDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = visibleSubs.findIndex((s) => s.id === active.id)
    const newIndex = visibleSubs.findIndex((s) => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    setSubAccounts([...arrayMove(visibleSubs, oldIndex, newIndex), ...subAccounts.filter((s) => s.toDelete)])
  }

  return (
    <div className="px-4 lg:max-w-2xl lg:mx-auto pt-4 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/accounts" className="btn-ghost p-2 -ml-2"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold">{isNew ? t('account_edit.new') : t('account_edit.edit')}</h1>
      </div>

      <div className="space-y-4">
        {isNew && (
          <div className="mb-5">
            <div className="text-sm font-medium text-slate-500 mb-2">{t('account_edit.templates')}</div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 lg:flex-wrap lg:overflow-visible">
              {ACCOUNT_PRESETS.map((p, i) => {
                const active = p.icon === icon && p.color === color
                return (
                  <button
                    key={i}
                    onClick={() => applyPreset(p)}
                    className={`shrink-0 px-3 py-2 rounded-xl text-sm flex items-center gap-2 transition-colors ${
                      active ? 'bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <span style={{ color: p.color }}><Icon name={p.icon} size={16} /></span>
                    {presetName(p)}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: color }}>
            <Icon name={icon} size={24} />
          </div>
          <input
            className="input flex-1"
            placeholder={t("account_edit.name_placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {showBankPicker && isNew && (
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-500 mb-2">{t("account_edit.bank_picker")}</div>
            <div className="flex flex-wrap gap-2">
              {commonBanks().map((bank) => (
                <button
                  key={bank}
                  onClick={() => applyBank(bank)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm hover:bg-brand-100 dark:hover:bg-brand-900 hover:text-brand-600 transition-colors"
                >
                  {bank}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <label className="label !mb-0">{t('account_edit.subaccounts')}</label>
            <button onClick={addSubAccount} className="text-sm text-brand-600 flex items-center gap-1">
              <Plus size={14} /> {t('account_edit.add_subaccount')}
            </button>
          </div>
          <div className="text-xs text-slate-400 mb-3 -mt-1.5">
            {t("account_edit.subaccounts_desc")}
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleSubDragEnd}
          >
            <SortableContext
              items={visibleSubs.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {visibleSubs.map((sa) => (
                  <SortableSubAccountCard
                    key={sa.id}
                    sa={sa}
                    color={color}
                    expanded={expandedSubId === sa.id}
                    sortable={visibleSubs.length > 1}
                    onToggle={() => setExpandedSubId(expandedSubId === sa.id ? null : sa.id)}
                    onRemove={() => removeSubAccount(sa.id)}
                    onUpdate={(patch) => updateSubAccount(sa.id, patch)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div className="card p-4">
          <label className="label">{t('account_edit.icon')}</label>
          <div className="flex flex-wrap gap-2 mb-3">
            {ICONS.map((i) => (
              <button
                key={i}
                onClick={() => setIcon(i)}
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  icon === i ? 'bg-brand-100 dark:bg-brand-900 ring-2 ring-brand-500' : 'bg-slate-100 dark:bg-slate-800'
                }`}
              >
                <Icon name={i} size={18} />
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
            <div className="text-xs text-slate-400 mb-2">{t('account_edit.emoji_hint')}</div>
            <div className="flex flex-wrap gap-2 mb-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setIcon(e)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
                    icon === e ? 'bg-brand-100 dark:bg-brand-900 ring-2 ring-brand-500' : 'bg-slate-100 dark:bg-slate-800'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              className="input"
              placeholder={t("account_edit.custom_emoji")}
              value={icon && ICONS.includes(icon) ? '' : icon}
              onChange={(e) => {
                const v = e.target.value.trim()
                if (v) setIcon(v)
              }}
              maxLength={4}
            />
          </div>
        </div>

        <div className="card p-4">
          <label className="label">{t('account_edit.color')}</label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-10 h-10 rounded-xl ${color === c ? 'ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-slate-900' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="card p-4">
          <label className="label">{t('account_edit.note')}</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("account_edit.note_placeholder")} />
        </div>

        <button onClick={save} disabled={!name.trim()} className="btn-primary w-full py-3 text-base">
          {t('common.save')}
        </button>

        {!isNew && (
          <button onClick={remove} className="btn w-full text-red-500 hover:bg-red-50 dark:hover:bg-red-950 py-3">
            <Trash2 size={18} /> {t('account_edit.delete_account')}
          </button>
        )}
      </div>

      {showDeleteModal && existing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 animate-backdrop-in" onClick={() => setShowDeleteModal(false)}>
          <div className="card w-full max-w-sm p-5 animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-red-500">{t('account_edit.delete_account')}</h3>
              <button onClick={() => setShowDeleteModal(false)} className="p-1 text-slate-400"><X size={20} /></button>
            </div>
            <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 mb-4">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <div className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
                  {t('account_edit.delete_warning').replace('{name}', existing.name).replace('{count}', String(existingSnaps.length))}
                </div>
              </div>
            </div>
            <label className="label">{t('account_edit.delete_confirm_label')}</label>
            <input
              className="input mb-4"
              placeholder={t("account_edit.delete_confirm_placeholder").replace("{name}", existing.name)}
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteModal(false)} className="btn-secondary flex-1">
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteConfirmName !== existing.name}
                className="btn flex-1 bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:pointer-events-none"
              >
                <Trash2 size={16} /> {t('account_edit.confirm_delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
