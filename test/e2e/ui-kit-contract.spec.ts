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

test('connections result keeps all category names readable across breakpoints', async ({ page }) => {
  const result = page.locator('.ui-kit-connections-result .connections-result')
  const groups = result.locator('.connections-result__group')
  await result.scrollIntoViewIfNeeded()

  await expect(result.locator('.connections-result__groups')).toBeVisible()
  await expect(groups).toHaveCount(4)
  for (const title of ['Оканчиваются на «-ай»', 'Можно открыть ключом', 'Виды волн', 'Скрытая связь']) {
    await expect(groups.getByText(title, { exact: true })).toBeVisible()
  }

  const desktopColumns = await result.locator('.connections-result__groups-grid').evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  ))
  expect(desktopColumns).toBe(2)
  const desktopActionContract = await result.evaluate((element) => {
    const primary = element.querySelector<HTMLElement>('.result-primary-actions')!
    const next = element.querySelector<HTMLElement>('.result-next')!
    const actions = element.querySelector<HTMLElement>('.result-after-actions')!
    return {
      nextFillsCard: next.getBoundingClientRect().height >= primary.getBoundingClientRect().height - 2,
      actionColumns: getComputedStyle(actions).gridTemplateColumns.split(' ').length,
    }
  })
  expect(desktopActionContract).toEqual({ nextFillsCard: true, actionColumns: 2 })

  await page.setViewportSize({ width: 390, height: 844 })
  await result.scrollIntoViewIfNeeded()
  const mobileContract = await result.evaluate((element) => {
    const grid = element.querySelector<HTMLElement>('.connections-result__groups-grid')!
    const cards = [...element.querySelectorAll<HTMLElement>('.connections-result__group')]
    const primary = element.querySelector<HTMLElement>('.result-primary-actions')!
    const next = element.querySelector<HTMLElement>('.result-next')!
    const actions = element.querySelector<HTMLElement>('.result-after-actions')!
    const moreToggle = element.querySelector<HTMLElement>('.result-more-toggle')!
    const nextActionLabel = element.querySelector<HTMLElement>('.result-next__arrow > span')!
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      cardsFit: cards.every((card) => card.scrollWidth === card.clientWidth && card.scrollHeight === card.clientHeight),
      nextFillsCard: next.getBoundingClientRect().height >= primary.getBoundingClientRect().height - 2,
      actionColumns: getComputedStyle(actions).gridTemplateColumns.split(' ').length,
      actionsVisible: getComputedStyle(actions).display === 'grid' && getComputedStyle(moreToggle).display === 'none',
      nextActionVisible: getComputedStyle(nextActionLabel).display !== 'none' && nextActionLabel.getBoundingClientRect().width > 0,
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
    }
  })
  expect(mobileContract).toEqual({
    columns: 1,
    cardsFit: true,
    nextFillsCard: true,
    actionColumns: 1,
    actionsVisible: true,
    nextActionVisible: true,
    pageFits: true,
  })
})

