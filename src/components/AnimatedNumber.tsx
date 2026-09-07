import { useEffect, useRef, useState } from 'react'

/**
 * 平滑过渡的数字显示。
 * 通过 requestAnimationFrame 在 duration 毫秒内从旧值过渡到新值。
 */
export default function AnimatedNumber({
  value,
  duration = 400,
  format,
  className,
}: {
  value: number
  duration?: number
  format: (v: number) => string
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef({ value, time: 0 })

  useEffect(() => {
    const from = display
    const to = value
    if (from === to) return
    const startTime = performance.now()
    startRef.current = { value: from, time: startTime }

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = from + (to - from) * eased
      setDisplay(current)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])

  return <span className={className}>{format(display)}</span>
}
