import { test, expect, type Page } from '@playwright/test'

function collectErrors(page: Page) {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      if (/favicon|Failed to load resource|net::ERR/i.test(text)) return
      consoleErrors.push(text)
    }
  })
  return { pageErrors, consoleErrors }
}

function assertNoErrors(errs: { pageErrors: string[]; consoleErrors: string[] }) {
  expect(errs.pageErrors, `未捕获异常:\n${errs.pageErrors.join('\n')}`).toEqual([])
  expect(errs.consoleErrors, `console 错误:\n${errs.consoleErrors.join('\n')}`).toEqual([])
}

async function onboard(page: Page, name = '边界测试') {
  await page.goto('/')
  await page.waitForURL('**/onboarding')
  await page.getByRole('button', { name: '跳过' }).click()
  await page.getByRole('textbox').fill(name)
  await page.getByRole('button', { name: '完成' }).click()
  await page.waitForURL('/')
}

test.describe('边缘场景', () => {
  test('记账页：输入 0 和空值不应崩溃', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/entry')
    const inputs = page.locator('input[placeholder="0.00"]')
    
    await inputs.nth(0).fill('0')
    await page.getByText('本月净资产').click()
    await expect(page.getByText('¥0.00').first()).toBeVisible()
    
    await inputs.nth(0).fill('')
    await page.getByText('本月净资产').click()
    await expect(page.locator('text=/进度\\s*0\\/3/').first()).toBeVisible()
    
    await inputs.nth(0).fill('-100')
    await page.getByText('本月净资产').click()

    assertNoErrors(errs)
  })

  test('记账页：超大金额和精度', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/entry')
    const inputs = page.locator('input[placeholder="0.00"]')
    
    await inputs.nth(0).fill('999999999999.99')
    await inputs.nth(1).fill('0.12')
    await inputs.nth(2).fill('100.01')
    await page.getByText('本月净资产').click()

    assertNoErrors(errs)
  })

  test('记账页：快速连续输入状态一致', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/entry')
    const inputs = page.locator('input[placeholder="0.00"]')
    
    for (let i = 0; i < 3; i++) {
      await inputs.nth(i).fill(String((i + 1) * 1000))
    }
    await page.getByText('本月净资产').click()
    await page.waitForTimeout(500)
    await expect(page.getByText('¥6,000.00').first()).toBeVisible()
    
    for (let i = 0; i < 3; i++) {
      await inputs.nth(i).fill('')
      await inputs.nth(i).fill(String((i + 1) * 500))
    }
    await page.getByText('本月净资产').click()
    await page.waitForTimeout(500)
    await expect(page.getByText('¥3,000.00').first()).toBeVisible()

    assertNoErrors(errs)
  })

  test('空数据状态下各页面不白屏', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: '边界测试' })).toBeVisible()
    
    await page.goto('/entry')
    await expect(page.getByText('本月净资产')).toBeVisible()
    
    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: '分析' })).toBeVisible()
    
    await page.goto('/accounts')
    await expect(page.getByRole('heading', { name: '账户' })).toBeVisible()
    
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
    
    await page.goto('/settings/rates')
    await expect(page.getByText('汇率管理')).toBeVisible()

    assertNoErrors(errs)
  })

  test('复盘标签：添加和删除自定义标签', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/entry')
    const inputs = page.locator('input[placeholder="0.00"]')
    await inputs.nth(0).fill('10000')
    await inputs.nth(1).fill('500')
    await inputs.nth(2).fill('300')
    await page.getByText('本月净资产').click()
    await page.waitForTimeout(300)
    
    await page.getByRole('button', { name: /完成记账/ }).click()
    await page.waitForURL(/\/review\//)
    
    // 点击"+ 标签"打开输入框
    await page.locator('.rounded-full').filter({ hasText: '标签' }).last().click()
    const tagInput = page.getByPlaceholder('标签名')
    
    await tagInput.fill('年终奖')
    await tagInput.press('Enter')
    await page.waitForTimeout(200)
    await page.locator('.rounded-full').filter({ hasText: '标签' }).last().click()
    const tagInput2 = page.getByPlaceholder('标签名')
    await tagInput2.fill('投资收益')
    await tagInput2.press('Enter')
    
    // 验证自定义标签已添加并选中
    await expect(page.getByRole('button', { name: '年终奖' })).toHaveClass(/bg-brand-600/)
    await expect(page.getByRole('button', { name: '投资收益' })).toHaveClass(/bg-brand-600/)
    
    // 验证预设标签也可以切换
    await page.getByRole('button', { name: '工资' }).click()
    await expect(page.getByRole('button', { name: '工资' })).toHaveClass(/bg-brand-600/)
    
    // 完成复盘
    await page.getByRole('button', { name: /完成复盘/ }).click()
    await page.getByRole('button', { name: '查看总览趋势' }).click()
    await page.waitForURL('/')
    
    // 分析页验证标签筛选
    await page.goto('/analytics')
    await expect(page.getByRole('button', { name: '投资收益' }).first()).toBeVisible()

    assertNoErrors(errs)
  })

  test('引导页：不选任何预设账户也能完成', async ({ page }) => {
    const errs = collectErrors(page)
    
    await page.goto('/')
    await page.waitForURL('**/onboarding')
    await page.getByRole('button', { name: '跳过' }).click()
    
    for (const name of ['储蓄卡', '微信零钱', '支付宝余额']) {
      await page.getByRole('button', { name }).click()
    }
    
    await page.getByRole('textbox').fill('空账本')
    await page.getByRole('button', { name: '完成' }).click()
    await page.waitForURL('/')
    
    // 首页不白屏
    await expect(page.getByText('每月 3 分钟，看清资产全貌')).toBeVisible()
    
    // 记账页有空状态提示
    await page.goto('/entry')
    await expect(page.getByText('还没有账户')).toBeVisible()
    
    assertNoErrors(errs)
  })

  test('记账页：切换月份数据正确', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/entry')
    const inputs = page.locator('input[placeholder="0.00"]')
    
    // 本月填入并保存
    await inputs.nth(0).fill('10000')
    await inputs.nth(1).fill('500')
    await inputs.nth(2).fill('300')
    await page.getByRole('button', { name: /保存并完成记账|完成记账/ }).click()
    await page.waitForURL(/\/review\//)
    await page.getByRole('button', { name: /完成复盘/ }).click()
    await page.getByRole('button', { name: '查看总览趋势' }).click()
    await page.waitForURL('/')
    
    // 回到记账页
    await page.goto('/entry')
    
    // 切换到上个月
    await page.locator('.sticky button').first().click()
    await page.waitForTimeout(300)
    
    // 上个月应该显示"暂无对比"
    await expect(page.locator('text=暂无对比').first()).toBeVisible()
    
    // 在上个月填入并保存
    const prevInputs = page.locator('input[placeholder="0.00"]')
    await prevInputs.nth(0).fill('9000')
    await prevInputs.nth(1).fill('400')
    await prevInputs.nth(2).fill('200')
    await page.getByRole('button', { name: /保存并完成记账|完成记账/ }).click()
    await page.waitForURL(/\/review\//)
    await page.getByRole('button', { name: /完成复盘/ }).click()
    await page.getByRole('button', { name: '查看总览趋势' }).click()
    await page.waitForURL('/')
    
    // 回到记账页看本月
    await page.goto('/entry')
    
    // 本月数据还在
    await expect(page.getByText('¥10,800.00').first()).toBeVisible()
    
    assertNoErrors(errs)
  })
})
