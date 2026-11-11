import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * 「返回」动作：优先走浏览器历史，做到「从哪来回哪去」。
 *
 * 直接打开或刷新深链时，react-router 会把首个 location 的 key 设为 'default'，
 * 此时站内没有上一页可回，改用 fallback —— 否则 navigate(-1) 会跳出应用或停在空白页。
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate()
  const { key } = useLocation()
  return useCallback(() => {
    if (key === 'default') navigate(fallback, { replace: true })
    else navigate(-1)
  }, [navigate, key, fallback])
}
