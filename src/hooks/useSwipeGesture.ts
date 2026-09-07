import { useRef, useEffect } from 'react'

/**
 * 监听水平滑动手势（移动端）。
 * 当水平滑动距离超过阈值且大于垂直滑动时，触发 onLeft / onRight。
 */
export function useSwipeGesture(
  ref: React.RefObject<HTMLElement | null>,
  handlers: {
    onLeft?: () => void
    onRight?: () => void
    threshold?: number
  },
) {
  const { onLeft, onRight, threshold = 50 } = handlers
  const startX = useRef(0)
  const startY = useRef(0)
  const tracking = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const handleTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]
      startX.current = t.clientX
      startY.current = t.clientY
      tracking.current = true
    }

    const handleTouchEnd = (e: TouchEvent) => {
      if (!tracking.current) return
      tracking.current = false
      const t = e.changedTouches[0]
      const dx = t.clientX - startX.current
      const dy = t.clientY - startY.current
      // 只在水平滑动明显时触发
      if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx) * 0.7) return
      if (dx < 0) onLeft?.()
      else onRight?.()
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [ref, onLeft, onRight, threshold])
}
