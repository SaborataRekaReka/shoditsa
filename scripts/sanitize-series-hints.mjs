import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { auditMovieRecord as auditSeriesRecord, sanitizeMovieRecord as sanitizeSeriesRecord } from './movie-hint-sanitize.mjs'

const root = resolve(import.meta.dirname, '..')
const seriesPath = resolve(root, 'public', 'data', 'series.generated.json')
const reportPath = resolve(root, 'archive', 'reports', 'series-hints-sanitization-report.json')

const before = JSON.parse(await readFile(seriesPath, 'utf8'))
const changed = []
const after = before.map((series) => {
  const sanitized = sanitizeSeriesRecord(series)
  const fieldChanges = {}

  if ((series.plotHint ?? null) !== (sanitized.plotHint ?? null)) {
    fieldChanges.plotHint = { before: series.plotHint ?? null, after: sanitized.plotHint ?? null }
  }
  if ((series.description ?? null) !== (sanitized.description ?? null)) {
    fieldChanges.description = { before: series.description ?? null, after: sanitized.description ?? null }
  }
  if ((series.slogan ?? null) !== (sanitized.slogan ?? null)) {
    fieldChanges.slogan = { before: series.slogan ?? null, after: sanitized.slogan ?? null }
  }
  if (JSON.stringify(series.facts ?? []) !== JSON.stringify(sanitized.facts ?? [])) {
    fieldChanges.facts = {
      beforeCount: Array.isArray(series.facts) ? series.facts.length : 0,
      afterCount: Array.isArray(sanitized.facts) ? sanitized.facts.length : 0,
      before: series.facts ?? [],
      after: sanitized.facts ?? [],
    }
  }

  if (Object.keys(fieldChanges).length) {
    changed.push({
      id: series.id,
      titleRu: series.titleRu,
      titleOriginal: series.titleOriginal,
      fields: fieldChanges,
    })
  }

  return sanitized
})

const summary = {
  totalSeries: before.length,
  changedSeries: changed.length,
  riskyBefore: before.filter((series) => auditSeriesRecord(series).risky).length,
  riskyAfter: after.filter((series) => auditSeriesRecord(series).risky).length,
  changedPlotHints: changed.filter((entry) => entry.fields.plotHint).length,
  changedDescriptions: changed.filter((entry) => entry.fields.description).length,
  changedSlogans: changed.filter((entry) => entry.fields.slogan).length,
  changedFacts: changed.filter((entry) => entry.fields.facts).length,
}

await writeFile(seriesPath, JSON.stringify(after, null, 2), 'utf8')
await writeFile(reportPath, JSON.stringify({ summary, changed }, null, 2), 'utf8')

console.log(JSON.stringify(summary, null, 2))
