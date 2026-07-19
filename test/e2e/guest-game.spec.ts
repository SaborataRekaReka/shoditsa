import { expect, test, type Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { contentItemVersions, createDatabase, gameSessions } from '@shoditsa/database'

const searchInput = (page: Page) => page.locator('#movie-search')

const openModeLobby = async (page: Page, mode: string) => {
  await page.getByRole('link', { name: `Играть: ${mode}`, exact: true }).click()
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

const answerTitleForSession = async (sessionId: string) => {
  process.env.DATABASE_URL ||= 'postgres://shoditsa_app:shoditsa_dev@localhost:5434/shoditsa'
  const database = createDatabase(loadConfig())
  try {
    const rows = await database.db
      .select({ titleRu: contentItemVersions.titleRu })
      .from(gameSessions)
      .innerJoin(contentItemVersions, eq(contentItemVersions.id, gameSessions.answerItemVersionId))
      .where(eq(gameSessions.id, sessionId))
      .limit(1)
    if (!rows[0]?.titleRu) throw new Error(`Не найден ответ для сеанса ${sessionId}`)
    return rows[0].titleRu
  } finally {
    await database.client.end()
  }
}

const ticketBalance = async (page: Page) => Number(await page.locator('.header-economy strong').first().textContent())

const expectNoHorizontalOverflow = async (page: Page, screen: string) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `Горизонтальный overflow на экране: ${screen}`).toBeLessThanOrEqual(1)
}

const footerNavigation = (page: Page) => page.getByRole('navigation', { name: 'Навигация в подвале' })

const openGuestProfile = async (page: Page) => {
  await footerNavigation(page).getByRole('button', { name: 'Профиль' }).click()
  await expect(page.getByRole('heading', { name: 'Гость кинозала' })).toBeVisible()
}

const openProfileSettings = async (page: Page) => {
  await page.getByRole('tab', { name: 'Настройки', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Вход и пароль' })).toBeVisible()
}

const ensureHintModalOpen = async (page: Page) => {
  const title = page.getByRole('heading', { name: 'Выберите подсказку' })
  if (!(await title.isVisible())) {
    await page.locator('.hint-trigger').first().click()
  }
  await expect(title).toBeVisible()
}

const verificationUrlFor = async (email: string) => {
  await expect.poll(async () => {
    const response = await fetch('http://127.0.0.1:8025/api/v1/messages')
    const body = await response.json() as { messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }> }
    return body.messages?.find((message) => message.To?.some((recipient) => recipient.Address === email))?.ID ?? ''
  }, { timeout: 15_000 }).not.toBe('')
  const list = await fetch('http://127.0.0.1:8025/api/v1/messages').then((response) => response.json()) as { messages: Array<{ ID: string; To?: Array<{ Address?: string }> }> }
  const id = list.messages.find((message) => message.To?.some((recipient) => recipient.Address === email))!.ID
  const message = await fetch(`http://127.0.0.1:8025/api/v1/message/${id}`).then((response) => response.json()) as { Text?: string }
  const url = message.Text?.match(/https?:\/\/\S+/)?.[0]?.replaceAll('&amp;', '&')
  if (!url) throw new Error(`В письме для ${email} нет ссылки подтверждения`)
  return url
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

test('all canonical modes use the current cards and mobile layout does not overflow', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.brand img[alt="Сходится!"]')).toBeVisible()
  for (const title of ['Кино', 'Сериалы', 'Аниме', 'Игры', 'Города', 'Музыка', 'Диагнозы']) {
    await page.getByRole('link', { name: `Играть: ${title}`, exact: true }).click()
    await expect(page.locator('.title-screen')).toBeVisible()
    await page.getByRole('button', { name: 'На главный экран' }).first().click()
    await expect(page.getByRole('heading', { name: 'Все сойдется!' })).toBeVisible()
  }
  await page.getByRole('link', { name: 'Играть: Сериалы', exact: true }).click()
  await expect(page.locator('.title-screen')).toBeVisible()
  await expect(page.locator('.server-lobby, .server-game')).toHaveCount(0)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow).toBe(false)
})

test('opening a mode from a scrolled hub starts at the top of the title screen', async ({ page }) => {
  await page.goto('/')
  const cityCard = page.getByRole('link', { name: 'Играть: Города', exact: true })
  await cityCard.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  await cityCard.click()
  await expect(page).toHaveURL('/games/city')
  await expect(page.locator('.app-header')).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
})

