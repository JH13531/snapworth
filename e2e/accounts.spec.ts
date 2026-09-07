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

async function resetDB(page: Page) {
  await page.goto('/about:blank')
  await page.goto('/')
  await page.waitForTimeout(500)
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    const dbs = await indexedDB.databases().catch(() => [])
    for (const db of dbs) {
      if (db.name) {
        await new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(db.name)
          req.onsuccess = () => resolve()
          req.onerror = () => resolve()
          req.onblocked = () => resolve()
        })
      }
    }
  })
  await page.waitForTimeout(300)
}

async function onboard(page: Page, bookName = '测试账本') {
  await resetDB(page)
  await page.goto('/')
  await page.waitForURL('**/onboarding')
  await page.getByRole('button', { name: '跳过' }).click()
  await page.getByRole('textbox').fill(bookName)
  await page.getByRole('button', { name: '完成' }).click()
  await page.waitForURL('/')
  await page.waitForTimeout(500)
}

function masterAccountCard(page: Page, name: string) {
  return page.locator('.flex-1.flex.flex-col .card').filter({
    has: page.locator('.font-medium').filter({ hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') })
  }).first()
}

async function openMoreMenu(page: Page, cardName: string) {
  const card = masterAccountCard(page, cardName)
  await card.locator('.lucide-ellipsis-vertical').first().click()
  await page.waitForTimeout(200)
}

test.describe('账户管理', () => {
  test('编辑主账户名称', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/accounts')
    await page.waitForTimeout(1000)

    await expect(masterAccountCard(page, '储蓄卡')).toBeVisible()

    await openMoreMenu(page, '储蓄卡')
    await page.getByRole('link', { name: /编辑/ }).first().click()
    await page.waitForURL(/\/edit$/)

    const nameInput = page.locator('.card input').first()
    await nameInput.fill('')
    await nameInput.fill('工商银行储蓄卡')
    await page.getByRole('button', { name: /保存/ }).click()
    await page.waitForURL('/accounts')

    await expect(masterAccountCard(page, '工商银行储蓄卡')).toBeVisible()
    await expect(masterAccountCard(page, '储蓄卡')).not.toBeVisible()

    assertNoErrors(errs)
  })

  test('新增负债主账户并在记账页显示', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/accounts/new')
    await page.waitForTimeout(1000)

    const nameInput = page.locator('.card input').first()
    await nameInput.fill('花呗')

    // 展开子账户行（点击 chevron-down）
    await page.locator('.lucide-chevron-down').first().click()
    await page.waitForTimeout(300)

    // 切换为负债类型
    await page.getByRole('button', { name: '负债' }).first().click()
    await page.waitForTimeout(200)

    // 保存
    await page.getByRole('button', { name: /保存/ }).last().click()
    await page.waitForURL('/accounts')

    await expect(masterAccountCard(page, '花呗')).toBeVisible()

    // 记账页能看到
    await page.goto('/entry')
    await page.waitForTimeout(1000)
    await expect(page.getByText('花呗').first()).toBeVisible()
    await expect(page.getByText('信用卡')).toBeVisible()

    const inputs = page.locator('input[placeholder="0.00"]')
    expect(await inputs.count()).toBeGreaterThanOrEqual(4)

    assertNoErrors(errs)
  })

  test('删除账户', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/accounts')
    await page.waitForTimeout(1000)

    await expect(masterAccountCard(page, '支付宝余额')).toBeVisible()

    await openMoreMenu(page, '支付宝余额')
    await page.getByRole('link', { name: /编辑/ }).first().click()
    await page.waitForURL(/\/edit$/)

    await page.getByRole('button', { name: /删除账户/ }).click()
    const modal = page.locator('.fixed').filter({ has: page.getByText(/确认删除/) })
    await modal.getByRole('textbox').fill('支付宝余额')
    await modal.getByRole('button', { name: /确认删除/ }).click()
    await page.waitForURL('/accounts')

    await expect(masterAccountCard(page, '支付宝余额')).not.toBeVisible()

    await page.goto('/entry')
    await page.waitForTimeout(1000)
    await expect(page.getByText('支付宝余额')).not.toBeVisible()

    assertNoErrors(errs)
  })

  test('账户详情页显示图表', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    // 录入一个月数据
    await page.goto('/entry')
    await page.waitForTimeout(1000)
    const inputs = page.locator('input[placeholder="0.00"]')
    const inputCount = await inputs.count()
    expect(inputCount).toBeGreaterThanOrEqual(2)

    await inputs.nth(0).fill('10000')
    if (inputCount >= 3) await inputs.nth(1).fill('500')
    if (inputCount >= 4) await inputs.nth(2).fill('300')

    await page.getByRole('button', { name: /保存并完成记账|完成记账/ }).click()
    await page.waitForURL(/\/review\//)
    await page.getByRole('button', { name: /完成复盘/ }).click()
    await page.getByRole('button', { name: /查看总览趋势/ }).click()
    await page.waitForURL('/')

    // 获取账户 ID
    await page.goto('/accounts')
    await page.waitForTimeout(1000)

    await openMoreMenu(page, '储蓄卡')
    await page.getByRole('link', { name: /编辑/ }).first().click()
    await page.waitForURL(/\/edit$/)

    const editUrl = page.url()
    const accountId = editUrl.match(/\/accounts\/([^/]+)\/edit/)?.[1]
    expect(accountId).toBeTruthy()

    // 访问详情页
    await page.goto(`/accounts/${accountId}`)
    await page.waitForTimeout(1500)

    await expect(page.getByRole('heading', { name: '储蓄卡' })).toBeVisible()
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/10,000|10000/)).toBeVisible()

    assertNoErrors(errs)
  })

  test('归档和取消归档账户', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/accounts')
    await page.waitForTimeout(1000)

    await expect(masterAccountCard(page, '储蓄卡')).toBeVisible()

    await openMoreMenu(page, '储蓄卡')
    await page.getByRole('button', { name: /归档/ }).click()
    await page.waitForTimeout(200)

    // 确认归档
    const archiveModal = page.locator('.fixed').filter({ has: page.getByText(/归档账户/) })
    await expect(archiveModal).toBeVisible()
    await archiveModal.getByRole('button', { name: /确认归档|确认/ }).last().click()
    await page.waitForTimeout(500)

    await expect(masterAccountCard(page, '储蓄卡')).not.toBeVisible()

    // 展开已归档
    await page.getByRole('button', { name: /已归档/ }).click()
    await page.waitForTimeout(200)
    await expect(page.getByText('储蓄卡')).toBeVisible()

    // 取消归档
    await page.getByRole('button', { name: /恢复|取消归档/ }).first().click()
    await page.waitForTimeout(500)

    const activeCards = page.locator('.flex-1.flex.flex-col .card')
    expect(await activeCards.count()).toBeGreaterThanOrEqual(2)
    await expect(masterAccountCard(page, '储蓄卡')).toBeVisible()

    assertNoErrors(errs)
  })

  test('展开一个账户不影响旁边的高度', async ({ page }) => {
    const errs = collectErrors(page)
    await onboard(page)

    await page.goto('/accounts')
    await page.waitForTimeout(1000)

    const cards = page.locator('.flex-1.flex.flex-col .card')
    const cardCount = await cards.count()
    expect(cardCount).toBeGreaterThanOrEqual(2)

    const h0before = await cards.nth(0).evaluate(el => el.getBoundingClientRect().height)
    const h1before = await cards.nth(1).evaluate(el => el.getBoundingClientRect().height)

    await cards.nth(0).locator('.lucide-chevron-down').first().click()
    await page.waitForTimeout(300)

    const h0after = await cards.nth(0).evaluate(el => el.getBoundingClientRect().height)
    const h1after = await cards.nth(1).evaluate(el => el.getBoundingClientRect().height)

    expect(h0after).toBeGreaterThan(h0before)
    expect(h1after).toBe(h1before)

    assertNoErrors(errs)
  })
})
