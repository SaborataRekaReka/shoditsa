import { writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { and, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { createDatabase, playerProfiles, gameSessions, contentItemVersions, session as authSessions, user } from '@shoditsa/database'

test('daily word, hints, reload, both themes, result and archive', async ({ page, request }, info) => {
  const config = loadConfig()
  if (config.production || !['127.0.0.1', 'localhost'].includes(new URL(config.databaseUrl).hostname)) throw new Error('Local isolated database required')
  const database = createDatabase(config)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await request.post('/api/v1/auth/guest')
    const me = await (await request.get('/api/v1/me')).json()
    // Phase A is intentionally hidden for ordinary users. Admin preview runs
    // against the same server sessions, HTTP routes and UI as the public mode.
    await database.db.update(playerProfiles).set({ role: 'admin' }).where(eq(playerProfiles.userId, me.user.id))
    const cookies = await request.storageState()
    await page.context().addCookies(cookies.cookies)
    await page.goto('/games/word')
    const consent = page.getByRole('button', { name: 'Только необходимые', exact: true })
    if (await consent.isVisible()) await consent.click()
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Угадай слово\s*по ассоциациям/)
    const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await expect(page.getByRole('button', { name: 'Играть в слово дня' })).toBeEnabled()
    await noOverflow()
    const metrics = await page.locator('.qg-rail').evaluate(el => ({ rect: el.getBoundingClientRect().toJSON(), width: getComputedStyle(el).width, railVar: getComputedStyle(el).getPropertyValue('--study-rail-width'), parent: el.parentElement?.className, rules: [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules].filter(rule => rule instanceof CSSStyleRule && el.matches(rule.selectorText) && rule.style.width).map(rule => rule.cssText) } catch { return [] } }) }))
    await writeFile(info.outputPath('layout.json'), JSON.stringify(metrics, null, 2))
    await page.screenshot({ path: info.outputPath('word-title-light.png'), fullPage: false, animations: 'disabled' })
    await page.getByRole('button', { name: 'Играть в слово дня' }).click()
    await expect(page).toHaveURL(/\/sessions\//)
    const sessionId = new URL(page.url()).pathname.split('/').at(-1)!
    await expect(page.getByLabel('Твоя ассоциация')).toBeVisible()
    const submit = async (word: string) => { await page.getByLabel('Твоя ассоциация').fill(word); const response = page.waitForResponse(response => response.url().endsWith('/actions')); await page.getByRole('button', { name: 'Проверить', exact: true }).click(); await response }
    await submit('abracadabra')
    await expect(page.getByRole('status').filter({ hasText: 'Такого слова пока нет' })).toBeVisible()
    await expect(page.locator('.word-metrics')).toContainText('Попыток 0')
    for (const word of ['дыня', 'трамвай', 'компьютер', 'пингвин', 'бетон']) {
      await submit(word)
      await expect(page.locator('.word-guesses strong').filter({ hasText: new RegExp(`^${word}$`) })).toBeVisible()
    }
    await submit('ДЫНЯ')
    await expect(page.getByRole('status').filter({ hasText: 'уже проверено' })).toBeVisible()
    await expect(page.locator('.word-metrics')).toContainText('Попыток 5')
    await page.getByRole('button', { name: 'Подсказка (3)' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Подсказка:' })).toBeVisible()
    await expect(page.locator('.word-guess')).toHaveCount(6)
    await page.reload()
    await expect(page.locator('.word-guess')).toHaveCount(6)
    await noOverflow()
    await page.screenshot({ path: info.outputPath('word-playing-light.png'), fullPage: false, animations: 'disabled' })
    const toggle = page.getByRole('switch', { name: 'Тёмная тема' })
    if (await toggle.count() && await toggle.first().isVisible()) await toggle.first().click()
    else {
      // Use the actual settings control when the theme switch is behind a menu.
      await page.getByRole('button', { name: /Меню аккаунта/ }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Тёмная тема' }).click()
    }
    await page.keyboard.press('Escape')
    await page.locator('#word-heading').scrollIntoViewIfNeeded()
    await expect(page.locator('html')).toHaveAttribute('data-quest-tone', 'dark')
    await page.screenshot({ path: info.outputPath('word-playing-dark.png'), fullPage: false, animations: 'disabled' })
    const [answer] = await database.db.select({ payload: contentItemVersions.payload }).from(gameSessions).innerJoin(contentItemVersions, eq(gameSessions.answerItemVersionId, contentItemVersions.id)).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, me.user.id)))
    const word = (answer.payload as { titleRu: string }).titleRu
    await submit(word)
    await expect(page.getByRole('heading', { name: word, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Поделиться результатом' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: word, exact: true })).toBeVisible()
    await noOverflow()
    await page.screenshot({ path: info.outputPath('word-result-dark.png'), fullPage: false, animations: 'disabled' })
    await page.getByRole('link', { name: 'Открыть архив', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Архив', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally { await database.client.end() }
})

test('rules, cancellation, giving up, spoiler-free sharing and admin catalog', async ({ page, request }, info) => {
  const config = loadConfig()
  if (config.production || !['127.0.0.1', 'localhost'].includes(new URL(config.databaseUrl).hostname)) throw new Error('Local isolated database required')
  const database = createDatabase(config)
  try {
    await request.post('/api/v1/auth/guest')
    const me = await (await request.get('/api/v1/me')).json()
    await database.db.update(playerProfiles).set({ role: 'admin' }).where(eq(playerProfiles.userId, me.user.id))
    await page.context().addCookies((await request.storageState()).cookies)
    await page.goto('/games/word')
    const consent = page.getByRole('button', { name: 'Только необходимые', exact: true })
    if (await consent.isVisible()) await consent.click()
    await page.getByRole('button', { name: 'Играть в слово дня' }).click()
    await expect(page.getByLabel('Твоя ассоциация')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Проверить', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Правила игры', exact: true }).click()
    await expect(page.locator('.word-rules')).toHaveAttribute('open', '')
    await page.getByRole('button', { name: 'Сдаться', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Открыть ответ?' })).toBeVisible()
    await page.getByRole('button', { name: 'Продолжить игру', exact: true }).click()
    await expect(page.getByLabel('Твоя ассоциация')).toBeVisible()
    await page.getByRole('button', { name: 'Сдаться', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Открыть ответ?' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Сдаться', exact: true }).click()
    await page.getByRole('button', { name: 'Открыть ответ', exact: true }).click()
    await expect(page.locator('.word-result')).toContainText('Ответ на сегодня')
    const answer = await page.locator('.word-result h2').innerText()
    await page.reload()
    await expect(page.locator('.word-result h2')).toHaveText(answer)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: 'Поделиться результатом' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Результат скопирован без ответа' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain(answer)
    await page.screenshot({ path: info.outputPath('word-given-up.png'), animations: 'disabled' })
    const adminId = '00000000-0000-4000-8000-000000000001'
    await database.db.update(user).set({ email: 'breneize@yandex.ru', emailVerified: true, isAnonymous: false }).where(eq(user.id, adminId))
    await database.db.update(authSessions).set({ userId: adminId }).where(eq(authSessions.userId, me.user.id))
    const tokens = (await page.context().cookies()).filter(cookie => cookie.name.includes('session_token'))
    await page.context().clearCookies()
    await page.context().addCookies(tokens)
    await page.goto('/admin/content?mode=word')
    await expect(page.getByRole('heading', { name: 'Карточки, Слово по смыслу', exact: true })).toBeVisible()
    await expect(page.getByText('180 карточек', { exact: true })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'word:' }).first()).toContainText('100%')
    await page.screenshot({ path: info.outputPath('word-admin.png'), animations: 'disabled' })
  } finally { await database.client.end() }
})
