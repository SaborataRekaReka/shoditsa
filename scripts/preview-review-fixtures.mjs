import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { createServer } from 'vite'
import { createReferencePreviewServer, qaIndex } from './qa/reference-preview.mjs'
import { SCENARIOS } from './qa/reference-fixtures.mjs'
import { createReviewRoomApi } from './qa/review-room-api.mjs'

// One current source tree and one browser origin. API examples stay in-process;
// the old presentation proxy and its separately built frontend are not started.
const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.REVIEW_PORT ?? 5180)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid REVIEW_PORT')
Object.assign(process.env, {
  VITE_LOCAL_REDESIGN: '1', VITE_REFERENCE_API: '0', VITE_QUEST_STUDY: '0',
  VITE_PUBLIC_THEME: 'reference', VITE_CACHE_DIR: resolve(root, '.tmp/vite-unified-review'),
})

const cookieName = 'reference_qa_scenario'
const fixtureServer = createReferencePreviewServer()
const roomStateDirectory = resolve(root, '.tmp/local-review')
const roomStateFile = resolve(roomStateDirectory, 'rooms.json')
mkdirSync(roomStateDirectory, { recursive: true })
let initialRooms = []
try { initialRooms = JSON.parse(readFileSync(roomStateFile, 'utf8').replace(/^\uFEFF/, '')).rooms ?? [] } catch (error) { if (error.code !== 'ENOENT') throw error }
const reviewRooms = createReviewRoomApi({ initialRooms, onChange: rooms => {
  writeFileSync(`${roomStateFile}.tmp`, JSON.stringify({ rooms }, null, 2))
  renameSync(`${roomStateFile}.tmp`, roomStateFile)
} })
const plugin = {
  name: 'single-origin-local-review', enforce: 'pre',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const host = request.headers.host ?? ''
      if (!new RegExp(`^(?:127\\.0\\.0\\.1|localhost):${port}$`).test(host)) {
        response.statusCode = 403; response.end('Local preview only'); return
      }
      const raw = request.url ?? '/'
      if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x1f]|%(?:2f|5c|25)/i.test(raw)) {
        response.statusCode = 400; response.end('Invalid preview path'); return
      }
      const url = new URL(raw, `http://${host}`)
      const selected = url.searchParams.get('qa')
      const cookies = (request.headers.cookie ?? '').split(';').map(item => item.trim()).filter(Boolean)
      const saved = cookies.find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
      const scenario = SCENARIOS.includes(selected) ? selected : SCENARIOS.includes(saved) ? saved : 'club'
      // This scenario cookie belongs only to the isolated fixture server.
      request.headers.cookie = [...cookies.filter(item => !item.startsWith(`${cookieName}=`)), `${cookieName}=${scenario}`].join('; ')
      if (saved !== scenario) response.setHeader('Set-Cookie', `${cookieName}=${scenario}; Path=/; SameSite=Lax; HttpOnly`)
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('X-Robots-Tag', 'noindex, nofollow')
      if (url.pathname === '/__qa/status') {
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ localOnly: true, singlePort: true, source: 'working-tree', apiForwarding: false, port, scenario, scenarios: SCENARIOS, localSvoyak: false, localRoomSetup: 'local state; start shows sample game; answers and AI remain fixtures' })); return
      }
      if (url.pathname === '/__qa' || url.pathname === '/__qa/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(qaIndex(scenario, { localSvoyak: false })
          .replace('Изолированный QA, только localhost:5180', `Единый просмотр, 127.0.0.1:${port}`)
          .replace('Авторизация, платежи, сохранение профиля, игровые ответы и AI не выполняются.', 'Данные аккаунта и обычных игровых сеансов — примеры для просмотра. Авторизация, платежи и сохранение профиля не выполняются. Своя игра проверяется через подключённый просмотр и настоящий API.'))
        return
      }
      if (await reviewRooms(request, response, url, scenario)) return
      if (/^\/(?:api|__qa|data|city-content|media)(?:\/|$)/i.test(url.pathname)) {
        fixtureServer.emit('request', request, response); return
      }
      next()
    })
  },
  transformIndexHtml(html) {
    return html.replace('<head>', `<head><script>try { localStorage.setItem('shoditsa:analytics-consent:v1','rejected'); } catch {}</script><style>.review-state-switcher{position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:4px 9px;border:1px solid #d8d0e8;border-radius:999px;background:#f4efff;color:#353039;font:11px/1.3 system-ui;text-decoration:none}@media(max-width:860px){.review-state-switcher{bottom:calc(82px + env(safe-area-inset-bottom))}}</style>`)
      .replace('</body>', `<a class="review-state-switcher" href="/__qa" title="Один проект из текущих исходников. Данные аккаунта и обычных игр — локальные примеры.">Просмотр, состояния</a></body>`)
  },
}

const vite = await createServer({
  configFile: resolve(root, 'apps/web/vite.config.ts'), mode: 'development', plugins: [plugin],
  server: { host: '127.0.0.1', port, strictPort: true, open: false },
})
await vite.listen()
console.log(`Unified review: http://127.0.0.1:${port}/ — current sources; local examples; no production API forwarding.`)
console.log(`Screens and account states: http://127.0.0.1:${port}/__qa`)
const stop = async () => { await vite.close(); process.exit(0) }
process.once('SIGINT', stop); process.once('SIGTERM', stop)
