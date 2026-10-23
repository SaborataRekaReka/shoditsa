import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const directory = resolve(process.argv[2] ?? 'qa/release-theme-acceptance-2026-10-21')
const candidate = process.argv[3] ?? 'rc17'
const records = []
for (const name of await readdir(directory)) {
  if (!/^colors-(light|dark)-.*\.json$/.test(name)) continue
  const record = JSON.parse(await readFile(join(directory, name), 'utf8'))
  if (record.candidate === candidate) records.push(record)
}
const palettes = { light: {}, dark: {} }
for (const record of records) for (const [paint, count] of Object.entries(record.colors)) palettes[record.tone][paint] = (palettes[record.tone][paint] ?? 0) + count
const findings = records.flatMap(record => [
  ...record.normal.findings.filter(f => !f.disabled).map(f => ({ name: record.name, tone: record.tone, state: 'normal', ...f })),
  ...record.checks.flatMap(check => check.findings.map(f => ({ name: record.name, tone: record.tone, state: check.state, ...f }))),
])
const summary = {
  candidate, pageThemeCases: records.length,
  byTheme: Object.fromEntries(['light', 'dark'].map(tone => [tone, records.filter(record => record.tone === tone).length])),
  normalTextChecks: records.reduce((n, r) => n + r.normal.checked, 0),
  uniqueInteractiveStateChecks: records.reduce((n, r) => n + r.checks.length, 0),
  reusedComponentChecks: records.reduce((n, r) => n + r.reusedChecks, 0),
  states: [...new Set(records.flatMap(r => r.checks.map(c => c.state)))],
  findings,
  overflow: records.filter(r => r.normal.scroll > r.normal.client).map(r => ({ name: r.name, tone: r.tone, pixels: r.normal.scroll - r.normal.client })),
  appearanceValues: Object.fromEntries(['light', 'dark'].map(tone => [tone, Object.keys(palettes[tone]).length])),
  method: 'Rendered page color inventory; independent controls grouped without ancestor/descendant pairs; hover, active and keyboard focus forced through browser development tools, then reset. Identical component contexts reused. Gradient artwork additionally requires visual review.',
}
await writeFile(join(directory, 'used-appearance-values.json'), JSON.stringify(palettes, null, 2))
await writeFile(join(directory, 'color-state-summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary))
if (summary.pageThemeCases < 202 || findings.length || summary.overflow.length) process.exitCode = 1
