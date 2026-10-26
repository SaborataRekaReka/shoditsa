// Isolated application QA. No existing browser/profile, user cookies or production API.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const output = new URL('./', import.meta.url);
await mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true});
const results = [];
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce'});
    const page = await context.newPage();
    const errors = [];
    let attemptRequests = 0;
    let currentSession;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:5197') return route.abort();
      if (url.pathname === '/api/v1/games/qa-character-playing' && route.request().method() === 'GET') {
        const response = await route.fetch();
        const json = await response.json();
        currentSession = {...json.session, attempts: [], attemptsCount: 0, attemptsRemaining: 10};
        return route.fulfill({json: {session: currentSession}});
      }
      if (url.pathname === '/api/v1/games/qa-character-playing/attempts') {
        attemptRequests++;
        return route.fulfill({status: 409, json: {error: {code: 'QA_NO_MUTATION', message: 'Изолированная проверка: ход не сохраняется.'}}});
      }
      return route.continue();
    });
    await page.goto('http://127.0.0.1:5197/sessions/qa-character-playing?qa=guest');
    await page.getByRole('textbox', {name: 'Имя персонажа'}).waitFor();
    await page.screenshot({path: new URL(`character-${width}-initial.png`, output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true});
    const introBefore = await page.locator('.character-first-move').boundingBox();
    await page.getByRole('button', {name: 'Шерлок Холмс', exact: true}).click();
    const input = page.getByRole('textbox', {name: 'Имя персонажа'});
    await page.getByRole('option').first().waitFor();
    const introAfter = await page.locator('.character-first-move').boundingBox();
    const option = await page.getByRole('option').first().boundingBox();
    await page.screenshot({path: new URL(`character-${width}-search.png`, output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true});
    const before = attemptRequests;
    const attempted = page.waitForResponse(response => response.url().endsWith('/attempts'));
    await input.press('Enter');
    await attempted;
    results.push({width, query: await input.inputValue(), introRemainsVisible: Boolean(introBefore && introAfter), firstResultWidth: option?.width, attemptRequests: attemptRequests - before, horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), errors});
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(new URL('character-browser-check.json', output), JSON.stringify({scope: 'isolated local fixtures, no production state',results}, null, 2));
console.log(JSON.stringify(results));
