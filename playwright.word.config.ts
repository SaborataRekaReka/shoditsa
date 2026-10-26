import { defineConfig } from '@playwright/test'
const node = `"${process.execPath}"`
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://shoditsa_app:semantic_local_test@127.0.0.1:55434/shoditsa'
export default defineConfig({
  testDir: './test/e2e', testMatch: 'word.spec.ts', fullyParallel: false, workers: 1, retries: 0, timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:5194', trace: 'retain-on-failure', reducedMotion: 'reduce', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
  webServer: [
    { command: `${node} node_modules/tsx/dist/cli.mjs apps/api/src/server.ts`, url: 'http://127.0.0.1:3014/api/v1/health/ready', reuseExistingServer: false, timeout: 120_000, env: { DATABASE_URL: databaseUrl, PORT: '3014', LOG_LEVEL: 'warn', AUTH_EMAIL_ENABLED: 'false', BETTER_AUTH_URL: 'http://127.0.0.1:5194', TRUSTED_ORIGINS: 'http://127.0.0.1:5194' } },
    { command: `${node} node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5194 --strictPort`, url: 'http://127.0.0.1:5194', reuseExistingServer: false, timeout: 120_000, env: { VITE_API_PROXY_TARGET: 'http://127.0.0.1:3014' } },
  ],
})
