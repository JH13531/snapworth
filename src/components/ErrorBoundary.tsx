import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  errorInfo: ErrorInfo | null
  copied: boolean
}

/**
 * 顶层渲染异常兜底：任何子树渲染崩溃时展示错误内容而不是白屏。
 * 注意：挂在 <App /> 外层，不能依赖 i18n / Toast 等 Provider，文案写死中文。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
    console.error('ErrorBoundary 捕获渲染异常:', error, errorInfo)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleCopy = async () => {
    const { error, errorInfo } = this.state
    if (!error) return
    const text = `${error.name}: ${error.message}\n\n${error.stack ?? ''}\n\n组件堆栈:${errorInfo?.componentStack ?? ''}`
    try {
      await navigator.clipboard.writeText(text)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch { /* 剪贴板不可用时静默 */ }
  }

  render() {
    const { error, errorInfo, copied } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <div className="card max-w-lg w-full p-6">
          <h1 className="text-lg font-bold text-red-500 mb-2">页面出错了</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            数据保存在本地，不受影响。可以刷新重试；若反复出现，请把下面的错误信息反馈给开发者。
          </p>
          <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 mb-4 overflow-auto max-h-56">
            <p className="text-sm font-mono text-red-600 dark:text-red-400 break-all">
              {error.name}: {error.message}
            </p>
            {error.stack && (
              <details className="mt-2">
                <summary className="text-xs text-slate-400 cursor-pointer select-none">调用堆栈</summary>
                <pre className="text-[10px] leading-relaxed text-slate-400 whitespace-pre-wrap mt-1">{error.stack}</pre>
              </details>
            )}
            {errorInfo?.componentStack && (
              <details className="mt-2">
                <summary className="text-xs text-slate-400 cursor-pointer select-none">组件堆栈</summary>
                <pre className="text-[10px] leading-relaxed text-slate-400 whitespace-pre-wrap mt-1">{errorInfo.componentStack}</pre>
              </details>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={this.handleCopy} className="btn-secondary flex-1 text-sm">
              {copied ? '已复制 ✓' : '复制错误信息'}
            </button>
            <button onClick={this.handleReload} className="btn-primary flex-1 text-sm">
              刷新页面
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
