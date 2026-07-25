import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: /ui-kit-contract\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5175',
    colorScheme: 'dark',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    { name: 'ui-kit-chromium' },
  ],
  webServer: {
    command: 'npm run dev:web -- --host 127.0.0.1 --port 5175',
    url: 'http://127.0.0.1:5175/ui-kit',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_CACHE_DIR: '.tmp/vite-ui-kit-contract',
    },
  },
})
