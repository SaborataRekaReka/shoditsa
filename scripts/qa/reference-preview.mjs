/**
 * Isolated presentation harness. Run alongside the local Vite UI:
 *   node scripts/qa/reference-preview.mjs
 * Only frontend GET/HEAD requests can reach loopback Vite. Every API request is
 * handled here; unsupported requests fail closed. No production credentials,
 * database, authentication, checkout, or remote media requests are forwarded.
 */
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createReadStream, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as fixtures from './reference-fixtures.mjs'

const publicDirectory = fileURLToPath(new URL('../../public', import.meta.url))
const cookieName = 'reference_qa_scenario'
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
const contentTypes = { '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.json': 'application/json', '.txt': 'text/plain', '.css': 'text/css', '.js': 'text/javascript' }
contentTypes['.html'] = 'text/html; charset=utf-8'
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Reference-QA': 'local-fixtures-no-api-forwarding',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; form-action 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'",
}

// Vite's HMR client has an absolute fallback URL. Replacing it prevents any
// websocket fallback from escaping the harness, while preserving CSS imports.
const viteClient = `
export function createHotContext() { return { data: {}, accept() {}, acceptExports() {}, dispose() {}, prune() {}, decline() {}, invalidate() {}, on() {}, off() {}, send() {} }; }
export function updateStyle(id, content) { let element = Array.from(document.querySelectorAll('style[data-vite-dev-id]')).find(node => node.dataset.viteDevId === id); if (!element) { element = document.createElement('style'); element.dataset.viteDevId = id; document.head.appendChild(element); } element.textContent = content; }
export function removeStyle(id) { Array.from(document.querySelectorAll('style[data-vite-dev-id]')).find(node => node.dataset.viteDevId === id)?.remove(); }
export function injectQuery(url, query) { return url + (url.includes('?') ? '&' : '?') + query; }
`

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
function unavailable(response, method, pathname) {
  json(response, 501, { code: 'QA_FIXTURE_NOT_IMPLEMENTED', message: `Локальный QA: действие ${method} ${pathname} не входит в набор примеров. Запрос не отправлен на основной сайт.`, details: { localOnly: true } })
}
async function readBody(request) {
  let source = ''
  for await (const chunk of request) {
    source += chunk
    if (source.length > 65_536) throw new Error('Request body is too large')
  }
  return source ? JSON.parse(source) : {}
}
function readScenario(request, url) {
  const selected = url.searchParams.get('qa')
  const saved = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  return fixtures.SCENARIOS.includes(selected) ? selected : fixtures.SCENARIOS.includes(saved) ? saved : 'member'
}
function sessionFromId(id) {
  const special = id.match(/^qa-(dtf|kpop)-(playing|won|lost)$/)
  if (special) return fixtures.specialSession(special[1], special[2])
  const match = id.match(/^qa-(movie|series|anime|game|city|music|diagnosis|animal|book|character|danetki|connections)-(playing|won|lost)(?:-(\d{4}-\d{2}-\d{2}))?$/)
  return match ? fixtures.session(match[1], match[2], { id, ...(match[3] ? { puzzleDate: match[3], kind: 'archive' } : {}) }) : null
}

