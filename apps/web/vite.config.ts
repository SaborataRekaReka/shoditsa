import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { cp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { referenceApiDevProfile } from './src/dev/reference-api-proxy'
import { studyAccountRequest } from './src/dev/quest-game/account-routing'

export default defineConfig(({ command, mode }) => {
  const yandexBuild = mode === 'yandex'
  const localRedesign = command === 'serve' && process.env.VITE_LOCAL_REDESIGN === '1'
  const referenceApi = command === 'serve' && process.env.VITE_REFERENCE_API === '1'
  const questStudy = command === 'serve' && localRedesign && process.env.VITE_QUEST_STUDY === '1'
  if (referenceApi && (yandexBuild || localRedesign)) {
    throw new Error('Reference API preview requires server mode, without VITE_LOCAL_REDESIGN.')
  }
  const connectedPreview = referenceApi ? referenceApiDevProfile({
    certificatePath: process.env.REFERENCE_API_CERT,
    keyPath: process.env.REFERENCE_API_KEY,
    canonicalOrigin: process.env.REFERENCE_API_CANONICAL_ORIGIN === '1',
    port: process.env.REFERENCE_API_PORT ? Number(process.env.REFERENCE_API_PORT) : undefined,
  }) : null
  const outDir = fileURLToPath(new URL('../../dist', import.meta.url))
  const sharedPublicDir = fileURLToPath(new URL('../../public', import.meta.url))
  const protectServerAnswers: Plugin = {
    name: 'protect-server-answer-data',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (questStudy && (html.includes('data-quest-skin="shoditsa"') || context.path === '/index.html')) html = html.replace('</head>', `
          <script>document.documentElement.setAttribute('data-study-js', ''); document.documentElement.setAttribute('data-study-booting', ''); setTimeout(() => document.documentElement.removeAttribute('data-study-booting'), 2500);</script>
          <link rel="stylesheet" href="/src/styles/quest-study-tokens.css" />
          <link rel="stylesheet" href="/src/styles/reference-tokens.css" />
          <link rel="stylesheet" href="/src/styles/shoditsa-study-tokens.css" />
          <link rel="stylesheet" href="/src/components/ui/QuestPrimitives.css" />
          <link rel="stylesheet" href="/src/dev/quest-game/quest-game.css" />
          <link rel="stylesheet" href="/src/dev/quest-game/study-shell.css" />
          <link rel="stylesheet" href="/src/dev/quest-home/home-variants.css" />
          <link rel="stylesheet" href="/src/dev/quest-home/home-promo-hero.css" />
          <link rel="preload" href="/fonts/reference/roboto-regular.ttf" as="font" type="font/ttf" crossorigin />
          <link rel="preload" href="/fonts/reference/roboto-bold.ttf" as="font" type="font/ttf" crossorigin />
          <link rel="preload" href="/fonts/reference/manrope-variable.ttf" as="font" type="font/ttf" crossorigin />
          <link rel="preload" href="/fonts/reference/caveat-bold.ttf" as="font" type="font/ttf" crossorigin />
          <link rel="stylesheet" href="/src/dev/quest-game/study-navigation.css" />
          <script type="module" blocking="render" src="/src/dev/quest-game/prepare-study-navigation.ts"></script>
        </head>`)
        if (yandexBuild && !localRedesign) return html
        html = html.replace('<html lang="ru">', '<html lang="ru" data-quest-skin="shoditsa" data-public-theme="reference" data-quest-tone="light">')
          .replace('name="theme-color" content="#2b060a"', 'name="theme-color" content="#fdfcfd"')
        return html.replace(/\s*<!-- Yandex Games SDK \(required for moderation\) -->\s*<script src="\/sdk\.js"><\/script>/, '')
      },
    },
    configureServer(server) {
      if (questStudy) {
        server.middlewares.use((request, response, next) => {
          const titleRequest = studyAccountRequest(String(request.url ?? '/'))
          if (titleRequest && request.method === 'GET') {
            response.setHeader('X-Robots-Tag', 'noindex, nofollow')
            request.url = titleRequest
          }
          next()
        })
      }
      if (localRedesign) {
        server.middlewares.use((request, response, next) => {
          const pathname = String(request.url ?? '').split('?', 1)[0]
          if (pathname.startsWith('/api/')) {
            // Only this public GET can reach the optional read-only rating bridge.
            if (pathname === '/api/v1/leaderboard' && request.method === 'GET') return next()
            response.statusCode = 404
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ code: 'LOCAL_PREVIEW_ONLY', message: 'Autonomous local preview' }))
            return
          }
          next()
        })
      }
      if (yandexBuild) return
      server.middlewares.use((request, response, next) => {
        const pathname = String(request.url ?? '').split('?', 1)[0]
        if (pathname === '/data' || pathname.startsWith('/data/') || pathname === '/city-content' || pathname.startsWith('/city-content/')) {
          response.statusCode = 404
          response.end()
          return
        }
        next()
      })
    },
    async closeBundle() {
      if (yandexBuild) return
      await rm(join(outDir, 'data'), { recursive: true, force: true })
      await rm(join(outDir, 'city-content'), { recursive: true, force: true })
      for (const entry of await readdir(sharedPublicDir, { withFileTypes: true })) {
        if (entry.name === 'data' || entry.name === 'city-content') continue
        await cp(join(sharedPublicDir, entry.name), join(outDir, entry.name), { recursive: entry.isDirectory(), force: true })
      }
    },
  }

  return ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: process.env.VITE_CACHE_DIR || fileURLToPath(new URL('../../.tmp/vite-web', import.meta.url)),
  // Dev keeps Vite's public middleware (with /data blocked above). The server
  // build copies only safe UI assets; Yandex keeps the autonomous full bundle.
  publicDir: yandexBuild || command === 'serve' ? sharedPublicDir : false,
  plugins: [...(connectedPreview ? [connectedPreview.plugin] : []), protectServerAnswers, react()],
  server: connectedPreview?.server ?? {
    port: 5173,
    proxy: {
      ...(localRedesign ? { '/api/v1/leaderboard': process.env.VITE_LEADERBOARD_API_PROXY_TARGET || 'http://127.0.0.1:3003' } : {}),
      '/api': process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001',
    },
  },
  // Yandex Games requires relative paths inside the ZIP. The hosted SPA must use
  // root-relative assets so direct loads of /admin/* do not request /admin/assets/*.
  base: yandexBuild ? './' : '/',
  build: {
    outDir,
    emptyOutDir: true,
  },
  })
})
