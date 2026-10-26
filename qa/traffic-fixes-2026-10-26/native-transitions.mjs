// One-off native animation browser observation. New local context only; no user browser or production.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const origin = 'http://127.0.0.1:5197';
const result = { capturedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim(), scope: 'Fresh Chromium, localhost fixture only, native motion enabled, no API writes or external requests.', routes: [], pageErrors: [], consoleErrors: [], blockedExternal: [], blockedWrites: [], clientErrors: [] };
const save = () => writeFile(new URL('native-transitions.json', import.meta.url), JSON.stringify(result, null, 2));
const status = await (await fetch(origin + '/__qa/status')).json();
if (!status.localOnly || status.apiForwarding !== false) throw new Error('Fixture is not explicitly isolated.');
result.fixture = { localOnly: status.localOnly, apiForwarding: status.apiForwarding, source: status.source };
const browser = await chromium.launch({ headless: true });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('shoditsa:analytics-consent:v1', 'rejected');
    window.__qaMotion = { nativeCalls: [], skips: 0, unhandled: [] };
    const original = document.startViewTransition?.bind(document);
    if (original) document.startViewTransition = (...args) => {
      window.__qaMotion.nativeCalls.push({ path: location.pathname, at: performance.now(), visibility: document.visibilityState });
      const transition = original(...args);
      const skip = transition.skipTransition.bind(transition);
      transition.skipTransition = () => { window.__qaMotion.skips++; return skip(); };
      // Do not attach handlers to any promise here: that could conceal an application rejection.
      return transition;
    };
    addEventListener('unhandledrejection', event => window.__qaMotion.unhandled.push(String(event.reason?.message ?? event.reason)));
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { result.blockedExternal.push(url.origin + url.pathname); return route.abort(); }
    if (url.pathname === '/api/v1/client-events/batch') {
      const data = request.postDataJSON();
      for (const event of data.events ?? []) if (event.eventName === 'client_error') result.clientErrors.push({ message: event.properties?.message, phase: event.properties?.phase, component: event.properties?.component, appVersion: event.appVersion });
      return route.fulfill({ json: { accepted: data.events?.length ?? 0, duplicates: 0, rejected: 0 } });
    }
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      result.blockedWrites.push({ path: url.pathname, method: request.method() });
      return route.fulfill({ status: 409, json: { error: { code: 'QA_NO_MUTATION', message: 'Local navigation observation only' } } });
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  await page.goto(origin + '/?qa=club', { waitUntil: 'domcontentloaded' });
  await page.locator('a[href="/games/character"]').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('heading', { level: 1, name: 'Все сойдется!' }).waitFor({ state: 'visible' });
  result.environment = await page.evaluate(() => ({ visibility: document.visibilityState, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, nativeAvailable: typeof document.startViewTransition === 'function', sourcePath: location.pathname }));
  const snapshot = async label => {
    const state = await page.evaluate(() => {
      const grouped = {};
      for (const node of document.querySelectorAll('*')) {
        if (!node.checkVisibility?.({ visibilityProperty: true, opacityProperty: true })) continue;
        const name = getComputedStyle(node).viewTransitionName;
        if (name && name !== 'none' && name !== 'match-element') (grouped[name] ??= []).push(node.tagName.toLowerCase() + '.' + String(node.className).split(/\s+/).slice(0, 3).join('.'));
      }
      const rail = document.querySelector('.qg-rail');
      return { path: location.pathname, title: document.title, heading: document.querySelector('h1')?.textContent?.trim(), transitioning: document.documentElement.hasAttribute('data-study-transitioning'), duplicateNames: Object.entries(grouped).filter(([, elements]) => elements.length > 1), nativeCalls: window.__qaMotion.nativeCalls.length, skips: window.__qaMotion.skips, rail: rail ? { width: rail.getBoundingClientRect().width, cssWidth: getComputedStyle(rail).width, variable: getComputedStyle(rail).getPropertyValue('--study-rail-width'), attributes: [...rail.attributes].map(attr => [attr.name, attr.value]), parentClass: rail.parentElement?.className } : null };
    });
    result.routes.push({ label, ...state });
  };
  await snapshot('initial');
  // First pass uses real, already rendered links. Following clicks do not wait for animations to settle.
  for (let round = 0; round < 3; round++) {
    for (const href of ['/games/character', '/games/animal', '/profile', '/']) {
      const links = page.locator('a[href="' + href + '"]');
      let target;
      for (const link of await links.all()) if (await link.isVisible()) { target = link; break; }
      if (!target) throw new Error('No visible link to ' + href + ' from ' + new URL(page.url()).pathname);
      // Native transition snapshots can intercept pointer hit-testing; keyboard activation
      // targets the real link and allows the next navigation before its animation completes.
      await target.focus();
      await target.press('Enter', { timeout: 5000 });
      const expected = { '/games/character': 'Угадай персонажа', '/games/animal': 'Угадай животное', '/profile': 'Профиль', '/': 'Все сойдется!' }[href];
      await page.waitForFunction(({ path, heading }) => location.pathname === path && [...document.querySelectorAll('h1')].some(node => node.checkVisibility() && (path === '/profile' ? node.id === 'application-profile-title' && !!node.textContent?.trim() : node.textContent?.trim() === heading)), { path: href, heading: expected }, { timeout: 15000 });
      await snapshot('round-' + (round + 1) + ':' + href);
    }
  }
  await page.waitForTimeout(700);
  await snapshot('settled');
  result.motion = await page.evaluate(() => window.__qaMotion);
  result.finalUrl = page.url();
  result.documentNavigations = await page.evaluate(() => performance.getEntriesByType('navigation').map(entry => ({ type: entry.type, name: entry.name })));
  result.passed = result.environment.visibility === 'visible'
    && result.environment.reducedMotion === false
    && result.motion.nativeCalls.length > 1
    && result.pageErrors.length === 0
    && result.motion.unhandled.length === 0
    && result.clientErrors.length === 0
    && result.routes.every(route => route.duplicateNames.length === 0)
    && result.routes.at(-1)?.path === '/'
    && result.routes.at(-1)?.transitioning === false;
  await page.screenshot({ path: new URL('native-transitions.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: false });
  await context.close();
} catch (error) {
  result.failure = String(error?.stack ?? error);
  result.failureState = await page?.evaluate(() => ({ path: location.pathname, title: document.title, headings: [...document.querySelectorAll('h1')].map(node => node.textContent), bodyText: document.body.innerText.slice(0, 2200), motion: window.__qaMotion, transitioning: document.documentElement.hasAttribute('data-study-transitioning') })).catch(() => null);
} finally { await browser.close(); await save(); }
console.log(JSON.stringify({ passed: result.passed, environment: result.environment, routes: result.routes, nativeCalls: result.motion?.nativeCalls.length, skips: result.motion?.skips, pageErrors: result.pageErrors, unhandled: result.motion?.unhandled, clientErrors: result.clientErrors, blockedWrites: result.blockedWrites, failure: result.failure }));
if (!result.passed) process.exitCode = 1;
