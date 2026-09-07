import type { CSSProperties } from 'react'

/**
 * 骨架屏占位块。用于数据加载时的视觉占位。
 */
export default function Skeleton({
  className = '',
  style,
  width,
  height,
  circle = false,
}: {
  className?: string
  style?: CSSProperties
  width?: string | number
  height?: string | number
  circle?: boolean
}) {
  return (
    <div
      className={`skeleton ${circle ? 'rounded-full' : ''} ${className}`}
      style={{
        width: width ?? (circle ? '2.5rem' : undefined),
        height: height ?? (circle ? '2.5rem' : '1rem'),
        ...style,
      }}
    />
  )
}

/** 卡片骨架屏 — 模拟一个典型 card 区块 */
export function SkeletonCard({ className = '', lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={`card p-5 ${className}`}>
      <div className="space-y-3">
        <Skeleton width="40%" height="0.875rem" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} height="1rem" />
        ))}
      </div>
    </div>
  )
}

/** Dashboard 骨架屏 */
export function DashboardSkeleton() {
  return (
    <div className="px-4 lg:px-8 pt-6 pb-8">
      <div className="flex items-end justify-between mb-6">
        <div className="space-y-2">
          <Skeleton width="8rem" height="1.75rem" />
          <Skeleton width="5rem" height="0.875rem" />
        </div>
        <Skeleton width="5rem" height="2.5rem" className="rounded-xl" />
      </div>

      <div className="card p-5 lg:p-7 mb-4 lg:mb-6">
        <Skeleton width="4rem" height="0.875rem" className="mb-2" />
        <Skeleton width="12rem" height="3rem" className="mb-3" />
        <Skeleton width="8rem" height="1rem" />
        <div className="grid grid-cols-2 gap-3 mt-5 pt-5 border-t border-slate-100 dark:border-slate-800">
          <div>
            <Skeleton width="4rem" height="0.75rem" className="mb-1" />
            <Skeleton width="6rem" height="1.5rem" />
          </div>
          <div>
            <Skeleton width="4rem" height="0.75rem" className="mb-1" />
            <Skeleton width="6rem" height="1.5rem" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="card p-4 lg:p-5 lg:col-span-2">
          <Skeleton width="6rem" height="1rem" className="mb-3" />
          <Skeleton width="100%" height="12rem" />
        </div>
        <div className="card p-4 lg:p-5">
          <Skeleton width="5rem" height="1rem" className="mb-3" />
          <Skeleton width="100%" height="12rem" circle className="mx-auto" />
        </div>
      </div>
    </div>
  )
}

/** 账户列表骨架屏 */
export function AccountsSkeleton() {
  return (
    <div className="px-4 lg:px-8 pt-4">
      <div className="flex items-center justify-between mb-4">
        <Skeleton width="4rem" height="1.75rem" />
        <Skeleton width="5rem" height="2.5rem" className="rounded-xl" />
      </div>
      <div className="mb-4">
        <Skeleton width="100%" height="2.5rem" className="rounded-xl mb-2" />
        <div className="flex gap-2">
          <Skeleton width="3rem" height="1.75rem" className="rounded-lg" />
          <Skeleton width="3rem" height="1.75rem" className="rounded-lg" />
          <Skeleton width="3rem" height="1.75rem" className="rounded-lg" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card p-3.5 flex items-center gap-3">
            <Skeleton width="1.5rem" height="1.5rem" />
            <Skeleton width="2.5rem" height="2.5rem" className="rounded-xl" />
            <div className="flex-1 space-y-1.5">
              <Skeleton width="60%" height="0.875rem" />
              <Skeleton width="40%" height="0.75rem" />
            </div>
            <Skeleton width="6rem" height="1.5rem" />
          </div>
        ))}
      </div>
    </div>
  )
}
