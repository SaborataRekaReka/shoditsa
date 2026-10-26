import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:5197';
const status = await (await fetch(origin + '/__qa/status')).json();
if (!status.localOnly || status.apiForwarding !== false) throw new Error('Not an isolated fixture');
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const motion of ['no-preference', 'reduce']) {
    const result = { motion, errors: [], console: [], snapshots: [] };
    results.push(result);
    const context = await browser.newContext({ reducedMotion: motion, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      localStorage.setItem('shoditsa:analytics-consent:v1', 'rejected');
      window.__qaNative = [];
      const original = document.startViewTransition?.bind(document);
      if (original) document.startViewTransition = callback => {
        const record = { startedAt: performance.now(), stack: new Error().stack, callbackEntered: false, callbackReturned: false };
        window.__qaNative.push(record);
        return original(async () => {
          record.callbackEntered = true;
          try { await callback(); record.callbackReturned = true; }
          catch (error) { record.callbackError = String(error); throw error; }
        });
      };
    });
    await context.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin) return route.abort();
      if (!['GET','HEAD','OPTIONS'].includes(request.method())) return route.fulfill({ status: 200, json: { accepted: 0, duplicates: 0, rejected: 0 } });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if (['error','warning'].includes(message.type())) result.console.push(message.text()); });
    await page.goto(origin + '/?qa=club', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.evaluate(async () => { window.__qaRouter = (await import('/src/app/router.tsx')).appRouter; });
    const snapshot = async label => result.snapshots.push(await page.evaluate(label => ({
      label, path: location.pathname, heading: document.querySelector('h1')?.textContent, native: window.__qaNative,
      visibility: document.visibilityState, transitioning: document.documentElement.hasAttribute('data-study-transitioning'),
      router: { location: window.__qaRouter.state.location.pathname, resolved: window.__qaRouter.state.resolvedLocation?.pathname, status: window.__qaRouter.state.status, loading: window.__qaRouter.state.isLoading, matches: window.__qaRouter.state.matches.map(m=>({id:m.id,status:m.status})), pending: window.__qaRouter.state.pendingMatches?.map(m=>({id:m.id,status:m.status})) },
    }),label));
    await snapshot('initial-3s');
    await page.waitForTimeout(3000);
    await snapshot('initial-6s');
    await page.locator('a[href="/games/character"]').first().click({ force: true });
    await page.waitForTimeout(3000);
    await snapshot('character-3s');
    await page.screenshot({ path: new URL('native-diagnosis-' + motion + '.png', import.meta.url).pathname.replace(/^\/(\w:)/,'$1'), fullPage: false });
    await context.close();
  }
} finally { await browser.close(); await writeFile(new URL('native-transition-diagnosis.json', import.meta.url), JSON.stringify(results, null, 2)); }
console.log(JSON.stringify(results));