test('cities keep the compact mode picker and switch the answer pool', async ({ page }) => {
  await page.goto('/')
  await openModeLobby(page, 'Города')

  const trigger = page.locator('.mode-variant-trigger')
  await expect(trigger).toContainText('Столицы')
  await trigger.click()
  await expect(page.getByRole('listbox', { name: 'Режим игры «Города»' })).toBeVisible()

  await page.getByRole('option', { name: /Все города/ }).click()
  await expect(trigger).toContainText('Все')
  await expect(page.locator('.mode-variant-menu')).toHaveCount(0)
})

test('every game guide unfolds inside its own themed artifact', async ({ page }) => {
  const cases = [
    { mode: 'movie', artifact: '.admit-ticket--dossier', closedLabel: 'Развернуть билет', evidenceTitle: 'Что сверяем', routeTitle: 'Как искать фильм' },
    { mode: 'series', artifact: '.admit-ticket--dossier', closedLabel: 'Открыть телепрограмму', evidenceTitle: 'Что сверяем', routeTitle: 'Как искать сериал' },
    { mode: 'anime', artifact: '.admit-ticket--dossier', closedLabel: 'Развернуть вкладыш', evidenceTitle: 'Что сверяем', routeTitle: 'Как искать аниме' },
    { mode: 'game', artifact: '.game-case--dossier', closedLabel: 'Открыть буклет', evidenceTitle: 'Что сверяем', routeTitle: 'Как искать игру' },
    { mode: 'city', artifact: '.admit-ticket--dossier', closedLabel: 'Развернуть маршрут', evidenceTitle: 'Что сверяем', routeTitle: 'Как найти город' },
    { mode: 'music', artifact: '.concert-ticket--dossier', closedLabel: 'Открыть программу', evidenceTitle: 'Что сверяем', routeTitle: 'Как искать артиста' },
    { mode: 'diagnosis', artifact: '.med-chart--dossier', closedLabel: 'Открыть карту', evidenceTitle: 'Что сравниваем', routeTitle: 'Как искать ответ' },
  ] as const

  for (const entry of cases) {
    await page.goto(`/games/${entry.mode}`)
    const artifact = page.locator(entry.artifact)
    const dossier = artifact.locator(`.artifact-dossier.ticket-dossier--${entry.mode}`)
    await expect(artifact).toBeVisible()
    await expect(page.locator('.seo-content--game')).toHaveCount(0)
    await expect(dossier).not.toHaveAttribute('open', '')
    await expect(dossier.locator('.ticket-dossier__story p')).toHaveCount(2)

    await dossier.getByText(entry.closedLabel, { exact: true }).click()
    await expect(dossier).toHaveAttribute('open', '')
    await expect(artifact.getByRole('heading', { name: entry.evidenceTitle })).toBeVisible()
    await expect(artifact.getByRole('heading', { name: entry.routeTitle })).toBeVisible()
    await expect(artifact.getByRole('heading', { name: 'Короткие ответы' })).toBeVisible()
    await expectNoHorizontalOverflow(page, `${entry.mode}-artifact-dossier`)
  }
})

