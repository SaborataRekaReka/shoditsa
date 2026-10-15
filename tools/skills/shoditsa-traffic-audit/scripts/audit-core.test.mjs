import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { date, shift, dates, makeWindows, normalizeWebmaster, webmasterFreshness, summarizeWebmaster, normalizeMetrica, delta, sanitizeDimension } from './audit-core.mjs';
import { collect, fixtureKey } from './collect-yandex-history.mjs';

test('young project never manufactures a pre-launch zero baseline', () => {
  const w = makeWindows('2026-08-10', '2026-07-20');
  assert.equal(w.observedDays, 22);
  assert.equal(w.comparisons['7d'].status, 'ready');
  assert.equal(w.comparisons['14d'].status, 'insufficient_history');
  assert.equal(w.comparisons['14d'].previous, null);
  assert.equal(w.context31.from, '2026-07-20');
  assert.equal(w.comparisons['28d'].status, 'insufficient_history');
});
test('56-day history enables disjoint 28/28 with inclusive date arithmetic', () => {
  const w = makeWindows('2026-10-12', '2026-08-18');
  assert.equal(w.observedDays, 56);
  assert.deepEqual(w.comparisons['28d'].current, { from: '2026-09-15', to: '2026-10-12' });
  assert.deepEqual(w.comparisons['28d'].previous, { from: '2026-08-18', to: '2026-09-14' });
  assert.throws(() => date('2026-02-30'));
});
test('trailing zeros are unconfirmed, explicit zero days remain available', () => {
  const rows = [{ date: '2026-10-11', impressions: 100, clicks: 10, position: 4 }, { date: '2026-10-12', impressions: 0, clicks: 0, position: 0 }];
  const conservative = webmasterFreshness(rows, '2026-10-12');
  assert.equal(conservative.through, '2026-10-11');
  assert.deepEqual(conservative.unconfirmedTrailingDates, ['2026-10-12']);
  assert.equal(webmasterFreshness(rows, '2026-10-12', '2026-10-12').through, '2026-10-12');
  const summary = summarizeWebmaster(rows, { from: '2026-10-11', to: '2026-10-12' });
  assert.equal(summary.totals.clicks, 10); assert.equal(summary.totals.ctrPercent, 10); assert.equal(summary.totals.weightedPosition, 4);
});
test('gaps do not become zero and position is impression-weighted', () => {
  const rows = normalizeWebmaster({ indicators: { TOTAL_SHOWS: [{ date: '2026-10-01', value: 10 }, { date: '2026-10-02', value: 90 }], TOTAL_CLICKS: [{ date: '2026-10-01', value: 2 }, { date: '2026-10-02', value: 9 }], AVG_SHOW_POSITION: [{ date: '2026-10-01', value: 1 }, { date: '2026-10-02', value: 9 }] } });
  assert.equal(summarizeWebmaster(rows, { from: '2026-10-01', to: '2026-10-02' }).totals.weightedPosition, 8.2);
  const incomplete = summarizeWebmaster(rows, { from: '2026-10-01', to: '2026-10-03' });
  assert.equal(incomplete.totals, null); assert.deepEqual(incomplete.missingDates, ['2026-10-03']);
  assert.equal(delta(0, null).absolute, null); assert.equal(delta(4, 0).relativePercent, null);
});
test('Metrica preserves period users, sampling/privacy and unavailable metrics', () => {
  const result = normalizeMetrica({ totals: [5, 3], data: [{ dimensions: [{ name: '2026-10-01' }], metrics: [3, 3] }, { dimensions: [{ name: '2026-10-02' }], metrics: [2, 2] }], sampled: true, sample_share: 0.5, contains_sensitive_data: true, total_rows: 4 }, ['visits', 'users', 'goal']);
  assert.equal(result.totals.users, 3); assert.equal(result.totals.goal, null);
  assert.equal(result.quality.privacySuppressed, true); assert.equal(result.quality.truncated, true);
  assert.equal(result.quality.sampleShare, 0.5);
  assert.equal(sanitizeDimension('https://shoditsa.ru/sessions/12345678-1234-1234-1234-123456789012?token=secret'), 'shoditsa.ru/sessions/[id]');
});
test('missing credentials make no network requests and yield unavailable/null sources', async () => {
  const keys = ['YANDEX_OAUTH_TOKEN', 'YANDEX_METRIKA_OAUTH_TOKEN', 'YANDEX_WEBMASTER_OAUTH_TOKEN', 'SHODITSA_YANDEX_TOKEN_DPAPI_FILE'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  for (const key of keys) delete process.env[key];
  globalThis.fetch = () => { throw new Error('No network call is allowed in this test'); };
  try {
    const result = await collect({ 'as-of': '2026-10-15', 'skip-details': true });
    assert.equal(result.status, 'unavailable');
    for (const source of Object.values(result.sources)) { assert.equal(source.reason, 'credentials_unavailable'); assert.equal(source.totals, null); }
  } finally { globalThis.fetch = originalFetch; for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; }
});
test('offline fixture verifies separate source lags and real zero reports without API access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shoditsa-audit-fixture-'));
  const fixturePath = join(dir, 'fixture.json');
  const responses = {};
  const put = (host, path, params, data) => { const u = new URL(path, host); for (const [key, value] of Object.entries(params)) for (const v of Array.isArray(value) ? value : [value]) u.searchParams.append(key, String(v)); responses[fixtureKey(u)] = { status: 'ok', data }; };
  const wm = 'https://api.webmaster.yandex.net', mm = 'https://api-metrika.yandex.net';
  put(wm, '/v4/user', {}, { user_id: 1 });
  put(wm, '/v4/user/1/hosts', {}, { hosts: [{ host_id: 'fixture-host', unicode_host_url: 'https://shoditsa.ru/' }] });
  const allDates = dates('2026-08-01', '2026-10-14');
  put(wm, '/v4/user/1/hosts/fixture-host/search-queries/all/history', { query_indicator: ['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION'], device_type_indicator: 'ALL', date_from: '2026-08-01', date_to: '2026-10-14' }, { indicators: Object.fromEntries(['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION'].map((key, i) => [key, allDates.map(d => ({ date: d, value: d > '2026-10-12' ? 0 : [100, 10, 5][i] }))])) });
  put(mm, '/management/v1/counter/110517987', {}, { counter: { site: 'shoditsa.ru', time_zone_name: 'Europe/Moscow' } });
  put(mm, '/management/v1/counter/110517987/goals', {}, { goals: [] });
  const metrikaMetrics = ['ym:s:visits', 'ym:s:users', 'ym:s:newUsers', 'ym:s:pageviews', 'ym:s:bounceRate', 'ym:s:pageDepth', 'ym:s:avgVisitDurationSeconds'];
  const historyParams = { ids: '110517987', date1: '2026-08-01', date2: '2026-10-14', filters: "ym:s:isRobot=='No'", dimensions: 'ym:s:date', metrics: metrikaMetrics.join(','), accuracy: 'full', limit: 10000, sort: 'ym:s:date' };
  put(mm, '/stat/v1/data', historyParams, { totals: [74, 20, 12, 148, 0, 2, 60], data: allDates.filter(d => d <= '2026-10-13').map(d => ({ dimensions: [{ name: d }], metrics: [1, 1, 1, 2, 0, 2, 60] })), sampled: false, sample_share: 1, contains_sensitive_data: false });
  await writeFile(fixturePath, JSON.stringify({ responses }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Fixture must never request the network'); };
  try {
    const result = await collect({ 'as-of': '2026-10-15', from: '2026-08-01', fixture: fixturePath, 'skip-details': true });
    assert.equal(result.mode, 'offline-fixture');
    assert.equal(result.sources.webmaster.freshness.through, '2026-10-12');
    assert.equal(result.sources.metrika.freshness.through, '2026-10-13');
    assert.equal(result.sources.webmaster.reports.current7d.totals.clicks, 70);
    assert.equal(result.sources.metrika.reports.current7d.all.totals, null);
    assert.equal(result.sources.metrika.reports.current7d.all.reason, 'fixture_response_not_provided');
    assert.equal(result.sources.metrika.history.totals['ym:s:users'], 20);
  } finally { globalThis.fetch = originalFetch; assert.ok(dir.startsWith(join(tmpdir(), 'shoditsa-audit-fixture-'))); await rm(dir, { recursive: true, force: true }); }
});
test('a rate limit stops subsequent requests for that source', async () => {
  const keys = ['YANDEX_OAUTH_TOKEN', 'YANDEX_METRIKA_OAUTH_TOKEN', 'YANDEX_WEBMASTER_OAUTH_TOKEN', 'SHODITSA_YANDEX_TOKEN_DPAPI_FILE'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.YANDEX_WEBMASTER_OAUTH_TOKEN = 'offline-test-placeholder';
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    if (url.pathname === '/v4/user') return new Response(JSON.stringify({ user_id: 1 }), { status: 200 });
    if (url.pathname === '/v4/user/1/hosts') return new Response(JSON.stringify({ hosts: [{ host_id: 'fixture', unicode_host_url: 'https://shoditsa.ru/' }] }), { status: 200 });
    if (url.pathname.endsWith('/all/history')) return new Response(JSON.stringify({ indicators: Object.fromEntries(['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION'].map((key, i) => [key, dates('2026-08-01', '2026-10-13').map(d => ({ date: d, value: [100, 10, 5][i] }))])) }), { status: 200 });
    return new Response('{}', { status: 429 });
  };
  try {
    const result = await collect({ 'as-of': '2026-10-15', from: '2026-08-01' });
    assert.equal(calls, 4);
    assert.equal(result.sources.webmaster.reports.current7d.queries.errors[0].reason, 'rate_limited');
    assert.equal(result.sources.metrika.reason, 'credentials_unavailable');
  } finally { globalThis.fetch = originalFetch; for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; }
});
