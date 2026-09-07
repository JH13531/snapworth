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

test.describe('Snapworth 完整流程', () => {
  test('引导→记账→复盘→分析→新增账户→加密备份导出→清空→恢复码导入恢复', async ({ page }) => {
    test.setTimeout(120000)
    const errs = collectErrors(page)

    // ---------- 0. 确保干净状态（清理可能残留的 IndexedDB） ----------
    await page.goto('/')
    await page.evaluate(async () => {
      // 清除所有可能影响 onboarding 判断的存储
      localStorage.clear()
      sessionStorage.clear()
      // 异步删除 IndexedDB
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('snapworth')
        req.onsuccess = () => resolve()
        req.onerror = () => resolve()
        req.onblocked = () => resolve()
      })
    })
    await page.waitForTimeout(100)

    // ---------- 1. 引导页 ----------
    await page.goto('/')
    await page.waitForURL('**/onboarding')
    await page.getByRole('button', { name: '下一步' }).click()
    await page.getByRole('button', { name: '下一步' }).click()
    await page.getByRole('button', { name: '开始设置' }).click()

    // 默认选中 储蓄卡/微信零钱/支付宝余额，不应选中 信用卡
    await expect(page.getByRole('button', { name: '储蓄卡' })).toHaveClass(/brand-500/)
    await expect(page.getByRole('button', { name: '微信零钱' })).toHaveClass(/brand-500/)
    await expect(page.getByRole('button', { name: '支付宝余额' })).toHaveClass(/brand-500/)
    await expect(page.getByRole('button', { name: '信用卡' })).not.toHaveClass(/brand-500/)

    await page.getByRole('textbox').fill('E2E测试账本')
    await page.getByRole('button', { name: '完成' }).click()

    await page.waitForURL('/')
    await expect(page.getByText('每月 3 分钟，看清资产全貌')).toBeVisible()

    // ---------- 2. 记账：空输入框不白屏 ----------
    await page.getByRole('link', { name: '记账', exact: true }).click()
    await page.waitForURL('**/entry')

    const inputs = page.locator('input[placeholder="0.00"]')
    await expect(inputs).toHaveCount(3)

    // 先输入再清空，验证空字符串不会导致 Decimal 崩溃白屏
    await inputs.nth(0).fill('100')
    await inputs.nth(0).fill('')
    await page.getByText('本月净资产').click()
    await expect(page.getByText('本月净资产')).toBeVisible()
    await expect(page.getByText(/进度\s*0\/3/)).toBeVisible()

    // 正常填入三个账户
    await inputs.nth(0).fill('10000')
    await inputs.nth(1).fill('500')
    await inputs.nth(2).fill('300')
    await page.getByText('本月净资产').click()
    await expect(page.getByText(/进度\s*3\/3/)).toBeVisible()

    // 切换到上月（无数据）不应崩溃
    await page.locator('div.sticky button').first().click()
    await expect(page.getByText(/暂无对比/)).toBeVisible()
    await page.goBack()

    // ---------- 3. 完成复盘 ----------
    await page.getByRole('button', { name: /完成记账/ }).click()
    await page.waitForURL(/\/review\//)
    await expect(page.getByText('¥10,800.00').first()).toBeVisible()

    await page.getByPlaceholder('记录一下这个月的变化').fill('第一次复盘，资产稳步积累。')
    await page.getByRole('button', { name: '工资', exact: true }).click()
    await page.getByRole('button', { name: '标签' }).click()
    const tagInput = page.getByPlaceholder('标签名')
    await tagInput.fill('测试标签')
    await tagInput.press('Enter')
    await expect(page.getByRole('button', { name: '测试标签' })).toHaveClass(/bg-brand-600/)

    await page.getByRole('button', { name: /完成复盘/ }).click()
    await expect(page.getByText('复盘完成')).toBeVisible()
    await page.getByRole('button', { name: '查看总览趋势' }).click()
    await page.waitForURL('/')

    // ---------- 4. 首页数据 ----------
    await expect(page.getByText('¥10,800.00').first()).toBeVisible()
    await expect(page.getByText('本月记账未完成')).not.toBeVisible()
    await expect(page.getByText('净资产趋势')).toBeVisible()

    // ---------- 5. 分析页：复盘记录与标签筛选 ----------
    await page.getByRole('link', { name: '分析', exact: true }).click()
    await expect(page.getByText('复盘记录')).toBeVisible()
    await expect(page.getByText('第一次复盘，资产稳步积累。')).toBeVisible()
    await expect(page.getByRole('button', { name: '测试标签' }).first()).toBeVisible()
    await expect(page.getByText('环比变动排行')).toBeVisible()

    await page.getByRole('button', { name: '工资' }).first().click()
    await expect(page.getByText('第一次复盘，资产稳步积累。')).toBeVisible()
    await page.getByRole('button', { name: '清除' }).click()

    // ---------- 6. 新增账户（sort_order max+1） ----------
    await page.goto('/accounts/new')
    await page.getByPlaceholder('账户名称，如：中国银行储蓄卡').fill('股票账户')
    await page.locator('select').first().selectOption('investment')
    await page.getByRole('button', { name: '保存' }).click()
    await page.waitForURL('/accounts')

    // 回到记账，填入新账户余额并保存
    await page.goto('/entry')
    const inputs2 = page.locator('input[placeholder="0.00"]')
    await expect(inputs2).toHaveCount(4)
    await inputs2.nth(3).fill('50000')
    await page.getByText('本月净资产').click()
    await expect(page.getByText('¥60,800.00').first()).toBeVisible()
    await page.getByRole('button', { name: /保存并完成记账|完成记账/ }).click()
    await page.waitForURL(/\/review\//)
    await page.getByRole('button', { name: /完成复盘/ }).click()
    await expect(page.getByText('复盘完成')).toBeVisible()
    await page.getByRole('button', { name: '查看总览趋势' }).click()
    await page.waitForURL('/')

    // ---------- 7. 设置：导出加密备份 ----------
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: /导出加密备份/ }).click()
    const pwInputs = page.locator('.fixed input[type="password"]')
    await pwInputs.nth(0).fill('test1234')
    await pwInputs.nth(1).fill('test1234')
    await page.getByRole('button', { name: /生成加密备份/ }).click()

    // 获取恢复码
    const recoveryCodeEl = page.locator('.fixed .font-mono').first()
    await expect(recoveryCodeEl).toBeVisible({ timeout: 30000 })
    const recoveryCode = await recoveryCodeEl.innerText()
    expect(recoveryCode).toMatch(/^\d{5}-\d{5}-\d{5}-\d{5}-\d{5}-\d{5}$/)

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载 .snapvault 备份文件' }).click()
    const download = await downloadPromise
    const tmpFile = path.join(os.tmpdir(), `e2e-${Date.now()}.snapvault`)
    await download.saveAs(tmpFile)
    expect(fs.existsSync(tmpFile)).toBeTruthy()

    await page.locator('.fixed input[type="checkbox"]').click()
    await page.getByRole('button', { name: '完成', exact: true }).click()

    // ---------- 8. 清空数据 ----------
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.getByRole('button', { name: /清除全部数据/ }).click()
    await page.waitForEvent('load')
    await page.waitForURL('**/onboarding')

    // 快速重建一个空账本（跳过介绍 → 取消所有预设 → 完成）
    await page.getByRole('button', { name: '跳过' }).click()
    for (const name of ['储蓄卡', '微信零钱', '支付宝余额']) {
      await page.getByRole('button', { name }).click()
    }
    await page.getByRole('button', { name: '完成' }).click()
    await page.waitForURL('/')

    // ---------- 9. 用恢复码导入恢复 ----------
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.locator('input[type="file"]').setInputFiles(tmpFile)

    await expect(page.getByText('解密备份')).toBeVisible()
    await page.locator('.fixed').getByRole('button', { name: '恢复码', exact: true }).click()
    await page.getByPlaceholder(/XXXXX/).fill(recoveryCode)
    await page.getByRole('button', { name: /解密并导入/ }).click()

    // 等待导入模式弹窗并点击「并入」
    await expect(page.getByRole('heading', { name: '选择导入方式' })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: /并入/ }).click()
    await expect(page.getByText(/并入完成/)).toBeVisible({ timeout: 30000 })

    // ---------- 10. 验证数据恢复 ----------
    await page.goto('/')
    await expect(page.getByText('¥60,800.00').first()).toBeVisible({ timeout: 15000 })

    await page.getByRole('link', { name: '分析', exact: true }).click()
    await expect(page.getByText('第一次复盘，资产稳步积累。')).toBeVisible()

    fs.unlinkSync(tmpFile)
    assertNoErrors(errs)
  })
})
