import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cleanText, normalize, sanitizeMovieRecord, titleTokens, titleVariants } from './movie-hint-sanitize.mjs'

const root = resolve(import.meta.dirname, '..')
const moviesPath = resolve(root, 'public', 'data', 'movies.generated.json')
const reportPath = resolve(root, 'archive', 'reports', 'movie-title-overlap-report.json')
const WORD_CHAR_CLASS = 'A-Za-zА-Яа-яЁё0-9'

const unique = (items) => [...new Set(items.filter(Boolean))]
const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const boundedPattern = (value) => `(^|[^${WORD_CHAR_CLASS}])${escapeRegExp(value)}(?=$|[^${WORD_CHAR_CLASS}])`

const readJsonIfExists = async (filePath) => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

const buildTitleContext = (movie) => {
  const titles = unique([
    movie.titleRu,
    movie.titleOriginal,
    ...(movie.alternativeTitles ?? []),
  ].flatMap((title) => titleVariants(title)))

  const normalizedTitles = unique(titles.map((title) => normalize(title)).filter(Boolean))
  const tokens = unique(titles.flatMap((title) => titleTokens(title)))

  return { titles, normalizedTitles, tokens }
}

const findTitleHits = (text, context) => {
  const normalized = normalize(text)
  if (!normalized) {
    return { tokens: [], titles: [] }
  }

  const tokens = context.tokens.filter((token) => new RegExp(boundedPattern(token), 'iu').test(normalized))
  const titles = context.normalizedTitles.filter((title) => new RegExp(boundedPattern(title), 'iu').test(normalized))

  return {
    tokens: unique(tokens),
    titles: unique(titles),
  }
}

const fieldHasTitleRisk = (text, context) => {
  const hits = findTitleHits(text, context)
  return hits.tokens.length > 0 || hits.titles.length > 0
}

const scalarFields = ['plotHint', 'description', 'slogan']

const previousReport = await readJsonIfExists(reportPath)
const previousFieldsById = new Map((previousReport?.changed ?? []).map((entry) => [entry.id, entry.fields]))

const baselineScalarField = (movie, field) => previousFieldsById.get(movie.id)?.[field]?.before ?? movie[field] ?? null
const baselineFactsField = (movie) => previousFieldsById.get(movie.id)?.facts?.before ?? movie.facts ?? []

const buildBaselineMovie = (movie) => ({
  ...movie,
  plotHint: baselineScalarField(movie, 'plotHint'),
  description: baselineScalarField(movie, 'description'),
  slogan: baselineScalarField(movie, 'slogan'),
  facts: baselineFactsField(movie),
})

const before = JSON.parse(await readFile(moviesPath, 'utf8'))
const changed = []

const after = before.map((movie) => {
  const baselineMovie = buildBaselineMovie(movie)
  const context = buildTitleContext(baselineMovie)
  const sanitized = sanitizeMovieRecord(baselineMovie)
  const nextMovie = { ...movie }
  const fieldChanges = {}

  for (const field of scalarFields) {
    const originalValue = baselineMovie[field] ?? null
    if (!fieldHasTitleRisk(originalValue, context)) {
      continue
    }

    const nextValue = sanitized[field] ?? null
    if ((movie[field] ?? null) === nextValue) {
      continue
    }

    nextMovie[field] = nextValue
    fieldChanges[field] = {
      before: originalValue,
      after: nextValue,
      titleHits: findTitleHits(originalValue, context),
    }
  }

  const riskyFacts = (baselineMovie.facts ?? []).filter((fact) => fieldHasTitleRisk(fact, context))
  if (riskyFacts.length > 0) {
    const nextFacts = sanitized.facts ?? []
    if (JSON.stringify(movie.facts ?? []) !== JSON.stringify(nextFacts)) {
      nextMovie.facts = nextFacts
      fieldChanges.facts = {
        beforeCount: Array.isArray(baselineMovie.facts) ? baselineMovie.facts.length : 0,
        afterCount: Array.isArray(nextFacts) ? nextFacts.length : 0,
        before: baselineMovie.facts ?? [],
        after: nextFacts,
        riskyFacts,
      }
    }
  }

  if (Object.keys(fieldChanges).length > 0) {
    changed.push({
      id: movie.id,
      titleRu: movie.titleRu,
      titleOriginal: movie.titleOriginal,
      fields: fieldChanges,
    })
  }

  return nextMovie
})

const countRiskyMovies = (movies) => movies.filter((movie) => {
  const context = buildTitleContext(movie)
  return scalarFields.some((field) => fieldHasTitleRisk(movie[field], context))
    || (movie.facts ?? []).some((fact) => fieldHasTitleRisk(fact, context))
}).length

const summary = {
  totalMovies: before.length,
  changedMovies: changed.length,
  riskyBefore: countRiskyMovies(before.map((movie) => buildBaselineMovie(movie))),
  riskyAfter: countRiskyMovies(after),
  changedPlotHints: changed.filter((entry) => entry.fields.plotHint).length,
  changedDescriptions: changed.filter((entry) => entry.fields.description).length,
  changedSlogans: changed.filter((entry) => entry.fields.slogan).length,
  changedFacts: changed.filter((entry) => entry.fields.facts).length,
}

await writeFile(moviesPath, JSON.stringify(after, null, 2), 'utf8')
await writeFile(reportPath, JSON.stringify({ summary, changed }, null, 2), 'utf8')

console.log(JSON.stringify(summary, null, 2))
