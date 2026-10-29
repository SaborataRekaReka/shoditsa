import { expect, test, type Locator } from '@playwright/test'

const widths = [320, 390, 768, 1092, 1440]
const modes = ['movie', 'series', 'anime', 'game', 'city', 'music', 'diagnosis', 'animal', 'book', 'character', 'connections', 'danetki', 'word']

async function expectActionFits(button: Locator, context: string) {
  const geometry = await button.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const textNodes: Node[] = []
    while (walker.nextNode()) if (walker.currentNode.textContent?.trim() && !walker.currentNode.parentElement?.closest('[aria-hidden="true"], svg')) textNodes.push(walker.currentNode)
    const textRects = textNodes.flatMap(node => {
      const range = document.createRange()
      range.selectNodeContents(node)
      return Array.from(range.getClientRects(), rect => ({ top: rect.top, left: rect.left, right: rect.right }))
    })
    return {
      label: element.textContent?.trim(),
      lines: new Set(textRects.map(rect => Math.round(rect.top))).size,
      clipped: element.scrollWidth > element.clientWidth + 1,
      textInside: textRects.every(rect => rect.left >= bounds.left + parseFloat(style.paddingLeft) - 1 && rect.right <= bounds.right - parseFloat(style.paddingRight) + 1),
      icons: Array.from(element.querySelectorAll('svg')).filter(icon => icon.getBoundingClientRect().width > 0 && icon.getBoundingClientRect().height > 0).map(icon => {
        const rect = icon.getBoundingClientRect()
        return { inside: rect.left >= bounds.left && rect.right <= bounds.right, width: rect.width, height: rect.height }
      }),
      parentContains: bounds.left >= element.parentElement!.getBoundingClientRect().left - 1 && bounds.right <= element.parentElement!.getBoundingClientRect().right + 1,
    }
  })
  expect(geometry.lines, `${context}: ${geometry.label}`).toBe(1)
  expect(geometry.clipped, `${context}: clipped label`).toBe(false)
  expect(geometry.textInside, `${context}: text outside padding`).toBe(true)
  expect(geometry.parentContains, `${context}: button outside container`).toBe(true)
  for (const icon of geometry.icons) {
    expect(icon.inside, `${context}: icon outside button`).toBe(true)
    expect(icon.width, `${context}: compressed icon`).toBeGreaterThanOrEqual(16)
    expect(Math.abs(icon.width - icon.height), `${context}: distorted icon`).toBeLessThanOrEqual(1)
  }
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('shoditsa:analytics-consent:v1', 'rejected'))
  await request.post('/api/v1/auth/guest')
  await page.context().addCookies((await request.storageState()).cookies)
})

for (const tone of ['light', 'dark']) {
  test(`all game launch buttons keep labels and icons intact, ${tone}`, async ({ page }) => {
    test.setTimeout(120_000)
    for (const mode of modes) {
      await page.goto(`/games/${mode}?tone=${tone}`)
      const button = page.locator('.qt-hero-launch .quest-button--primary').first()
      await expect(button, `${mode} launch`).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 })
        await expectActionFits(button, `${mode}, ${tone}, ${width}px`)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${mode}, ${tone}, ${width}px: page overflow`).toBe(true)
      }
    }
  })
}

test('word loading label also fits the launch button', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/v1/games/start', async route => { await gate; await route.abort() })
  try {
    await page.goto('/games/word')
    await expect(page.locator('#qt-start')).toBeEnabled()
    await page.locator('#qt-start').click()
    await expect(page.locator('#qt-start')).toHaveText('Открываем загадку…')
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 })
      await expectActionFits(page.locator('#qt-start'), `word loading, ${width}px`)
    }
  } finally { release() }
})

test('shared action controls fit long real labels on narrow screens', async ({ page }) => {
  await page.goto('/ui-kit')
  await expect(page.locator('#action-labels')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 })
    for (const button of await page.locator('#action-labels .quest-button, #actions .ui-button').all()) {
      await expectActionFits(button, `shared action, ${width}px`)
    }
  }
})
