import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

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

async function onboard(page: Page, bookName = '测试账本') {
  await page.goto('/')
  await page.waitForURL('**/onboarding')
  await page.getByRole('button', { name: '跳过' }).click()
  await page.getByRole('textbox').fill(bookName)
  await page.getByRole('button', { name: '完成' }).click()
  await page.waitForURL('/')
}

async function fillAllAccounts(page: Page, values: string[], save = false) {
  const inputs = page.locator('input[placeholder="0.00"]')
  for (let i = 0; i < values.length; i++) {
    await inputs.nth(i).fill(values[i])
  }
  await page.getByText('本月净资产').click()
  await page.waitForTimeout(300)
  if (save) {
    await page.getByRole('button', { name: /保存并完成记账|完成记账/ }).click()
    await page.waitForURL(/\/review\//)
    await page.getByRole('button', { name: /完成复盘/ }).click()
    await page.getByRole('button', { name: '查看总览趋势' }).click()
    await page.waitForURL('/')
  }
}

test.describe('设置与数据', () => {
  test('修改账本名称', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/settings')
    // 账本名称在第一个 card 的第一个 input 里
    const nameInput = page.locator('.card').filter({ hasText: '账本名称' }).locator('input').first()
    await nameInput.fill('我的新账本')
    await page.waitForTimeout(300)

    await page.reload()
    await page.waitForURL('/settings')
    const nameInput2 = page.locator('.card').filter({ hasText: '账本名称' }).locator('input').first()
    await expect(nameInput2).toHaveValue('我的新账本')

    assertNoErrors(errs)
  })

  test('隐私模式（侧边栏隐藏金额）', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/entry')
    await fillAllAccounts(page, ['10000', '500', '300'], true)

    // fillAllAccounts 已经保存并回到首页了
    await expect(page.getByText('¥10,800.00').first()).toBeVisible()

    // 点击侧边栏的"隐藏金额"
    await page.getByRole('button', { name: '隐藏金额' }).click()
    await page.waitForTimeout(300)
    
    // 按钮文字变成"显示金额"
    await expect(page.getByRole('button', { name: '显示金额' }).first()).toBeVisible()
    
    // 金额被隐藏
    await expect(page.getByText('****').first()).toBeVisible()
    await expect(page.getByText('¥10,800.00').first()).not.toBeVisible()

    // 恢复显示
    await page.getByRole('button', { name: '显示金额' }).click()
    await page.waitForTimeout(300)
    await expect(page.getByText('¥10,800.00').first()).toBeVisible()

    assertNoErrors(errs)
  })

  test('主题切换', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/settings')
    await page.getByRole('button', { name: '深色' }).click()
    await page.waitForTimeout(300)
    await expect(page.locator('html')).toHaveClass(/dark/)
    
    await page.getByRole('button', { name: '浅色' }).click()
    await page.waitForTimeout(300)
    await expect(page.locator('html')).not.toHaveClass(/dark/)

    assertNoErrors(errs)
  })

  test('涨跌配色切换', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/entry')
    await fillAllAccounts(page, ['10000', '500', '300'])
    await page.getByRole('button', { name: /完成记账/ }).click()
    await page.waitForURL(/\/review\//)
    await page.getByRole('button', { name: /完成复盘/ }).click()
    await page.getByRole('button', { name: '查看总览趋势' }).click()
    await page.waitForURL('/')

    await page.goto('/settings')
    const toggle = page.locator('.card').filter({ hasText: '涨跌配色' }).locator('button')
    await toggle.click()
    await page.waitForTimeout(300)
    
    // 切换后文字应该变化
    await expect(page.getByText('绿涨红跌（国际习惯）')).toBeVisible()

    assertNoErrors(errs)
  })

  test('导出明文 JSON 再导入', async ({ page }) => {
    const errs = collectErrors(page)
    test.setTimeout(60000)
    await onboard(page, '导出版本')

    await page.goto('/entry')
    await fillAllAccounts(page, ['50000', '2000', '1000'])

    await page.getByRole('button', { name: /完成记账/ }).click()
    await page.waitForURL(/\/review\//)
    await page.getByPlaceholder('记录一下这个月的变化').fill('导出测试')
    await page.getByRole('button', { name: /完成复盘/ }).click()
    await page.getByRole('button', { name: '查看总览趋势' }).click()
    await page.waitForURL('/')

    await page.goto('/settings')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /导出 JSON/ }).click()
    const download = await downloadPromise
    const tmpFile = path.join(os.tmpdir(), `e2e-${Date.now()}.json`)
    await download.saveAs(tmpFile)
    expect(fs.existsSync(tmpFile)).toBeTruthy()
    
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.getByRole('button', { name: /清除全部数据/ }).click()
    await page.waitForEvent('load')
    await page.waitForURL('**/onboarding')

    await page.getByRole('button', { name: '跳过' }).click()
    for (const name of ['储蓄卡', '微信零钱', '支付宝余额']) {
      await page.getByRole('button', { name }).click()
    }
    await page.getByRole('button', { name: '完成' }).click()
    await page.waitForURL('/')

    await page.goto('/settings')
    await page.locator('input[type="file"]').setInputFiles(tmpFile)
    // 等待导入模式弹窗并点击「并入」
    await expect(page.getByRole('heading', { name: '选择导入方式' })).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: /并入/ }).click()
    await expect(page.getByText(/并入完成|导入成功/)).toBeVisible({ timeout: 15000 })

    await page.goto('/')
    await expect(page.getByText('¥53,000.00').first()).toBeVisible({ timeout: 10000 })

    fs.unlinkSync(tmpFile)
    assertNoErrors(errs)
  })

  test('清空数据后跳转到引导页', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/settings')
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.getByRole('button', { name: /清除全部数据/ }).click()
    await page.waitForEvent('load')
    await page.waitForURL('**/onboarding')
    await expect(page.getByText('每月 3 分钟')).toBeVisible()

    assertNoErrors(errs)
  })
})