async function handleApi(request, response, url, scenario) {
  const pathname = url.pathname
  const method = request.method ?? 'GET'
  const read = method === 'GET' || method === 'HEAD'
  if (read && pathname === '/api/v1/meta') return json(response, 200, fixtures.meta())
  if (read && pathname === '/api/v1/me') return json(response, 200, fixtures.me(scenario))
  if (scenario === 'error' && read && /^\/api\/v1\/(?:me\/(?:dashboard|commerce)|archive|packs|leaderboard|commerce\/orders)(?:\/|$)/.test(pathname)) {
    return json(response, 503, { code: 'QA_SIMULATED_ERROR', message: 'Не удалось загрузить пример. Это контролируемое состояние ошибки локального QA.' })
  }
  if (read && pathname === '/api/v1/me/dashboard') return json(response, 200, fixtures.dashboard(scenario))
  if (read && pathname === '/api/v1/leaderboard') return json(response, 200, fixtures.globalLeaderboard(scenario, url.searchParams))
  if (read && pathname === '/api/v1/me/commerce') return json(response, 200, fixtures.commerce(scenario))
  if (read && pathname === '/api/v1/me/wallet') return json(response, 200, { wallet: fixtures.dashboard(scenario).wallet })
  if (read && pathname === '/api/v1/me/wallet/ledger') return json(response, 200, { items: scenario === 'empty' ? [] : [
    { id: 'qa-ledger-1', amount: 18, balanceAfter: 248, reason: 'game_completed', type: 'earn', rulesVersion: fixtures.dashboard(scenario).economyRules.version, createdAt: fixtures.NOW },
    { id: 'qa-ledger-2', amount: -60, balanceAfter: 230, reason: 'free_play', type: 'spend', rulesVersion: fixtures.dashboard(scenario).economyRules.version, createdAt: fixtures.NOW },
  ], nextCursor: null })
  if (read && pathname === '/api/v1/archive') return json(response, 200, { items: fixtures.archiveItems(scenario, url.searchParams.get('mode')), nextCursor: null })
  if (read && pathname === '/api/v1/archive/calendar') return json(response, 200, fixtures.archiveCalendar(scenario, url.searchParams))
  if (read && pathname === '/api/v1/commerce/catalog') return json(response, 200, fixtures.catalog())
  let match = pathname.match(/^\/api\/v1\/commerce\/orders\/([^/]+)$/)
  if (read && match) return json(response, 200, fixtures.order(scenario, match[1]))
  if (read && pathname === '/api/v1/packs') return json(response, 200, { items: fixtures.packs(scenario) })
  match = pathname.match(/^\/api\/v1\/packs\/([^/]+)(?:\/(progress|leaderboard|sessions))?$/)
  if (match) {
    const pack = fixtures.packDetail(scenario, match[1])
    if (!pack) return json(response, 404, { code: 'QA_PACK_NOT_FOUND', message: 'В локальных примерах нет такой подборки.' })
    if (read && !match[2]) return json(response, 200, { pack })
    if (read && match[2] === 'progress') return json(response, 200, { packId: pack.id, completedPositions: pack.entries.filter(entry => entry.completed).map(entry => entry.position), lastPosition: pack.completedItems || null, completedAt: null })
    if (read && match[2] === 'leaderboard') return json(response, 200, fixtures.leaderboard(pack.id))
    if (method === 'POST' && match[2] === 'sessions') {
      const body = await readBody(request)
      return json(response, 200, { session: fixtures.specialSession(pack.mode === 'game' ? 'dtf' : 'kpop', 'playing', Number(body.position) || 1) })
    }
  }
  if (read && pathname === '/api/v1/catalog/search') {
    const items = fixtures.libraries[url.searchParams.get('mode') ?? 'movie'] ?? []
    const query = (url.searchParams.get('q') ?? url.searchParams.get('query') ?? '').toLocaleLowerCase('ru')
    return json(response, 200, { items: items.filter(item => [item.titleRu, item.titleOriginal, ...(item.alternativeTitles ?? [])].some(title => String(title).toLocaleLowerCase('ru').includes(query))) })
  }
  if (method === 'POST' && pathname === '/api/v1/games/start') {
    const body = await readBody(request)
    if (body.variantKey === 'kpop-artists-admin-v1') return json(response, 200, { session: fixtures.specialSession('kpop') })
    if (![...fixtures.MODES, 'connections', 'danetki'].includes(body.mode)) return unavailable(response, method, pathname)
    return json(response, 200, { session: fixtures.session(body.mode, 'playing', { kind: body.kind ?? 'daily', period: body.period ?? 'all', difficulty: body.difficulty ?? (body.mode === 'music' ? 'medium' : null), variantKey: body.variantKey ?? null, puzzleDate: body.archiveDate ?? fixtures.TODAY }) })
  }
  match = pathname.match(/^\/api\/v1\/games\/([^/]+)$/)
  if (read && match) {
    const session = sessionFromId(match[1])
    return session ? json(response, 200, { session }) : unavailable(response, method, pathname)
  }
  match = pathname.match(/^\/api\/v1\/danetki\/sessions\/([^/]+)\/snapshot$/)
  if (read && match) {
    const session = sessionFromId(match[1])
    if (session?.mode === 'danetki') return json(response, 200, { session })
  }
  if (pathname.startsWith('/api/v1/friends/rooms')) {
    // Data is deterministic. Anchor phase clocks to this local request so the
    // real UI can show its timer; no round transitions or mutations are run.
    const now = new Date().toISOString()
    const room = fixtures.roomForScenario(scenario, now)
    if (read && pathname === '/api/v1/friends/rooms') return json(response, 200, { rooms: fixtures.rooms(scenario, now) })
    if (method === 'POST' && pathname === '/api/v1/friends/rooms') return json(response, 200, { room })
    if (read && pathname === `/api/v1/friends/rooms/${room.id}/snapshot`) return json(response, 200, { room })
    if (read && pathname === `/api/v1/friends/rooms/code/${room.code}`) return json(response, 200, {
      code: room.code, hostName: room.members[0].displayName, gameType: room.gameType,
      danetkiLaunchCost: room.danetkiLaunchCost, mode: room.mode, packs: room.packs,
      players: room.members.length, capacity: room.capacity, phase: room.phase,
    })
    if (request.method === 'GET' && pathname === `/api/v1/friends/rooms/${room.id}/events`) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' })
      response.write(`event: room.snapshot\ndata: ${JSON.stringify(room)}\n\n`)
      // Keep a single fixed snapshot connected for presentation review. This
      // intentionally does not emulate a second player, reconnection or replay.
      const heartbeat = setInterval(() => response.write(': local fixture\n\n'), 15_000)
      heartbeat.unref()
      response.on('close', () => clearInterval(heartbeat))
      return
    }
  }
  match = pathname.match(/^\/api\/v1\/danetki\/sessions\/([^/]+)\/events$/)
  if (request.method === 'GET' && match) {
    const session = sessionFromId(match[1])
    if (session?.mode === 'danetki') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' })
      response.write(`event: session.snapshot\ndata: ${JSON.stringify(session)}\n\n`)
      const heartbeat = setInterval(() => response.write(': local fixture\n\n'), 15_000)
      heartbeat.unref()
      response.on('close', () => clearInterval(heartbeat))
      return
    }
  }
  if (method === 'POST' && pathname === '/api/v1/auth/guest') return json(response, 200, { user: fixtures.me(scenario).user })
  if (method === 'POST' && pathname === '/api/v1/client-events/batch') { response.writeHead(204); return response.end() }
  return unavailable(response, method, pathname)
}

