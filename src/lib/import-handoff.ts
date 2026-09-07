/**
 * 跨路由传递待导入文件的临时交接处。
 *
 * File 对象无法序列化进 sessionStorage/location.state，
 * 而引导页 → 设置页是同一次 SPA 会话内的跳转（不会重新加载页面），
 * 因此用一个模块级变量交接即可。读取后立即清空，避免重复导入。
 */
let pending: File | null = null

export function setPendingImportFile(file: File): void {
  pending = file
}

export function takePendingImportFile(): File | null {
  const f = pending
  pending = null
  return f
}
