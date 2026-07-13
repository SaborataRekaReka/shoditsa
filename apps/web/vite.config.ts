import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { cp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export default defineConfig(({ command, mode }) => {
  const yandexBuild = mode === 'yandex'
  const outDir = fileURLToPath(new URL('../../dist', import.meta.url))
  const sharedPublicDir = fileURLToPath(new URL('../../public', import.meta.url))
  const protectServerAnswers: Plugin = {
    name: 'protect-server-answer-data',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (yandexBuild) return html
        return html.replace(/\s*<!-- Yandex Games SDK \(required for moderation\) -->\s*<script src="\/sdk\.js"><\/script>/, '')
      },
    },
    configureServer(server) {
      if (yandexBuild) return
      server.middlewares.use((request, response, next) => {
        const pathname = String(request.url ?? '').split('?', 1)[0]
        if (pathname === '/data' || pathname.startsWith('/data/')) {
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
      for (const entry of await readdir(sharedPublicDir, { withFileTypes: true })) {
        if (entry.name === 'data') continue
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
  plugins: [protectServerAnswers, react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001' },
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