test('standard game result keeps one dominant next step and ordered supporting levels', async ({ page }) => {
  await page.setViewportSize({ width: 999, height: 792 })
  const result = page.locator('#result-actions .result-card')
  await result.scrollIntoViewIfNeeded()

  const contract = await result.evaluate((element) => {
    const top = (selector: string) => element.querySelector<HTMLElement>(selector)!.getBoundingClientRect().top
    const primary = element.querySelector<HTMLElement>('.result-primary-actions')!
    return {
      hierarchy: [
        top('.result-card__hero'),
        top('.result-rewards'),
        top('.result-primary-actions'),
        top('.result-persistence'),
        top('.result-secondary-actions'),
        top('.reward-breakdown'),
      ],
      actionTops: [
        top('.result-replay'),
        top('.result-config'),
        top('.result-challenge'),
      ],
      primaryWidth: primary.getBoundingClientRect().width,
      resultWidth: element.getBoundingClientRect().width,
      copyActions: element.querySelectorAll('.result-copy').length,
      tipActions: element.querySelectorAll('.result-tip, .result-support').length,
      overflow: element.scrollWidth - element.clientWidth,
    }
  })

  expect(contract.hierarchy).toEqual([...contract.hierarchy].sort((left, right) => left - right))
  expect(Math.max(...contract.actionTops) - Math.min(...contract.actionTops)).toBeLessThan(1)
  expect(contract.primaryWidth).toBeGreaterThan(contract.resultWidth * 0.9)
  expect(contract.copyActions).toBe(0)
  expect(contract.tipActions).toBe(0)
  expect(contract.overflow).toBeLessThanOrEqual(0)
  await expect(result.locator('.result-next__arrow')).toContainText('Играть')
  await expect(result.locator('.result-copy-status')).toHaveAttribute('aria-live', 'polite')

  const refinement = await result.evaluate((element) => {
    const verdict = element.querySelector<HTMLElement>('.result-verdict')!
    const rewardValues = [...element.querySelectorAll<HTMLElement>('.result-rewards article strong')]
    const next = element.querySelector<HTMLElement>('.result-next')!
    const save = element.querySelector<HTMLElement>('.result-persistence > a')!
    const ticketReward = element.querySelector<HTMLElement>('.result-reward--tickets')!
    const routeReward = element.querySelector<HTMLElement>('.result-reward--route')!
    return {
      verdictText: verdict.textContent?.trim(),
      verdictBackground: getComputedStyle(verdict).backgroundColor,
      verdictRadius: Number.parseFloat(getComputedStyle(verdict).borderRadius),
      rewardSizes: rewardValues.map((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
      ticketBackground: getComputedStyle(ticketReward).backgroundColor,
      routeBackground: getComputedStyle(routeReward).backgroundColor,
      routeSegments: element.querySelectorAll('.result-route-track > b').length,
      completedSegments: element.querySelectorAll('.result-route-track > .is-complete').length,
      nextBackground: getComputedStyle(next).backgroundColor,
      saveBackground: getComputedStyle(save).backgroundColor,
      saveCopy: element.querySelector<HTMLElement>('.result-persistence__copy')?.innerText,
    }
  })
  expect(refinement.verdictText).toBe('Победа')
  expect(refinement.verdictBackground).not.toBe('rgba(0, 0, 0, 0)')
  expect(refinement.verdictRadius).toBeGreaterThanOrEqual(6)
  expect(refinement.rewardSizes[0]).toBeGreaterThan(Math.max(...refinement.rewardSizes.slice(1)))
  expect(refinement.ticketBackground).not.toBe(refinement.routeBackground)
  expect(refinement.routeSegments).toBe(10)
  expect(refinement.completedSegments).toBe(4)
  expect(refinement.saveBackground).not.toBe(refinement.nextBackground)
  expect(refinement.saveCopy).toContain('Сохраните победу и прогресс')
  expect(refinement.saveCopy).not.toContain('Не потеряйте')
})

test('next game remains the dominant full-width card on tablet', async ({ page }) => {
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

  expect(contract.cardWidth).toBeGreaterThan(contract.specimenWidth * 0.9)
  expect(contract.nextHeight).toBeGreaterThanOrEqual(88)
  expect(contract.nextHeight).toBeLessThanOrEqual(104)
  expect(contract.gridColumn).toContain('-1')
})

test('mobile result collapses direct secondary actions without hiding the next game', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const result = page.locator('#result-actions .result-card')
  await result.scrollIntoViewIfNeeded()

  await expect(result.locator('.result-next')).toBeVisible()
  await expect(result.locator('.result-persistence')).toBeVisible()
  const actionLabel = result.locator('.result-next__arrow > span')
  await expect(actionLabel).toBeVisible()
  await expect(actionLabel).toHaveText('Играть')
  const nextActionFit = await result.locator('.result-next').evaluate((button) => {
    const copy = button.querySelector<HTMLElement>('.result-next__copy')!.getBoundingClientRect()
    const action = button.querySelector<HTMLElement>('.result-next__arrow')!.getBoundingClientRect()
    return {
      noOverlap: copy.right <= action.left - 6,
      actionHeight: action.height,
    }
  })
  expect(nextActionFit.noOverlap).toBe(true)
  expect(nextActionFit.actionHeight).toBeGreaterThanOrEqual(40)
  const rewardLabelsFit = await result.locator('.result-rewards article small').evaluateAll((labels) => (
    labels.every((label) => label.scrollWidth <= label.clientWidth && label.scrollHeight <= label.parentElement!.clientHeight)
  ))
  expect(rewardLabelsFit).toBe(true)
  const adaptiveRewardColumns = await result.locator('.result-rewards').evaluate((rail) => {
    const columns = () => getComputedStyle(rail).gridTemplateColumns.split(' ').length
    rail.classList.replace('result-rewards--3', 'result-rewards--2')
    const two = columns()
    rail.classList.replace('result-rewards--2', 'result-rewards--1')
    const one = columns()
    rail.classList.replace('result-rewards--1', 'result-rewards--3')
    return { two, one }
  })
  expect(adaptiveRewardColumns).toEqual({ two: 2, one: 1 })
  await expect(result.locator('.result-more-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(result.locator('.result-replay')).toBeHidden()

  await result.locator('.result-more-toggle').click()
  await expect(result.locator('.result-more-toggle')).toHaveAttribute('aria-expanded', 'true')
  await expect(result.locator('.result-replay')).toBeVisible()
  await expect(result.getByRole('button', { name: 'Настроить игру Период / свободная игра' })).toBeVisible()
  await expect(result.getByRole('button', { name: 'Бросить вызов другу' })).toBeVisible()

  await page.setViewportSize({ width: 320, height: 844 })
  await result.locator('.result-next__copy strong').evaluate((title) => { title.textContent = 'Угадай исполнителя' })
  const narrowNextFit = await result.locator('.result-next').evaluate((button) => {
    const copy = button.querySelector<HTMLElement>('.result-next__copy')!.getBoundingClientRect()
    const action = button.querySelector<HTMLElement>('.result-next__arrow')!.getBoundingClientRect()
    return {
      noOverlap: copy.right <= action.left - 6,
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
      labelVisible: button.querySelector<HTMLElement>('.result-next__arrow > span')!.getBoundingClientRect().width > 0,
    }
  })
  expect(narrowNextFit).toEqual({ noOverlap: true, pageFits: true, labelVisible: true })
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
