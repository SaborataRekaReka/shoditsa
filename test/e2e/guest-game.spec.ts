import { expect, test, type Page } from '@playwright/test'

const searchInput = (page: Page) => page.locator('#movie-search')

const openModeLobby = async (page: Page, mode: string) => {
  await page.getByRole('button', { name: new RegExp(mode) }).first().click()
  await expect(page.getByRole('button', { name: /Начать игру|Открыть за/ })).toBeVisible()
}

const startModeGame = async (page: Page, mode: string) => {
  await openModeLobby(page, mode)
  await page.getByRole('button', { name: 'Начать игру' }).click()
  await expect(searchInput(page)).toBeVisible({ timeout: 15_000 })
}

const submitAttempt = async (page: Page, query: string) => {
  const attempts = page.locator('.attempt-card')
  const before = await attempts.count()
  await searchInput(page).fill(query)
  const result = page.locator('.suggestions button').first()
  await expect(result).toBeVisible({ timeout: 15_000 })
  await result.click()
  await expect.poll(async () => attempts.count(), { timeout: 15_000 }).toBeGreaterThan(before)
}

test('guest uses the polished server game, reloads and keeps the active session', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Все сойдется!' })).toBeVisible()
  await startModeGame(page, 'Кино')
  await page.reload()
  await expect(searchInput(page)).toBeVisible({ timeout: 15_000 })
  await submitAttempt(page, 'матрица')
  await expect(page.getByText('1/10', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.server-lobby, .server-game')).toHaveCount(0)
})

test('all six modes use the current cards and mobile layout does not overflow', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.brand img[alt="Сходится!"]')).toBeVisible()
  for (const title of ['Кино', 'Сериалы', 'Аниме', 'Игры', 'Музыка', 'Диагнозы']) {
    await expect(page.getByRole('button', { name: new RegExp(title) }).first()).toBeVisible()
  }
  await page.getByRole('button', { name: /Сериалы/ }).first().click()
  await expect(page.locator('.title-screen')).toBeVisible()
  await expect(page.locator('.server-lobby, .server-game')).toHaveCount(0)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow).toBe(false)
})

test('archive screen starts a server archive session in the polished layout', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Архив' }).first().click()
  await expect(page.getByRole('heading', { name: 'Архив' })).toBeVisible()
  await page.getByRole('button', { name: /Вчера/ }).click()
  await expect(searchInput(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.game-heading')).toContainText('Архив')
})

test('server exposes the first assist checkpoint after five attempts', async ({ page }) => {
  await page.goto('/')
  await startModeGame(page, 'Кино')
  for (const query of ['а', 'е', 'и', 'о', 'с']) {
    if (!(await searchInput(page).isVisible())) break
    await submitAttempt(page, query)
  }
  await expect(page.getByRole('button', { name: 'Подсказка' })).toBeVisible()
  await page.getByRole('button', { name: 'Подсказка' }).click()
  await expect(page.getByRole('heading', { name: 'Выберите подсказку' })).toBeVisible()
})

test('guest economy is server-backed and invalid promo errors are visible', async ({ page }) => {
  await page.goto('/')
  await openModeLobby(page, 'Кино')
  await page.locator('.period-control--custom').click()
  const freePlay = page.locator('.period-option--free-play')
  await expect(freePlay).toContainText(/Не хватает 45 билетов/)
  await expect(freePlay).toBeDisabled()
  await page.getByRole('button', { name: 'На главный экран' }).first().click()
  await page.locator('.header-economy').click()
  await expect(page.getByRole('heading', { name: 'Билеты' })).toBeVisible()
  await page.getByPlaceholder('Промокод').fill('INVALID-CODE')
  await page.getByRole('button', { name: 'Активировать' }).click()
  await expect(page.getByText(/Промокод не найден/)).toBeVisible()
})

test('profile opens the current account screen for a guest', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Профиль' }).first().click()
  await expect(page.getByRole('heading', { name: 'Гость кинозала' })).toBeVisible()
  await expect(page.getByText('Вы играете как гость. Создайте аккаунт, чтобы открыть прогресс на другом устройстве.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Подключить аккаунт' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
})
