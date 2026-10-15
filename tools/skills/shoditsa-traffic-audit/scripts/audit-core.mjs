export const DAY = 86400000;
export function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return value;
}
export const shift = (value, days) => new Date(new Date(`${date(value)}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
export const dayCount = (from, to) => Math.floor((new Date(`${date(to)}T00:00:00Z`) - new Date(`${date(from)}T00:00:00Z`)) / DAY) + 1;
export const finite = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export const round = value => value === null ? null : Math.round(value * 10000) / 10000;
export function unavailable(reason, httpStatus = null) { return { status: 'unavailable', reason, httpStatus, data: null, totals: null }; }
export function dates(from, to) { const list = []; for (let d = from; d <= to; d = shift(d, 1)) list.push(d); return list; }
export function observationBoundary(rows, metric, launchDate = null) {
  const firstActivity = rows.find(row => finite(row[metric]) > 0)?.date ?? null;
  return { firstObservedDate: rows[0]?.date ?? null, firstActivityDate: firstActivity, from: launchDate ?? firstActivity, basis: launchDate ? 'known-launch-date' : 'first-observed-activity-not-proven-launch' };
}
export function makeWindows(through, boundary) {
  if (!through || !boundary || boundary > through) return { observedDays: 0, comparisons: {}, context31: null, fullObserved: null };
  const age = dayCount(boundary, through), comparisons = {};
  for (const size of [7, 14, 28]) {
    const current = { from: shift(through, 1 - size), to: through };
    const previous = { from: shift(through, 1 - 2 * size), to: shift(through, -size) };
    comparisons[`${size}d`] = age >= 2 * size
      ? { status: 'ready', current, previous }
      : { status: 'insufficient_history', requiredDays: 2 * size, observedDays: age, current: null, previous: null };
  }
  return { observedDays: age, comparisons, context31: { from: boundary > shift(through, -30) ? boundary : shift(through, -30), to: through }, fullObserved: { from: boundary, to: through } };
}
export function normalizeWebmaster(raw) {
  const map = new Map();
  const names = { TOTAL_SHOWS: 'impressions', TOTAL_CLICKS: 'clicks', AVG_SHOW_POSITION: 'position' };
  for (const [indicator, key] of Object.entries(names)) for (const row of raw?.indicators?.[indicator] ?? []) {
    const d = String(row.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const item = map.get(d) ?? { date: d, impressions: null, clicks: null, position: null };
    item[key] = finite(row.value); map.set(d, item);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function webmasterFreshness(rows, requestedThrough, confirmedThrough = null) {
  const lastActivity = rows.filter(row => row.date <= requestedThrough && (row.impressions > 0 || row.clicks > 0)).at(-1)?.date ?? null;
  const through = confirmedThrough ?? lastActivity;
  return { requestedThrough, through, latestActivityDate: lastActivity, basis: confirmedThrough ? 'explicit-source-confirmation' : 'conservative-last-observed-activity', unconfirmedTrailingDates: through ? dates(shift(through, 1), requestedThrough) : null };
}
export function summarizeWebmaster(rows, period) {
  if (!period) return unavailable('insufficient_history');
  const selected = rows.filter(row => row.date >= period.from && row.date <= period.to);
  const expectedDays = dayCount(period.from, period.to);
  const missingDates = dates(period.from, period.to).filter(d => !selected.some(row => row.date === d && row.impressions !== null && row.clicks !== null));
  if (missingDates.length) return { ...unavailable('incomplete_daily_coverage'), status: 'partial', ...period, expectedDays, returnedDays: selected.length, missingDates };
  const impressions = selected.reduce((sum, row) => sum + row.impressions, 0), clicks = selected.reduce((sum, row) => sum + row.clicks, 0);
  const positionComplete = selected.every(row => row.impressions === 0 || row.position !== null);
  return { status: 'ok', ...period, expectedDays, returnedDays: selected.length, totals: { clicks, impressions, ctrPercent: impressions ? round(clicks / impressions * 100) : null, weightedPosition: impressions && positionComplete ? round(selected.reduce((sum, row) => sum + (row.position ?? 0) * row.impressions, 0) / impressions) : null } };
}
export function quality(raw) {
  return { sampled: raw?.sampled ?? null, sampleShare: finite(raw?.sample_share), privacySuppressed: raw?.contains_sensitive_data ?? null, totalRows: finite(raw?.total_rows), returnedRows: Array.isArray(raw?.data) ? raw.data.length : null, truncated: typeof raw?.total_rows === 'number' && Array.isArray(raw?.data) ? raw.total_rows > raw.data.length : null };
}
export function sanitizeDimension(value) {
  const text = String(value ?? '');
  if (/^https?:\/\//i.test(text)) {
    try { const url = new URL(text); return url.hostname + url.pathname.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/[id]'); } catch { return '[invalid URL]'; }
  }
  return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[redacted-email]').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]');
}
export function normalizeMetrica(raw, metrics) {
  if (!raw || !Array.isArray(raw.totals) || !Array.isArray(raw.data)) return unavailable('invalid_reporting_response');
  return { status: 'ok', quality: quality(raw), totals: Object.fromEntries(metrics.map((key, i) => [key, finite(raw.totals[i])])), rows: raw.data.map(row => ({ dimensions: (row.dimensions ?? []).map(d => sanitizeDimension(d?.name ?? d?.id)), metrics: Object.fromEntries(metrics.map((key, i) => [key, finite(row.metrics?.[i])])) })) };
}
export function delta(current, previous) {
  if (current === null || previous === null || current === undefined || previous === undefined) return { absolute: null, relativePercent: null, reason: 'unavailable_value' };
  return { absolute: round(current - previous), relativePercent: previous === 0 ? null : round((current / previous - 1) * 100), reason: previous === 0 ? 'zero_baseline_relative_change_undefined' : null };
}
