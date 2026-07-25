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
    '.result-after-actions',
    '.dtf-leaderboard',
  ]

  for (const selector of sharedPrimitives) {
    await expect(page.locator(selector).first(), selector).toBeVisible()
  }
})

test('shared interactive targets and field surfaces keep their component contract', async ({ page }) => {
  const targets = page.locator('#actions :is(.ui-button, .ui-icon-button), #feedback .ui-tabs > button')
  for (let index = 0; index < await targets.count(); index += 1) {
    const box = await targets.nth(index).boundingBox()
    expect(box?.height ?? 0, `target ${index}`).toBeGreaterThanOrEqual(44)
  }

  for (const selector of ['.ui-input--paper', '.ui-textarea--paper', '.ui-select--paper']) {
    const control = page.locator(`#forms ${selector}`).first()
    await expect(control).toBeVisible()
    const contract = await control.evaluate((element) => {
      const style = getComputedStyle(element)
      return { height: element.getBoundingClientRect().height, background: style.backgroundColor, border: style.borderStyle }
    })
    expect(contract.height).toBeGreaterThanOrEqual(44)
    expect(contract.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(contract.border).not.toBe('none')
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
  await expect(page.locator('#result-actions')).toHaveScreenshot('ui-kit-result-actions-desktop.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
  await expect(page.locator('#leaderboard')).toHaveScreenshot('ui-kit-leaderboard-desktop.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})

test('result actions and leaderboard retain their mobile composition', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#result-actions').scrollIntoViewIfNeeded()
  await expect(page.locator('#result-actions')).toHaveScreenshot('ui-kit-result-actions-mobile.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
  await page.locator('#leaderboard').scrollIntoViewIfNeeded()
  await expect(page.locator('#leaderboard')).toHaveScreenshot('ui-kit-leaderboard-mobile.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})

test('next game remains a compact card on tablet', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  const section = page.locator('#result-actions')
  const specimen = section.locator('.ui-kit-result-action')
  const card = specimen.locator('.result-primary-actions')
  await section.scrollIntoViewIfNeeded()

  const contract = await card.evaluate((element) => {
    const specimenElement = element.closest<HTMLElement>('.ui-kit-result-action')!
    const nextButton = element.querySelector<HTMLElement>('.result-next')!
    return {
      cardWidth: element.getBoundingClientRect().width,
      specimenWidth: specimenElement.getBoundingClientRect().width,
      nextHeight: nextButton.getBoundingClientRect().height,
      gridColumn: getComputedStyle(element).gridColumn,
    }
  })

  expect(contract.cardWidth).toBeLessThan(contract.specimenWidth * 0.8)
  expect(contract.nextHeight).toBeLessThanOrEqual(112)
  expect(contract.gridColumn).not.toContain('-1')
})

test('final choice keeps a compact draggable mobile carousel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const section = page.locator('#final-choice')
  const grid = section.locator('.final-choice-grid')
  const cards = grid.locator('.final-choice-card')
  await section.scrollIntoViewIfNeeded()

  const contract = await grid.evaluate((element) => {
    const card = element.querySelector<HTMLElement>('.final-choice-card')!
    const poster = element.querySelector<HTMLElement>('.final-choice-card__poster')!
    const style = getComputedStyle(element)
    return {
      cardCount: element.querySelectorAll('.final-choice-card').length,
      cardWidth: card.getBoundingClientRect().width,
      posterHeight: poster.getBoundingClientRect().height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: style.overflowX,
      snap: style.scrollSnapType,
    }
  })
  expect(contract.cardCount).toBe(4)
  expect(contract.cardWidth).toBeLessThan(contract.clientWidth)
  expect(contract.posterHeight).toBeLessThanOrEqual(70)
  expect(contract.scrollWidth).toBeGreaterThan(contract.clientWidth)
  expect(contract.overflowX).toBe('auto')
  expect(contract.snap).toContain('mandatory')
  await expect(section.locator('.final-choice-card__check')).toHaveCount(0)
  await expect(section.locator('.final-choice-panel__timer')).toHaveText('00:10')

  const firstCard = cards.first()
  await firstCard.hover()
  expect(await firstCard.evaluate((element) => getComputedStyle(element).transform)).toBe('none')

  const secondCard = cards.nth(1)
  await secondCard.click()
  await expect(secondCard).toHaveAttribute('aria-checked', 'true')
  await firstCard.click()
  await expect(firstCard).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => grid.evaluate((element) => element.scrollLeft)).toBe(0)

  const selectedBefore = await grid.locator('[role="radio"][aria-checked="true"]').getAttribute('aria-label')
  const box = await grid.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width * .78, box!.y + box!.height * .5)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * .2, box!.y + box!.height * .5, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => grid.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  expect(await grid.locator('[role="radio"][aria-checked="true"]').getAttribute('aria-label')).toBe(selectedBefore)
})

test('anchored option menu stays below the section heading on a short desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const controls = page.locator('#controls')
  await controls.scrollIntoViewIfNeeded()
  const trigger = controls.locator('.game-option-trigger').first()
  await trigger.click()
  const menu = controls.locator('.game-option-menu')
  await expect(menu).toBeVisible()

  const geometry = await page.evaluate(() => {
    const heading = document.querySelector('#controls .ui-kit-section__head')!.getBoundingClientRect()
    const menu = document.querySelector('#controls .game-option-menu')!.getBoundingClientRect()
    return { headingBottom: heading.bottom, menuTop: menu.top, menuBottom: menu.bottom, viewportHeight: innerHeight }
  })
  expect(geometry.menuTop).toBeGreaterThanOrEqual(geometry.headingBottom)
  expect(geometry.menuBottom).toBeLessThanOrEqual(geometry.viewportHeight - 10)
  await expect(menu).toHaveScreenshot('ui-kit-option-menu-short-desktop.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})
