import { readFile } from 'node:fs/promises';
import { delta } from './audit-core.mjs';
const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) throw new Error('Usage: compare-snapshots.mjs OLD.json NEW.json');
const [before, after] = await Promise.all([oldPath, newPath].map(async path => JSON.parse(await readFile(path, 'utf8'))));
const changes = [];
for (const source of ['webmaster', 'metrika']) {
  const previous = before.sources?.[source], current = after.sources?.[source];
  for (const key of ['current7d', 'current14d', 'current28d', 'context31']) {
    for (const scope of source === 'metrika' ? ['all', 'organic'] : [null]) {
      const a = scope ? previous?.reports?.[key]?.[scope] : previous?.reports?.[key];
      const b = scope ? current?.reports?.[key]?.[scope] : current?.reports?.[key];
      const keys = new Set([...Object.keys(a?.totals ?? {}), ...Object.keys(b?.totals ?? {})]);
      if (!keys.size) { changes.push({ source, key, scope, status: 'unavailable', reason: 'missing_period_totals', previous: null, current: null }); continue; }
      for (const metric of keys) changes.push({ source, key, scope, metric, previousPeriod: a?.period ?? (a ? { from: a.from, to: a.to } : null), currentPeriod: b?.period ?? (b ? { from: b.from, to: b.to } : null), previous: a?.totals?.[metric] ?? null, current: b?.totals?.[metric] ?? null, delta: delta(b?.totals?.[metric] ?? null, a?.totals?.[metric] ?? null) });
    }
  }
}
console.log(JSON.stringify({ before: before.capturedAt, after: after.capturedAt, warning: 'Snapshot windows may overlap: these deltas do not replace independent 7/7, 14/14 and 28/28 comparisons inside each snapshot.', changes }, null, 2));
