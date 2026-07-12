import { expect, test, type Page } from '@playwright/test'

const searchInput = (page: Page) => page.getByPlaceholder('Введите название…')

const openModeLobby = async (page: Page, mode: string) => {
  await page.getByRole('button', { name: new RegExp(mode) }).click()
  await expect(page.getByRole('button', { name: /Начать игру|Разблокировать за 25/ })).toBeVisible()
}

const startModeGame = async (page: Page, mode: string) => {
  await openModeLobby(page, mode)
  await page.getByRole('button', { name: 'Начать игру' }).click()
  await expect(searchInput(page)).toBeVisible()
}

const submitAttempt = async (page: Page, query: string) => {
  const attempts = page.locator('.attempt-card')
  const before = await attempts.count()

  await searchInput(page).fill(query)
  const result = page.locator('.server-results button').first()
  await expect(result).toBeVisible({ timeout: 15_000 })
  await result.click()

  await expect.poll(async () => attempts.count(), { timeout: 15_000 }).toBeGreaterThan(before)
}

const makeAttempts = async (page: Page, target: number, startIndex = 0) => {
  const queries = ['а', 'е', 'и', 'о', 'с', 'р', 'н', 'т', 'л', 'к']
  for (let index = 0; index < target; index += 1) {
    await submitAttempt(page, queries[(startIndex + index) % queries.length])
    await expect(searchInput(page)).toBeVisible()
  }
}

test('guest starts a server game, reloads and submits a confirmed attempt', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Все сойдется!' })).toBeVisible()
  await expect(page.getByText('1246', { exact: true })).toBeVisible()
  await startModeGame(page, 'Кино')
  await page.reload()
  await expect(searchInput(page)).toBeVisible()
  await searchInput(page).fill('матрица')
  const result = page.locator('.server-results button').first()
  await expect(result).toBeVisible()
  await result.click()
  await expect(page.getByText('Попытка 1')).toBeVisible()
  await expect(page.getByText('1/10')).toBeVisible()
})

test('all six server modes are visible and mobile layout does not overflow', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.brand img[alt="Сходится!"]')).toBeVisible()
  for (const title of ['Кино', 'Сериалы', 'Аниме', 'Игры', 'Музыка', 'Диагнозы']) await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible()

  await page.getByRole('button', { name: /Сериалы/ }).click()
  await expect(page.locator('.server-lobby h1')).toHaveCSS('color', 'rgb(23, 26, 23)')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow).toBe(false)
})

test('archive modal starts an archive session for selected date', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Архив' }).click()

  const dateInput = page.locator('.server-archive-start input[type="date"]')
  await expect(dateInput).toBeVisible()
  const maxDate = await dateInput.getAttribute('max')
  expect(maxDate).toBeTruthy()
  await dateInput.fill(maxDate!)

  await page.locator('.server-archive-start select').selectOption('movie')
  await page.getByRole('button', { name: 'Открыть день' }).click()
  await expect(searchInput(page)).toBeVisible()
})

test('assist hints can be opened on rounds 5 and 8', async ({ page }) => {
  await page.goto('/')
  await startModeGame(page, 'Кино')

  await makeAttempts(page, 5, 0)
  const assist = page.locator('.server-assist')
  await expect(assist).toBeVisible()
  await assist.getByRole('button', { name: 'Открыть' }).click()
  await expect(page.getByText('Подсказка после 5 попыток')).toBeVisible()

  await makeAttempts(page, 3, 5)
  await assist.getByRole('button', { name: 'Открыть' }).click()
  await expect(page.getByText('Подсказка после 8 попыток')).toBeVisible()
})

test('guest economy flow shows expected errors for free play and promo', async ({ page }) => {
  await page.goto('/')
  await openModeLobby(page, 'Кино')

  await page.getByRole('button', { name: 'Свободная игра' }).click()
  await expect(page.getByText('Недостаточно билетов')).toBeVisible()

  await page.getByRole('button', { name: 'Все игры' }).click()
  await page.locator('.header-economy').click()
  await expect(page.getByRole('heading', { name: 'Билеты' })).toBeVisible()

  await page.getByPlaceholder('Промокод').fill('INVALID-CODE')
  await page.getByRole('button', { name: 'Активировать' }).click()
  await expect(page.getByText('Промокод не найден')).toBeVisible()

  await page.locator('.modal header button').first().click()
  await page.getByRole('button', { name: 'Профиль' }).click()
  await expect(page.getByText('Вы играете как гость. Создайте аккаунт, чтобы открыть прогресс на другом устройстве.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить прогресс' })).toBeVisible()
})

test('profile modal opens auth flow for guest and anonymous visitor', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Профиль' }).click()
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible()
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Войти' })).toBeVisible()

  await page.locator('.modal header button').first().click()
  await expect(page.getByRole('heading', { name: 'Все сойдется!' })).toBeVisible()
})
