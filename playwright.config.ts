import { defineConfig, devices } from '@playwright/test'

const apiEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://shoditsa_app:shoditsa_dev@localhost:5434/shoditsa',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'playwright-secret-at-least-32-characters',
  BETTER_AUTH_URL: 'http://127.0.0.1:5174',
  TRUSTED_ORIGINS: 'http://127.0.0.1:5174',
  PROMO_CODE_PEPPER: process.env.PROMO_CODE_PEPPER ?? 'playwright-pepper-at-least-32-characters',
  AUTH_EMAIL_ENABLED: 'false',
  PORT: '3002',
  LOG_LEVEL: 'warn',
} as Record<string, string>

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  retries: 1,
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npx tsx apps/api/src/server.ts', url: 'http://127.0.0.1:3002/api/v1/health/ready', reuseExistingServer: true, timeout: 120_000, env: apiEnv },
    { command: 'npm run dev:web -- --host 127.0.0.1 --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: true, timeout: 120_000, env: { ...process.env, VITE_CACHE_DIR: '.tmp/vite-e2e', VITE_API_PROXY_TARGET: 'http://127.0.0.1:3002' } },
  ],
})
