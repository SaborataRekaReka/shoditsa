import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig(() => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: process.env.VITE_CACHE_DIR || fileURLToPath(new URL('../../.tmp/vite-web', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001' },
  },
  // Yandex Games requires relative paths since the game is served from a ZIP archive
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../../dist', import.meta.url)),
    emptyOutDir: true,
  },
}))