test('archive screen starts a server archive session in the polished layout', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Архив' }).first().click()
  await expect(page.getByRole('heading', { name: 'Архив' })).toBeVisible()
  await page.getByRole('button', { name: /Вчера/ }).click()
  await expect(searchInput(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.game-heading')).toContainText('Архив')
})

test('critical guest screens stay in viewport and main navigation remains clickable', async ({ page }) => {
  await page.goto('/')
  await expectNoHorizontalOverflow(page, 'hub')

  await openModeLobby(page, 'Кино')
  await expectNoHorizontalOverflow(page, 'title')

  await page.getByRole('button', { name: 'Начать игру' }).click()
  await expect(searchInput(page)).toBeVisible({ timeout: 15_000 })
  await expectNoHorizontalOverflow(page, 'game')

  await page.getByRole('button', { name: 'На главный экран' }).first().click()
  await expect(page.getByRole('heading', { name: 'Все сойдется!' })).toBeVisible()
  await expectNoHorizontalOverflow(page, 'hub-after-game')

  await footerNavigation(page).getByRole('button', { name: 'Профиль' }).click()
  await expect(page.getByRole('heading', { name: 'Гость кинозала' })).toBeVisible()
  await expectNoHorizontalOverflow(page, 'profile')

  await footerNavigation(page).getByRole('button', { name: 'Архив' }).click()
  await expect(page.getByRole('heading', { name: 'Архив' })).toBeVisible()
  await expectNoHorizontalOverflow(page, 'archive')
})

test('server exposes the first assist checkpoint after five attempts', async ({ page }) => {
  await page.goto('/')
  await startModeGame(page, 'Кино')
  for (const query of ['а', 'е', 'и', 'о', 'с']) {
    if (!(await searchInput(page).isVisible())) break
    await submitAttempt(page, query)
  }
  await expect(page.locator('.hint-trigger').first()).toBeVisible()
  await ensureHintModalOpen(page)
  await page.getByRole('button', { name: 'Не сейчас' }).click()
  await expect(page.locator('.hint-modal-backdrop')).toBeHidden()
  await page.locator('.hint-trigger').first().click()
  await expect(page.getByRole('heading', { name: 'Выберите подсказку' })).toBeVisible()
  let releaseHintRequest: () => void = () => undefined
  const hintRequestGate = new Promise<void>((resolve) => { releaseHintRequest = resolve })
  await page.route('**/api/v1/games/*/hints', async (route) => {
    await hintRequestGate
    await route.continue()
  }, { times: 1 })
  await page.locator('.hint-modal__options button').first().click()
  await expect(page.getByRole('heading', { name: 'Открываем подсказку' })).toBeVisible()
  await expect(page.locator('.hint-modal__options')).toHaveCount(0)
  releaseHintRequest()
  await expect(page.getByRole('heading', { name: 'Подсказка открыта' })).toBeVisible()
  await expect(page.locator('.assist-reveal-card')).toBeVisible()
  await expect(page.locator('.hint-modal-backdrop')).toBeVisible()
  await page.getByRole('button', { name: 'Понятно' }).click()
  await expect(page.locator('.hint-modal-backdrop')).toBeHidden()
})

test('guest economy is server-backed and invalid promo errors are visible', async ({ page }) => {
  await page.goto('/')
  await openModeLobby(page, 'Кино')
  await page.locator('.period-control--custom').click()
  const freePlay = page.locator('.period-option--free-play')
  await expect(freePlay).toContainText(/Не хватает 45 билетов/)
  await expect(freePlay).toHaveClass(/locked/)
  await page.getByRole('button', { name: 'На главный экран' }).first().click()
  await page.locator('.header-economy').click()
  await expect(page.getByRole('heading', { name: 'Билеты' })).toBeVisible()
  await page.getByPlaceholder('Промокод').fill('INVALID-CODE')
  await page.getByRole('button', { name: 'Активировать' }).click()
  await expect(page.getByText(/Промокод не найден/)).toBeVisible()
})

test('profile opens the current account screen for a guest', async ({ page }) => {
  await page.goto('/')
  await openGuestProfile(page)
  await expect(page.getByText(/Ваш прогресс сохранён в текущем браузере/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Настройки профиля' })).toBeVisible()
  await openProfileSettings(page)
  await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
})

test('guest winnings survive registration, logout, login and a second browser', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Полный межсессионный сценарий достаточно проверить в desktop-проекте')
  const email = `e2e-lifecycle-${crypto.randomUUID()}@example.test`
  const password = 'Strong-password-123'

  await page.goto('/')
  await startModeGame(page, 'Кино')
  const sessionId = await page.evaluate(() => window.sessionStorage.getItem('shoditsa:active-server-session'))
  expect(sessionId).toBeTruthy()
  const answerTitle = await answerTitleForSession(sessionId!)
  await searchInput(page).fill(answerTitle)
  const answer = page.locator('.suggestions button').filter({ hasText: answerTitle }).first()
  await expect(answer).toBeVisible({ timeout: 15_000 })
  await answer.click()
  await expect(page.locator('.result-card.won')).toBeVisible({ timeout: 15_000 })

  const guestBalance = await ticketBalance(page)
  expect(guestBalance).toBeGreaterThan(0)
  await page.locator('.reward-breakdown summary').click()
  await expect(page.locator('.reward-breakdown[open]')).toBeVisible()
  await page.getByRole('button', { name: 'Нашли ошибку в подсказке?' }).click()
  await page.getByPlaceholder('Комментарий — необязательно').fill('Проверка полного пользовательского сценария')
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  await expect(page.getByText('Спасибо, проверим подсказку.')).toBeVisible()
  await page.getByRole('button', { name: 'Скопировать результат' }).click()
  await expect(page.getByRole('button', { name: 'Скопировано' })).toBeVisible()
  await page.getByRole('button', { name: 'Бросить вызов другу' }).click()
  await page.locator('.result-next').click()
  await expect(page.locator('.title-screen')).toBeVisible()

  await openGuestProfile(page)
  await openProfileSettings(page)
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click()
  await page.getByLabel('Имя').fill('Lifecycle Player')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click()
  await expect(page.getByText(/Подтвердите .* по ссылке из письма/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Гость кинозала' })).toBeVisible()
  expect(await ticketBalance(page)).toBe(guestBalance)
  const verificationUrl = await verificationUrlFor(email)
  await page.goto(verificationUrl)
  await page.goto('/')
  await footerNavigation(page).getByRole('button', { name: 'Профиль' }).click()
  await expect(page.getByRole('heading', { name: 'Lifecycle Player' })).toBeVisible()
  await expect(page.locator('.profile-overview article').filter({ hasText: 'Билеты' }).locator('strong')).toHaveText(String(guestBalance))

  await page.reload()
  await footerNavigation(page).getByRole('button', { name: 'Профиль' }).click()
  await expect(page.getByRole('heading', { name: 'Lifecycle Player' })).toBeVisible({ timeout: 15_000 })
  expect(await ticketBalance(page)).toBe(guestBalance)

  await openProfileSettings(page)
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByText(/прогресс и билеты сохранены на сервере/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Гость кинозала' })).toBeVisible()
  expect(await ticketBalance(page)).toBe(0)

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByText(/Гостевые сеансы, билеты и открытые периоды объединены с аккаунтом/)).toBeVisible({ timeout: 15_000 })
  expect(await ticketBalance(page)).toBe(guestBalance)

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  try {
    await secondPage.goto('/login')
    await secondPage.getByLabel('Email').fill(email)
    await secondPage.getByRole('textbox', { name: 'Пароль' }).fill(password)
    await secondPage.getByRole('button', { name: 'ВОЙТИ', exact: true }).click()
    await expect.poll(() => secondPage.url(), { timeout: 15_000 }).not.toContain('/login')
    await footerNavigation(secondPage).getByRole('button', { name: 'Профиль' }).click()
    await expect(secondPage.getByRole('heading', { name: 'Lifecycle Player' })).toBeVisible({ timeout: 15_000 })
    expect(await ticketBalance(secondPage)).toBe(guestBalance)
  } finally {
    await secondContext.close()
  }
})

test('header, footer, profile and account controls navigate without server errors', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`))
  page.on('response', (response) => {
    if (response.status() >= 500 && response.url().includes('/api/')) failures.push(`${response.status()} ${response.url()}`)
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Как играть' }).first().click()
  await expect(page.getByRole('dialog', { name: 'Как играть' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.getByRole('button', { name: 'Статистика' }).click()
  await expect(page.getByRole('dialog', { name: 'Статистика' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.getByRole('button', { name: 'Билеты и абонемент' }).click()
  await expect(page.getByRole('dialog', { name: 'Билеты' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()

  await page.getByRole('button', { name: 'Архив' }).first().click()
  for (const mode of ['Фильмы', 'Сериалы', 'Аниме', 'Игры', 'Музыка', 'Диагнозы']) {
    await page.locator('.mode-tabs').getByRole('button', { name: mode, exact: true }).click()
  }
  await footerNavigation(page).getByRole('button', { name: 'Профиль' }).click()
  await expect(page.getByRole('heading', { name: 'Гость кинозала' })).toBeVisible()
  await page.getByRole('tab', { name: 'Статистика', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'По категориям' })).toBeVisible()
  await page.getByRole('tab', { name: 'Достижения', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Достижения' })).toBeVisible()
  await openProfileSettings(page)
  await expect(page.getByRole('button', { name: 'Войти через Яндекс' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Забыли пароль?' }).click()
  await expect(page.getByRole('button', { name: 'Отправить ссылку' })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуться ко входу' }).click()
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click()
  await expect(page.getByLabel('Имя')).toBeVisible()
  await page.getByRole('button', { name: 'У меня уже есть аккаунт' }).click()
  await expect(page.getByLabel('Имя')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Обзор', exact: true }).click()
  await page.getByRole('button', { name: 'Выбрать игру' }).click()
  await expect(page.locator('.title-screen')).toBeVisible()
  await footerNavigation(page).getByRole('button', { name: 'Правила' }).click()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await footerNavigation(page).getByRole('button', { name: 'Архив' }).click()
  await expect(page.getByRole('heading', { name: 'Архив' })).toBeVisible()
  await footerNavigation(page).getByRole('button', { name: 'Игры' }).click()
  await expect(page.getByRole('heading', { name: 'Все сойдется!' })).toBeVisible()
  expect(failures).toEqual([])
})