export function qaIndex(scenario, { localSvoyak = false } = {}) {
  const link = (path, label, state = scenario) => `<li><a href="${escapeHtml(`${path}${path.includes('?') ? '&' : '?'}qa=${state}`)}">${escapeHtml(label)}</a></li>`
  const roomPanel = `<section><h2>Комната и Территория</h2><ul>${[
    ['room-active', 'SEANS7', 'Комната: идёт раунд'],
    ['room-results', 'SEANS7', 'Комната: ответы и очки'],
    ['room-finished', 'SEANS7', 'Комната: итог игры'],
    ['territory-question', 'MAPQA7', 'Территория: поле и вопрос'],
    ['territory-reveal', 'MAPQA7', 'Территория: раскрытие ответа'],
    ['territory-capture', 'MAPQA7', 'Территория: выбор клетки'],
    ['territory-finished', 'MAPQA7', 'Территория: результат'],
  ].map(([state, code, label]) => link(`/games/together?room=${code}`, label, state)).join('')}</ul><p>Фазы фиксированы. Обновление страницы запускает только локальный таймер заново. Ответы, чат, захваты и переходы фаз возвращают 501. Второй клиент и переподключение здесь не проверяются.</p></section>`
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Сходится — локальные состояния</title><style>body{margin:0;background:#fdfbf7;color:#141416;font:16px/1.6 system-ui}main{max-width:1000px;margin:auto;padding:32px 20px}h1{line-height:1.15}a{color:#315f43}ul{padding-left:20px}section{padding:20px;border:1px solid #dedbd5;border-radius:18px;background:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.states{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px}code{background:#eee8fd;padding:3px 5px;border-radius:4px}</style><main><p>Изолированный QA, только localhost:5180</p><h1>Настоящие экраны, данные примера</h1><p>API обслуживается этим сервером. Авторизация, платежи, сохранение профиля, игровые ответы и AI не выполняются. Неизвестные действия возвращают 501. Запуск игры показывает заранее заданный сеанс. Данные не сохраняются.</p><nav class="states">${fixtures.SCENARIOS.map(state => `<a href="/__qa?qa=${state}"${state === scenario ? ' aria-current="page"' : ''}>${state === scenario ? `<strong>${state}</strong>` : state}</a>`).join('')}</nav><div class="grid"><section><h2>Публичные страницы</h2><ul>${[
    ['/', 'Главная'], ['/lobby', 'Лобби'], ...(localSvoyak ? [['/games/svoyak', 'Своя игра (локально)']] : []), ['/leaderboard', 'Рейтинг'], ['/quests', 'Задания'], ['/settings', 'Настройки'], ['/profile', 'Профиль'], ['/archive', 'Архив'], ['/club', 'Клуб'], ['/specials', 'Спецпоказы'], ['/specials/dtf-game-comments-25-v1', 'Подборка DTF'], ['/specials/kpop-artists-admin-v1', 'Подборка K-pop'], ['/games/together?new=1', 'Комната друзей'], ['/partners', 'Игра для компании'], ['/legal/privacy', 'Конфиденциальность'], ['/ui-kit', 'UI Kit'],
  ].map(([path, label]) => link(path, label)).join('')}</ul></section><section><h2>Состояния аккаунта</h2><ul>${link('/profile', 'Профиль: гость', 'guest')}${link('/profile', 'Профиль: без истории', 'empty')}${link('/profile', 'Профиль: ошибка', 'error')}${link('/club', 'Клуб: активен', 'club')}${link('/club', 'Клуб: истёк', 'expired')}${link('/login', 'Форма входа (отправка заблокирована)', 'guest')}${link('/archive', 'Архив: пустой', 'empty')}${link('/archive', 'Архив: ошибка', 'error')}</ul><h2>Результат оплаты</h2><ul>${['pending', 'paid', 'failed', 'refunded'].map(state => link('/purchase/return?orderId=qa-order', state, state)).join('')}</ul></section><section><h2>Игровые экраны</h2><ul>${fixtures.MODES.map(mode => link(`/sessions/qa-${mode}-playing`, mode)).join('')}${link('/sessions/qa-movie-won', 'Победа')}${link('/sessions/qa-movie-lost', 'Поражение')}${link('/sessions/qa-connections-playing', 'Связи: поле')}${link('/sessions/qa-connections-won', 'Связи: результат')}${link('/sessions/qa-danetki-playing', 'Данетки: диалог')}${link('/sessions/qa-danetki-won', 'Данетки: разгадка')}${link(`/games/movie?play=movie&date=${fixtures.TODAY}&period=all&challenge=4`, 'Вызов друга (реальный URL parser)')}</ul></section>${roomPanel}</div><p>Текущий сценарий: <code>${escapeHtml(scenario)}</code>. Его отдельную cookie читает только этот QA-сервер. При смене сценария ссылка перезагружает приложение и его кеш запросов. <a href="/__qa/status">Состояние сервера</a>.</p></main></html>`
}

export function createReferencePreviewServer({ viteOrigin = process.env.QA_VITE_ORIGIN ?? 'http://127.0.0.1:5177', assetDirectory = publicDirectory } = {}) {
  const upstream = new URL(viteOrigin)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname) || upstream.port !== '5177' || !['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) throw new Error('QA_VITE_ORIGIN must be the local Vite origin on port 5177')
  const counts = { apiFixtures: 0, frontendRequests: 0 }
  return createServer(async (request, response) => {
    Object.entries(securityHeaders).forEach(([key, value]) => response.setHeader(key, value))
    try {
      const rawUrl = request.url ?? '/'
      if (!rawUrl.startsWith('/') || rawUrl.startsWith('//') || /[\\\x00-\x1f]/.test(rawUrl)) return json(response, 400, { code: 'QA_INVALID_PATH' })
      const url = new URL(rawUrl, 'http://localhost:5180')
      const decoded = decodeURIComponent(url.pathname)
      // Normalize once, disallow nested encoding, path traversal and alternate
      // separators before either route matching or proxying to Vite.
      if (decoded.includes('%') || decoded.includes('\\') || decoded.includes('\0') || decoded.includes('//') || decoded.split('/').some(part => part === '..' || part === '.')) return json(response, 400, { code: 'QA_INVALID_PATH' })
      url.pathname = decoded
      const scenario = readScenario(request, url)
      if (url.searchParams.has('qa')) response.setHeader('Set-Cookie', `${cookieName}=${scenario}; Path=/; SameSite=Lax; HttpOnly`)
      if (/^\/api(?:\/|$)/i.test(decoded)) { counts.apiFixtures += 1; return await handleApi(request, response, url, scenario) }
      if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) return unavailable(response, request.method ?? 'GET', decoded)
      if (decoded === '/__qa/status') return json(response, 200, { localOnly: true, apiForwarding: false, viteOrigin: upstream.origin, assetDirectory: resolve(assetDirectory), scenario, scenarios: fixtures.SCENARIOS, counts })
      if (decoded === '/__qa' || decoded === '/__qa/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return response.end(qaIndex(scenario)) }
      if (decoded === '/@vite/client') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return response.end(viteClient) }
      if (/^\/(?:data|city-content)(?:\/|$)/i.test(decoded)) return json(response, 404, { code: 'QA_RAW_CATALOG_NOT_SERVED' })
      const localFile = resolve(assetDirectory, `.${decoded}`)
      if (localFile.startsWith(`${resolve(assetDirectory)}${sep}`)) {
        let stat
        try { stat = statSync(localFile) } catch { /* Frontend routes need Vite's index fallback. */ }
        if (stat?.isFile()) {
          response.writeHead(200, { 'Content-Type': contentTypes[extname(localFile)] ?? 'application/octet-stream', 'Content-Length': stat.size })
          return request.method === 'HEAD' ? response.end() : createReadStream(localFile).pipe(response)
        }
      }
      if (/^\/(?:api|media)/i.test(decoded)) return json(response, 404, { code: 'QA_LOCAL_RESOURCE_NOT_FOUND' })
      counts.frontendRequests += 1
      const proxyRequest = (upstream.protocol === 'https:' ? httpsRequest : httpRequest)({
        protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port,
        path: `${url.pathname}${url.search}`, method: request.method, timeout: 10_000,
        // No incoming credentials, cookies, Host, Origin, or authorization.
        headers: { Accept: request.headers.accept ?? '*/*', 'Accept-Encoding': 'identity' },
      }, proxyResponse => {
        const status = proxyResponse.statusCode ?? 502
        if (status >= 300 && status < 400) { proxyResponse.resume(); return json(response, 502, { code: 'QA_FRONTEND_REDIRECT_BLOCKED' }) }
        const type = proxyResponse.headers['content-type'] ?? 'application/octet-stream'
        if (type.includes('text/html')) {
          let html = ''
          proxyResponse.setEncoding('utf8')
          proxyResponse.on('data', chunk => { html += chunk })
          proxyResponse.on('end', () => {
            const setup = `<style>.connected-preview-notice { display:none !important; }</style><script>try { localStorage.setItem('shoditsa:analytics-consent:v1','rejected'); } catch {}</script>`
            const label = `<a href="/__qa" style="position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:4px 9px;border:1px solid #d8d0e8;border-radius:999px;background:#f4efff;color:#353039;font:11px/1.3 system-ui;text-decoration:none" title="Локальные данные примера. Все записи заблокированы.">QA, ${escapeHtml(scenario)}, данные примера</a>`
            response.writeHead(status, { 'Content-Type': type })
            response.end(html.replace('<head>', `<head>${setup}`).replace('</body>', `${label}</body>`))
          })
        } else { response.writeHead(status, { 'Content-Type': type }); proxyResponse.pipe(response) }
      })
      proxyRequest.on('timeout', () => proxyRequest.destroy(new Error('Local Vite timed out')))
      proxyRequest.on('error', () => { if (!response.headersSent) json(response, 502, { code: 'QA_LOCAL_VITE_UNAVAILABLE', message: `Запустите локальный Vite на ${upstream.origin}. API наружу не перенаправляется.` }); else response.destroy() })
      response.on('close', () => proxyRequest.destroy())
      proxyRequest.end()
    } catch (error) {
      if (!response.headersSent) json(response, 400, { code: 'QA_INVALID_REQUEST', message: error instanceof Error ? error.message : 'Invalid local QA request' })
      else response.destroy()
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createReferencePreviewServer()
  server.listen(5180, '127.0.0.1', () => console.log('Reference QA: http://localhost:5180/__qa — all API responses are local fixtures; no API forwarding.'))
  const stop = () => server.close(() => process.exit(0))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
