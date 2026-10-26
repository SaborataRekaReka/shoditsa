import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { date, shift, finite, unavailable, observationBoundary, makeWindows, normalizeWebmaster, webmasterFreshness, summarizeWebmaster, normalizeMetrica, sanitizeDimension } from './audit-core.mjs';

const FLAGS = new Set(['as-of', 'from', 'launch-date', 'counter-id', 'webmaster-host', 'webmaster-through', 'metrika-through', 'out', 'fixture', 'skip-details', 'help']);
function options(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !FLAGS.has(key)) throw new Error('Unknown option');
    if (['skip-details', 'help'].includes(key)) out[key] = true;
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value'); out[key] = args[++i]; }
  }
  return out;
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const METRICS = ['ym:s:visits', 'ym:s:users', 'ym:s:newUsers', 'ym:s:pageviews', 'ym:s:bounceRate', 'ym:s:pageDepth', 'ym:s:avgVisitDurationSeconds'];
const FILTERS = { all: "ym:s:isRobot=='No'", organic: "ym:s:isRobot=='No' AND ym:s:lastTrafficSource=='organic'" };
const INDICATORS = ['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION'];
function tokenFallback() {
  if (process.platform !== 'win32' || !process.env.SHODITSA_YANDEX_TOKEN_DPAPI_FILE) return null;
  const path = fileURLToPath(new URL('./read-yandex-token.ps1', import.meta.url));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  return result.status === 0 ? result.stdout.trim() || null : null;
}
function endpoint(base, path, params = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
  return url;
}
export function fixtureKey(url) { const query = new URLSearchParams(url.searchParams); query.sort(); return `${url.hostname}${url.pathname}${query.size ? '?' + query : ''}`; }
function getter(token, fixture) {
  let stopped = null;
  return async url => {
    if (fixture) { const item = fixture.responses?.[fixtureKey(url)]; return item ? structuredClone(item) : unavailable('fixture_response_not_provided'); }
    if (!token) return unavailable('credentials_unavailable');
    if (stopped) return unavailable(stopped.reason, stopped.httpStatus);
    if (!['api.webmaster.yandex.net', 'api-metrika.yandex.net'].includes(url.hostname) || url.protocol !== 'https:') return unavailable('endpoint_not_allowed');
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'error', headers: { Authorization: `OAuth ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        const reason = response.status === 429 ? 'rate_limited' : [401, 403].includes(response.status) ? 'authorization_rejected' : 'http_error';
        if ([401, 403, 429].includes(response.status)) stopped = { reason, httpStatus: response.status };
        return unavailable(reason, response.status);
      }
      return { status: 'ok', data: await response.json() };
    } catch { return unavailable('network_timeout_or_invalid_response'); }
  };
}
function sourceStatus(parts) { const statuses = parts.map(p => p?.status); return !statuses.length ? 'partial' : statuses.every(s => s === 'ok') ? 'ok' : statuses.some(s => s === 'ok' || s === 'partial') ? 'partial' : 'unavailable'; }
function periods(windows) {
  const out = { context31: windows.context31, fullObserved: windows.fullObserved };
  for (const [key, pair] of Object.entries(windows.comparisons)) if (pair.status === 'ready') { out[`current${key}`] = pair.current; out[`previous${key}`] = pair.previous; }
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value));
}
async function collectWebmaster(get, config) {
  const base = 'https://api.webmaster.yandex.net';
  const user = await get(endpoint(base, '/v4/user'));
  if (user.status !== 'ok' || !user.data?.user_id) return { ...unavailable(user.reason ?? 'invalid_user_response', user.httpStatus), timezone: 'Yandex source calendar' };
  const path = `/v4/user/${encodeURIComponent(user.data.user_id)}/hosts`;
  const hosts = await get(endpoint(base, path));
  if (hosts.status !== 'ok') return hosts;
  const candidates = (hosts.data?.hosts ?? []).filter(h => { try { return new URL(h.unicode_host_url ?? h.ascii_host_url).hostname === 'shoditsa.ru'; } catch { return false; } });
  const requested = config['webmaster-host'];
  const selected = requested ? candidates.find(h => h.host_id === requested) : candidates.find(h => String(h.ascii_host_url ?? h.unicode_host_url).startsWith('https://')) ?? candidates[0];
  if (!selected?.host_id) return unavailable('site_host_not_found');
  const prefix = `${path}/${encodeURIComponent(selected.host_id)}`;
  const raw = await get(endpoint(base, `${prefix}/search-queries/all/history`, { query_indicator: INDICATORS, device_type_indicator: 'ALL', date_from: config.from, date_to: config.yesterday }));
  if (raw.status !== 'ok') return { ...raw, host: 'https://shoditsa.ru' };
  const daily = normalizeWebmaster(raw.data).filter(r => r.date >= config.from && r.date <= config.yesterday);
  const boundary = observationBoundary(daily, 'impressions', config['launch-date']);
  const freshness = webmasterFreshness(daily, config.yesterday, config['webmaster-through']);
  const windows = makeWindows(freshness.through, boundary.from);
  const reports = {};
  for (const [key, period] of Object.entries(periods(windows))) {
    const total = summarizeWebmaster(daily, period);
    reports[key] = { ...total, queries: null };
    if (!config['skip-details'] && /^(current|previous)(7|14|28)d$/.test(key)) {
      const requests = [];
      for (const order of ['TOTAL_SHOWS', 'TOTAL_CLICKS']) requests.push(await get(endpoint(base, `${prefix}/search-queries/popular`, { query_indicator: INDICATORS, device_type_indicator: 'ALL', date_from: period.from, date_to: period.to, order_by: order, offset: 0, limit: 500 })));
      const byQuery = new Map();
      for (const r of requests.filter(r => r.status === 'ok')) for (const q of r.data?.queries ?? []) byQuery.set(q.query_text, { query: sanitizeDimension(q.query_text), indicators: q.indicators ?? null });
      reports[key].queries = { status: sourceStatus(requests), rows: requests.some(r => r.status === 'ok') ? [...byQuery.values()] : null, limitPerOrder: 500, completeness: 'top-query-sample-not-all-searches', errors: requests.filter(r => r.status !== 'ok').map(r => ({ reason: r.reason, httpStatus: r.httpStatus })) };
    }
  }
  const reportParts = Object.values(reports).flatMap(r => r.queries ? [r, r.queries] : [r]);
  return { status: daily.length ? sourceStatus([raw, ...reportParts]) : 'partial', host: 'https://shoditsa.ru', timezone: 'Yandex source calendar', boundary, freshness, windows, daily, reports, reason: daily.length ? null : 'no_daily_history_returned' };
}
async function collectMetrica(get, config) {
  const base = 'https://api-metrika.yandex.net', counterId = config['counter-id'] ?? '110517987';
  const counter = await get(endpoint(base, `/management/v1/counter/${encodeURIComponent(counterId)}`));
  if (counter.status !== 'ok') return { ...counter, counterId };
  const info = counter.data?.counter;
  let counterHostname = null;
  try { counterHostname = new URL(/^https?:\/\//i.test(String(info?.site)) ? info.site : `https://${info?.site}`).hostname; } catch { /* Invalid site is rejected below. */ }
  if (!info || counterHostname !== 'shoditsa.ru') return unavailable('counter_site_mismatch_or_invalid_response');
  const requestedThrough = config['metrika-through'] ?? config.yesterday;
  async function report(period, scope = 'all', dimensions = null, metrics = METRICS, extraFilter = null) {
    const result = await get(endpoint(base, '/stat/v1/data', { ids: counterId, date1: period.from, date2: period.to, filters: FILTERS[scope] + (extraFilter ? ` AND ${extraFilter}` : ''), dimensions, metrics: metrics.join(','), accuracy: 'full', limit: 10000, sort: dimensions === 'ym:s:date' ? 'ym:s:date' : undefined }));
    return result.status === 'ok' ? { ...normalizeMetrica(result.data, metrics), period, scope, dimensions } : { ...result, period, scope, dimensions };
  }
  const requestedPeriod = { from: config.from, to: requestedThrough };
  const history = await report(requestedPeriod, 'all', 'ym:s:date');
  if (history.status !== 'ok') return { ...history, counterId };
  const daily = history.rows.map(row => ({ date: row.dimensions[0], visits: row.metrics['ym:s:visits'], metrics: row.metrics }));
  const lastActivity = daily.filter(row => row.date <= requestedThrough && row.visits > 0).at(-1)?.date ?? null;
  const through = config['metrika-through'] ?? lastActivity;
  const boundary = observationBoundary(daily, 'visits', config['launch-date']);
  const windows = makeWindows(through, boundary.from);
  const reports = {};
  const goalsResult = await get(endpoint(base, `/management/v1/counter/${encodeURIComponent(counterId)}/goals`));
  const goals = goalsResult.status === 'ok' ? (goalsResult.data?.goals ?? []).map(g => ({ id: g.id, name: sanitizeDimension(g.name), type: g.type, conditions: (g.conditions ?? []).map(c => ({ type: c.type, url: sanitizeDimension(c.url) })) })) : null;
  for (const [key, period] of Object.entries(periods(windows))) {
    reports[key] = {};
    for (const scope of ['all', 'organic']) {
      const total = await report(period, scope);
      reports[key][scope] = { ...total, returning: await report(period, scope, null, ['ym:s:visits', 'ym:s:users'], "ym:s:isNewUser=='No'") };
      if (!config['skip-details'] && /^(current|previous)(7|14|28)d$/.test(key)) {
        const cuts = {};
        for (const [name, dim] of Object.entries({ sources: 'ym:s:lastTrafficSource', searchEngines: 'ym:s:lastSearchEngine', devices: 'ym:s:deviceCategory', landingPages: 'ym:s:startURL' })) cuts[name] = await report(period, scope, dim);
        reports[key][scope].breakdowns = cuts;
        if (goals) {
          const chunks = [];
          for (let i = 0; i < goals.length; i += 10) {
            const chunk = goals.slice(i, i + 10), metrics = chunk.flatMap(g => [`ym:s:goal${g.id}reaches`, `ym:s:goal${g.id}visits`]);
            chunks.push({ keys: chunk.map(g => ({ id: g.id, name: g.name })), ...await report(period, scope, null, metrics) });
          }
          reports[key][scope].goals = chunks;
        }
      }
    }
  }
  const reportParts = Object.values(reports).flatMap(r => [r.all, r.organic].flatMap(p => [p, p.returning, ...Object.values(p.breakdowns ?? {}), ...(p.goals ?? [])]));
  return { status: sourceStatus([history, goalsResult, ...reportParts]), counterId, timezone: info.time_zone_name ?? null, filters: FILTERS, freshness: { requestedThrough: config.yesterday, through, basis: config['metrika-through'] ? 'explicit-source-confirmation' : 'conservative-last-observed-activity', latestReturnedDate: daily.at(-1)?.date ?? null, trailingDatesUnconfirmed: through !== requestedThrough }, boundary, windows, history, reports, goals: { status: goalsResult.status, rows: goals, reason: goalsResult.reason ?? null } };
}
export async function collect(config) {
  const asOf = date(config['as-of'] ?? today()), yesterday = shift(asOf, -1);
  const from = date(config.from ?? shift(asOf, -120));
  if (from > yesterday) throw new Error('History start must precede audit date');
  for (const key of ['launch-date', 'webmaster-through', 'metrika-through']) if (config[key]) { date(config[key]); if (config[key] > yesterday) throw new Error('Source or launch boundary is in the future'); }
  if (config['counter-id'] && !/^\d+$/.test(config['counter-id'])) throw new Error('Invalid counter ID');
  const fixture = config.fixture ? JSON.parse(await readFile(resolve(config.fixture), 'utf8')) : null;
  const fallback = fixture ? null : tokenFallback();
  const tokens = { metrika: process.env.YANDEX_METRIKA_OAUTH_TOKEN || process.env.YANDEX_OAUTH_TOKEN || fallback, webmaster: process.env.YANDEX_WEBMASTER_OAUTH_TOKEN || process.env.YANDEX_OAUTH_TOKEN || fallback };
  const settings = { ...config, from, yesterday };
  const sources = {};
  // Independent credentials/limits: a failed Webmaster token does not suppress Metrica.
  for (const [name, fn] of [['webmaster', collectWebmaster], ['metrika', collectMetrica]]) {
    try { sources[name] = await fn(getter(tokens[name], fixture), settings); }
    catch { sources[name] = unavailable('collection_error'); }
  }
  return { schemaVersion: 1, kind: 'shoditsa-yandex-history', site: 'https://shoditsa.ru', auditDate: asOf, capturedAt: new Date().toISOString(), mode: fixture ? 'offline-fixture' : 'live-read-only', requestedHistory: { from, to: yesterday }, status: sourceStatus(Object.values(sources)), definitions: { internalRawRetentionDays: 38, missingValues: 'null-not-zero', distinctUsers: 'period-API-totals-not-summed-daily', sourceCalendars: 'independent-not-one-cross-source-funnel' }, sources, limitations: ['Google Search Console and production game statistics must be collected separately.', 'Webmaster trailing zero dates may be delayed or genuinely zero; excluded unless confirmed.', 'Metrica small landing groups can be privacy-suppressed; visible share is not tracking coverage.'] };
}
async function main() {
  const config = options(process.argv.slice(2));
  if (config.help) { console.log('Read-only shoditsa Yandex history. Options: --as-of DATE --from DATE --launch-date DATE --counter-id ID --webmaster-host ID --webmaster-through DATE --metrika-through DATE --out PATH --fixture PATH --skip-details. Tokens: environment or explicitly configured DPAPI file; never CLI values.'); return; }
  const snapshot = await collect(config);
  if (config.out) { const output = resolve(config.out); await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' }); }
  console.log(JSON.stringify({ status: snapshot.status, mode: snapshot.mode, auditDate: snapshot.auditDate, output: config.out ?? null, sources: Object.fromEntries(Object.entries(snapshot.sources).map(([key, s]) => [key, { status: s.status, reason: s.reason ?? null, through: s.freshness?.through ?? null, observedDays: s.windows?.observedDays ?? null }])) }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Collection could not finish: check options and output path. Existing snapshots are never overwritten; no credentials or remote error bodies are logged.'); process.exitCode = 1; });
