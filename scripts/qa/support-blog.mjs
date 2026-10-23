// Local browser + SMTP check. No production API, database or external mail.
import assert from 'node:assert/strict'
import { createServer as createTcpServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { registerSupportRoutes } from '../../apps/api/src/modules/support/routes.ts'
import { sendError } from '../../apps/api/src/lib/errors.ts'
import { SUPPORT_EMAIL } from '../../packages/contracts/src/support.ts'
import * as fixtures from './reference-fixtures.mjs'

const output = resolve('qa/support-blog-2026-10-21')
await mkdir(output, { recursive: true })
let rejectMail = false
const received = []
const smtp = createTcpServer(socket => {
  socket.setEncoding('utf8')
  socket.write('220 localhost QA SMTP\r\n')
  let buffer = '', message = '', data = false
  socket.on('data', chunk => {
    buffer += chunk
    while (buffer.includes('\r\n')) {
      const index = buffer.indexOf('\r\n')
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      if (data) {
        if (line === '.') {
          data = false
          received.push(message)
          setTimeout(() => socket.write('250 Message accepted\r\n'), 250)
        } else message += `${line}\r\n`
      } else if (/^EHLO|^HELO/.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n')
      else if (/^RCPT/.test(line)) socket.write(rejectMail ? '550 Mailbox unavailable\r\n' : '250 OK\r\n')
      else if (line === 'DATA') { data = true; message = ''; socket.write('354 Send data\r\n') }
      else if (line === 'QUIT') socket.end('221 Bye\r\n')
      else socket.write('250 OK\r\n')
    }
  })
})
await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve))
const api = Fastify()
api.setErrorHandler((error, request, reply) => sendError(request, reply, error))
await api.register(rateLimit)
registerSupportRoutes(api, { smtp: { host: '127.0.0.1', port: smtp.address().port, from: 'local-support@example.test', user: '', password: '' } })
api.get('/api/v1/meta', () => fixtures.meta())
api.get('/api/v1/me', () => fixtures.me('guest'))
api.get('/api/v1/me/dashboard', () => fixtures.dashboard('guest'))
api.get('/api/v1/me/commerce', () => fixtures.commerce('guest'))
api.get('/api/v1/friends/rooms', () => ({ rooms: [] }))
api.get('/api/v1/packs', () => ({ items: fixtures.packs('guest') }))
api.get('/api/v1/commerce/catalog', () => fixtures.catalog())
api.get('/api/v1/connections/daily', () => ({ session: null }))
api.get('/api/*', () => ({ items: [] }))
api.post('/api/*', () => ({}))
const apiOrigin = await api.listen({ host: '127.0.0.1', port: 0 })
process.env.VITE_API_PROXY_TARGET = apiOrigin
process.env.VITE_API_BASE_URL = '/api/v1'
process.env.VITE_AUTH_BASE_URL = '/api/auth'
process.env.VITE_LOCAL_REDESIGN = '0'
process.env.VITE_REFERENCE_API = '0'
process.env.VITE_QUEST_STUDY = '0'
process.env.VITE_PUBLIC_THEME = ''
process.env.VITE_CACHE_DIR = resolve('.tmp/vite-support-blog-qa')
const vite = await createServer({ configFile: resolve('apps/web/vite.config.ts'), mode: 'development', server: { host: '127.0.0.1', port: 5184, strictPort: true } })
let browser
const errors = []
const checks = []
try {
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const base = 'http://127.0.0.1:5184'
  for (const theme of ['reference', 'legacy']) {
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 920 })
      await page.goto(`${base}/support?preview=${theme}`)
      await expect(page.getByRole('heading', { level: 1, name: 'Поддержка', exact: true })).toBeVisible()
      const cookieButton = page.getByRole('button', { name: 'Только необходимые' })
      if (await cookieButton.isVisible()) await cookieButton.click()
      await expect(page.getByRole('button', { name: 'Отправить сообщение', exact: true })).toBeDisabled()
      await page.screenshot({ path: resolve(output, `support-${theme}-${width}.png`), fullPage: true })
      const overflow = await page.evaluate(() => ({
        width: window.innerWidth, scroll: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 12).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })),
      }))
      assert.ok(overflow.scroll <= width, `${theme} support overflow ${width}: ${JSON.stringify(overflow)}`)
      await page.locator('footer').getByRole('link', { name: 'Блог', exact: true }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Блог', exact: true })).toBeVisible()
      await expect(page.locator('.blog-card')).toHaveCount(2)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme} blog overflow ${width}`)
      await page.screenshot({ path: resolve(output, `blog-${theme}-${width}.png`), fullPage: true })
      await page.getByRole('heading', { name: 'Связаться с нами стало проще' }).getByRole('link').click()
      await expect(page.getByRole('heading', { level: 1, name: 'Связаться с нами стало проще' })).toBeVisible()
      await page.reload()
      await expect(page.locator('.blog-article')).toBeVisible()
      await page.getByRole('link', { name: 'Все записи', exact: true }).click()
      await expect(page.locator('.blog-card')).toHaveCount(2)
      await page.goBack()
      await expect(page.locator('.blog-article')).toBeVisible()
      checks.push(`${theme}, ${width}px: form, footer, blog, article, reload, browser history, no overflow`)
    }
  }
  await page.setViewportSize({ width: 1280, height: 920 })
  await page.goto(`${base}/support?preview=reference`)
  await page.getByLabel('Ваш email').fill('player@example.test')
  await page.locator('#support-message').fill('Проверка отправки обращения через локальный SMTP.')
  await page.getByRole('checkbox').check()
  const response = page.waitForResponse(url => url.url().endsWith('/api/v1/support/messages'))
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Отправляем…' })).toBeDisabled()
  assert.equal((await response).status(), 200)
  await expect(page.getByRole('heading', { name: 'Сообщение отправлено' })).toBeVisible()
  assert.equal(received.length, 1)
  assert.ok(received[0].includes(`To: ${SUPPORT_EMAIL}`))
  assert.ok(received[0].includes('Reply-To: player@example.test'))
  await page.screenshot({ path: resolve(output, 'support-success.png'), fullPage: true })
  checks.push('Real local SMTP: one message, fixed recipient, player Reply-To, disabled pending button, confirmed success')
  await page.getByRole('button', { name: 'Написать ещё' }).click()
  rejectMail = true
  await page.locator('#support-message').fill('Это сообщение должно сохраниться после отказа почты.')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Не удалось отправить сообщение')
  await expect(page.locator('#support-message')).toHaveValue('Это сообщение должно сохраниться после отказа почты.')
  await expect(page.getByRole('heading', { name: 'Сообщение отправлено' })).toHaveCount(0)
  await page.screenshot({ path: resolve(output, 'support-error.png'), fullPage: true })
  checks.push('SMTP rejection: error visible, no success, entered text retained')
  await page.goto(`${base}/blog/unknown-entry?preview=reference`)
  await expect(page.getByRole('heading', { name: 'Запись не найдена' })).toBeVisible()
  checks.push('Unknown article: clear missing-entry page')
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ checks, uncaughtErrors: errors, localMailCount: received.length }, null, 2))
  console.log(JSON.stringify({ checks, uncaughtErrors: errors, localMailCount: received.length }, null, 2))
} finally {
  await browser?.close()
  await vite.close()
  await api.close()
  await new Promise(resolve => smtp.close(resolve))
}
