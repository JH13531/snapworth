import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ErrorBoundary from '@/components/ErrorBoundary'

afterEach(cleanup)

function Bomb(): never {
  throw new Error('boom: 测试渲染异常')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React 会把捕获的异常打到 console，测试里静音
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('子树渲染崩溃时显示错误内容而不是白屏', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('页面出错了')).toBeTruthy()
    expect(screen.getAllByText(/boom: 测试渲染异常/).length).toBeGreaterThan(0)
    expect(screen.getByText('刷新页面')).toBeTruthy()
    expect(screen.getByText('复制错误信息')).toBeTruthy()
  })

  it('无异常时正常渲染子树', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('正常内容')).toBeTruthy()
  })
})
