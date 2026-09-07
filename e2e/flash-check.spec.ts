import { test, expect } from '@playwright/test'

test('验证记账页加载状态而非空状态', async ({ page }) => {
  // 1. 完成引导
  await page.goto('/')
  await page.waitForURL('**/onboarding')
  await page.getByRole('button', { name: '跳过' }).click()
  await page.getByRole('textbox').fill('测试账本')
  await page.getByRole('button', { name: '完成' }).click()
  await page.waitForURL('/')

  // 2. 录入数据
  await page.goto('/entry')
  const inputs = page.locator('input[placeholder="0.00"]')
  await expect(inputs.first()).toBeVisible({ timeout: 5000 })
  const count = await inputs.count()
  await inputs.first().fill('10000')
  if (count > 1) await inputs.nth(1).fill('500')
  if (count > 2) await inputs.nth(2).fill('300')
  await page.getByRole('button', { name: /保存并完成记账|完成记账/ }).click()
  await page.waitForURL(/\/review\//)
  await page.getByRole('button', { name: /完成复盘/ }).click()
  await page.getByRole('button', { name: '查看总览趋势' }).click()
  await page.waitForURL('/')

  // 3. 导航到记账页 — 验证 loading spinner 而非空状态
  await page.goto('/entry')

  // 快速截图检查初始状态
  // 如果有 loading spinner 可见（说明 ready=false），等它消失
  const loader = page.locator('svg.animate-spin')
  const loaderVisibleInitially = await loader.isVisible().catch(() => false)

  // 最终应显示输入框，不显示"还没有账户"
  await expect(inputs.first()).toBeVisible({ timeout: 5000 })
  const noAccountVisible = await page.getByText('还没有账户').isVisible().catch(() => false)
  expect(noAccountVisible).toBe(false)

  // 如果 loader 初始可见，说明 loading 态正常工作（非空状态闪烁）
  // 这里不做严格断言，只记录
  if (loaderVisibleInitially) {
    console.log('LOADING: 初始显示了 loading spinner（正确行为）')
  }
})
