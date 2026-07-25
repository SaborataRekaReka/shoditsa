import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: /responsive-layout\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5176',
    colorScheme: 'dark',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'small-mobile', use: { ...devices['iPhone SE'] } },
    { name: 'mobile-landscape', use: { ...devices['iPhone SE'], viewport: { width: 667, height: 375 } } },
    { name: 'tablet', use: { ...devices['iPad Mini'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], browserName: 'webkit' } },
    { name: 'wide-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 2560, height: 1440 } } },
  ],
  webServer: {
    command: 'npm run dev:web -- --host 127.0.0.1 --port 5176',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_CACHE_DIR: '.tmp/vite-responsive-ui',
    },
  },
})
