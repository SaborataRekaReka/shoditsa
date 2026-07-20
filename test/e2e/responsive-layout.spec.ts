import { expect, test, type Locator, type Page } from '@playwright/test'

const gameModes = ['movie', 'series', 'anime', 'game', 'city', 'music', 'diagnosis'] as const

async function expectNoPageOverflow(page: Page, screen: string) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  expect(metrics.scrollWidth - metrics.clientWidth, `${screen}: document overflow`).toBeLessThanOrEqual(1)
  expect(metrics.bodyWidth - metrics.clientWidth, `${screen}: body overflow`).toBeLessThanOrEqual(1)
}

async function expectInsideViewport(locator: Locator, label: string) {
  const bounds = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, width: innerWidth }
  })
  expect(bounds.left, `${label}: left edge`).toBeGreaterThanOrEqual(-1)
  expect(bounds.right, `${label}: right edge`).toBeLessThanOrEqual(bounds.width + 1)
}

test('critical screens and all themed lobbies stay inside the viewport', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.hub-hero')).toBeVisible()
  await expectNoPageOverflow(page, 'home')
  await expectInsideViewport(page.locator('.hub-hero__copy'), 'home copy')
  await expectInsideViewport(page.locator('.hub-hero__actions').first(), 'home actions')

  for (const mode of gameModes) {
    await page.goto(`/games/${mode}`)
    await expect(page.locator('.title-screen')).toBeVisible()
    await expectNoPageOverflow(page, `${mode} lobby`)
    await expectInsideViewport(page.locator('.title-screen').locator(':is(.admit-ticket, .concert-ticket, .med-chart)').first(), `${mode} artifact`)
  }

  for (const route of ['/archive', '/profile', '/login']) {
    await page.goto(route)
    await expect(page.locator('main')).toBeVisible()
    await expectNoPageOverflow(page, route)
  }
})

test('mobile controls remain tappable and inputs do not trigger iOS zoom', async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width > 430, 'Touch audit is scoped to phone viewports')
  await page.goto('/')

  const controls = page.locator('.app-header button:visible, .hub-hero__actions a:visible')
  for (let index = 0; index < await controls.count(); index += 1) {
    const box = await controls.nth(index).boundingBox()
    expect(box?.width ?? 0, `control ${index} width`).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0, `control ${index} height`).toBeGreaterThanOrEqual(44)
  }

  await page.goto('/games/movie')
  const start = page.locator('.game-launch-controls button').last()
  await expect(start).toBeVisible()
  await expect((await start.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

  await page.goto('/login')
  const inputs = page.locator('input:visible')
  for (let index = 0; index < await inputs.count(); index += 1) {
    const fontSize = await inputs.nth(index).evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    expect(fontSize, `input ${index} font size`).toBeGreaterThanOrEqual(16)
  }
})

test('dialog traps focus, closes with Escape, and returns focus', async ({ page }) => {
  await page.goto('/')
  const trigger = page.locator('.header-profile')
  await trigger.click()
  await page.locator('.header-profile-dropdown__economy').click()
  const dialog = page.getByRole('dialog', { name: 'Билеты' })
  await expect(dialog).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)

  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('login has stable visual layout', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('.login-card')).toBeVisible()
  await expect(page).toHaveScreenshot('login-responsive.png', {
    fullPage: true,
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})
