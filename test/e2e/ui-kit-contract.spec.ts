import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/client-events/batch', (route) =>
    route.fulfill({ status: 204, body: '' })
  )
  await page.addInitScript(() => {
    window.localStorage.setItem('shoditsa:analytics-consent:v1', 'rejected')
  })
  await page.goto('/ui-kit')
  await expect(page.locator('.ui-kit-screen')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
})

test('canonical controls preserve typography, geometry and focus', async ({ page }) => {
  const button = page.locator('#actions .ui-button--primary').first()
  await expect(button).toBeVisible()

  const contract = await button.evaluate((element) => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return {
      family: style.fontFamily,
      fontSize: Number.parseFloat(style.fontSize),
      fontWeight: Number.parseInt(style.fontWeight, 10),
      letterSpacing: Number.parseFloat(style.letterSpacing),
      textTransform: style.textTransform,
      height: rect.height,
    }
  })

  expect(contract.family.toLowerCase()).toContain('manrope')
  expect(contract.fontSize).toBe(12)
  expect(contract.fontWeight).toBe(700)
  expect(contract.letterSpacing).toBeGreaterThanOrEqual(0.8)
  expect(contract.textTransform).toBe('uppercase')
  expect(contract.height).toBeGreaterThanOrEqual(48)

  const heights = await page.locator('#actions .ui-button').evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height)
  )
  expect(heights.length).toBeGreaterThanOrEqual(5)
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(48)

  await button.focus()
  await expect(button).toBeFocused()
  const focus = await button.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      offset: Number.parseFloat(style.outlineOffset),
    }
  })
  expect(focus.style).not.toBe('none')
  expect(focus.width).toBeGreaterThanOrEqual(3)
  expect(focus.offset).toBeGreaterThanOrEqual(3)
})

test('the living UI kit exposes every shared primitive', async ({ page }) => {
  const sharedPrimitives = [
    '.ui-button',
    '.ui-icon-button',
    '.ui-text-button',
    '.ui-search-combobox',
    '.ui-input',
    '.ui-textarea',
    '.ui-select',
    '.admit-ticket',
    '.ui-alert',
    '.ui-status',
    '.ui-tabs',
    '.ui-segmented-progress',
    '.ui-linear-progress',
    '.ui-empty-state',
  ]

  for (const selector of sharedPrimitives) {
    await expect(page.locator(selector).first(), selector).toBeVisible()
  }
})

test('key UI-kit specimens keep their visual contract', async ({ page }) => {
  await expect(page.locator('#actions')).toHaveScreenshot('ui-kit-actions.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
  await page.locator('#controls .game-option-select > .game-option-trigger').click()
  await expect(page.locator('#controls .game-option-menu')).toHaveScreenshot('ui-kit-option-menu.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
  await expect(page.locator('#tickets')).toHaveScreenshot('ui-kit-tickets.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})
