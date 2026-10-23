import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Current UI + the real API, on the one origin used for manual review.
// Offline fixtures remain an explicit opt-in via npm run preview:fixtures.
const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.REVIEW_PORT ?? 5180)
const yandex = process.argv.includes('--yandex')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid REVIEW_PORT')
Object.assign(process.env, {
  VITE_LOCAL_REDESIGN: '0', VITE_REFERENCE_API: '1', VITE_QUEST_STUDY: '0',
  VITE_LOCAL_SVOYAK: '0',
  VITE_PUBLIC_THEME: 'reference', VITE_CACHE_DIR: resolve(root, '.tmp/vite-connected-review'),
  VITE_API_BASE_URL: '/api/v1', VITE_AUTH_BASE_URL: '/api/auth',
  REFERENCE_API_PORT: String(port), REFERENCE_API_CANONICAL_ORIGIN: yandex ? '1' : '0',
  REFERENCE_API_CERT: yandex ? process.env.REFERENCE_API_CERT || resolve(root, '.tmp/reference-yandex/shoditsa-local.pem') : '',
  REFERENCE_API_KEY: yandex ? process.env.REFERENCE_API_KEY || resolve(root, '.tmp/reference-yandex/shoditsa-local-key.pem') : '',
})

const vite = await createServer({
  configFile: resolve(root, 'apps/web/vite.config.ts'), mode: 'reference-api',
  server: { host: '127.0.0.1', port, strictPort: true, open: false },
  plugins: [{
    name: 'connected-review-status',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        response.setHeader('X-Robots-Tag', 'noindex, nofollow')
        // Remove the old fixture selector; never manufacture a logged-in user.
        response.setHeader('Set-Cookie', 'reference_qa_scenario=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly')
        if (request.url?.split('?', 1)[0] === '/__qa/status') {
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify({ source: 'working-tree', port, apiForwarding: true, apiTarget: 'https://shoditsa.ru', fixtures: false, localSvoyak: false, yandex }))
          return
        }
        if (/^\/__qa(?:\/|\?|$)/.test(request.url ?? '')) {
          response.statusCode = 404
          response.end('Fixture scenarios are unavailable in the connected review.')
          return
        }
        next()
      })
    },
  }],
})
await vite.listen()
console.log(`Connected review: ${yandex ? 'https://shoditsa.ru (dedicated local browser)' : `http://127.0.0.1:${port}/`} — current UI + real API, port ${port}.`)
console.log(`Sign in with ${yandex ? 'Yandex or email/password' : 'email/password'}. Account, progress and standard rooms use the real API; no fixtures.`)
if (!yandex) console.log('Svoyak uses the same production API and PostgreSQL rooms as the main site; creator membership is verified by the real account API.')
const stop = async () => { await vite.close(); process.exit(0) }
process.once('SIGINT', stop); process.once('SIGTERM', stop)
