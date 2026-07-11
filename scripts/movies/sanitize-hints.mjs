import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { auditMovieRecord, sanitizeMovieRecord } from '../shared/movie-hint-sanitize.mjs'

const root = resolve(import.meta.dirname, '../..')
const moviesPath = resolve(root, 'public', 'data', 'movies.generated.json')
const reportPath = resolve(root, 'archive', 'reports', 'movie-hints-sanitization-report.json')

const before = JSON.parse(await readFile(moviesPath, 'utf8'))
const changed = []
const after = before.map((movie) => {
  const sanitized = sanitizeMovieRecord(movie)
  const fieldChanges = {}

  if ((movie.plotHint ?? null) !== (sanitized.plotHint ?? null)) {
    fieldChanges.plotHint = { before: movie.plotHint ?? null, after: sanitized.plotHint ?? null }
  }
  if ((movie.description ?? null) !== (sanitized.description ?? null)) {
    fieldChanges.description = { before: movie.description ?? null, after: sanitized.description ?? null }
  }
  if ((movie.slogan ?? null) !== (sanitized.slogan ?? null)) {
    fieldChanges.slogan = { before: movie.slogan ?? null, after: sanitized.slogan ?? null }
  }
  if (JSON.stringify(movie.facts ?? []) !== JSON.stringify(sanitized.facts ?? [])) {
    fieldChanges.facts = {
      beforeCount: Array.isArray(movie.facts) ? movie.facts.length : 0,
      afterCount: Array.isArray(sanitized.facts) ? sanitized.facts.length : 0,
      before: movie.facts ?? [],
      after: sanitized.facts ?? [],
    }
  }

  if (Object.keys(fieldChanges).length) {
    changed.push({
      id: movie.id,
      titleRu: movie.titleRu,
      titleOriginal: movie.titleOriginal,
      fields: fieldChanges,
    })
  }

  return sanitized
})

const summary = {
  totalMovies: before.length,
  changedMovies: changed.length,
  riskyBefore: before.filter((movie) => auditMovieRecord(movie).risky).length,
  riskyAfter: after.filter((movie) => auditMovieRecord(movie).risky).length,
  changedPlotHints: changed.filter((entry) => entry.fields.plotHint).length,
  changedDescriptions: changed.filter((entry) => entry.fields.description).length,
  changedSlogans: changed.filter((entry) => entry.fields.slogan).length,
  changedFacts: changed.filter((entry) => entry.fields.facts).length,
}

await writeFile(moviesPath, JSON.stringify(after, null, 2), 'utf8')
await writeFile(reportPath, JSON.stringify({ summary, changed }, null, 2), 'utf8')

console.log(JSON.stringify(summary, null, 2))