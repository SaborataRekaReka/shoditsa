import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { normalize, sanitizeMovieRecord as sanitizeSeriesRecord, titleTokens, titleVariants } from './movie-hint-sanitize.mjs'

const root = resolve(import.meta.dirname, '..')
const seriesPath = resolve(root, 'public', 'data', 'series.generated.json')
const reportPath = resolve(root, 'docs', 'series-title-overlap-report.json')
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

const buildTitleContext = (series) => {
  const titles = unique([
    series.titleRu,
    series.titleOriginal,
    ...(series.alternativeTitles ?? []),
  ].flatMap((title) => titleVariants(title)))

  const normalizedTitles = unique(titles.map((title) => normalize(title)).filter(Boolean))
  const tokens = unique(titles.flatMap((title) => titleTokens(title)))

  return { normalizedTitles, tokens }
}

const findTitleHits = (text, context) => {
  const normalized = normalize(text)
  if (!normalized) return { tokens: [], titles: [] }

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

const baselineScalarField = (series, field) => previousFieldsById.get(series.id)?.[field]?.before ?? series[field] ?? null
const baselineFactsField = (series) => previousFieldsById.get(series.id)?.facts?.before ?? series.facts ?? []

const buildBaselineSeries = (series) => ({
  ...series,
  plotHint: baselineScalarField(series, 'plotHint'),
  description: baselineScalarField(series, 'description'),
  slogan: baselineScalarField(series, 'slogan'),
  facts: baselineFactsField(series),
})

const before = JSON.parse(await readFile(seriesPath, 'utf8'))
const changed = []

const after = before.map((series) => {
  const baselineSeries = buildBaselineSeries(series)
  const context = buildTitleContext(baselineSeries)
  const sanitized = sanitizeSeriesRecord(baselineSeries)
  const nextSeries = { ...series }
  const fieldChanges = {}

  for (const field of scalarFields) {
    const originalValue = baselineSeries[field] ?? null
    if (!fieldHasTitleRisk(originalValue, context)) {
      continue
    }

    const nextValue = sanitized[field] ?? null
    if ((series[field] ?? null) === nextValue) {
      continue
    }

    nextSeries[field] = nextValue
    fieldChanges[field] = {
      before: originalValue,
      after: nextValue,
      titleHits: findTitleHits(originalValue, context),
    }
  }

  const riskyFacts = (baselineSeries.facts ?? []).filter((fact) => fieldHasTitleRisk(fact, context))
  if (riskyFacts.length > 0) {
    const nextFacts = sanitized.facts ?? []
    if (JSON.stringify(series.facts ?? []) !== JSON.stringify(nextFacts)) {
      nextSeries.facts = nextFacts
      fieldChanges.facts = {
        beforeCount: Array.isArray(baselineSeries.facts) ? baselineSeries.facts.length : 0,
        afterCount: Array.isArray(nextFacts) ? nextFacts.length : 0,
        before: baselineSeries.facts ?? [],
        after: nextFacts,
        riskyFacts,
      }
    }
  }

  if (Object.keys(fieldChanges).length > 0) {
    changed.push({
      id: series.id,
      titleRu: series.titleRu,
      titleOriginal: series.titleOriginal,
      fields: fieldChanges,
    })
  }

  return nextSeries
})

const countRiskySeries = (items) => items.filter((series) => {
  const context = buildTitleContext(series)
  return scalarFields.some((field) => fieldHasTitleRisk(series[field], context))
    || (series.facts ?? []).some((fact) => fieldHasTitleRisk(fact, context))
}).length

const baselineBefore = before.map((series) => buildBaselineSeries(series))
const summary = {
  totalSeries: before.length,
  changedSeries: changed.length,
  riskyBefore: countRiskySeries(baselineBefore),
  riskyAfter: countRiskySeries(after),
  changedPlotHints: changed.filter((entry) => entry.fields.plotHint).length,
  changedDescriptions: changed.filter((entry) => entry.fields.description).length,
  changedSlogans: changed.filter((entry) => entry.fields.slogan).length,
  changedFacts: changed.filter((entry) => entry.fields.facts).length,
}

await writeFile(seriesPath, JSON.stringify(after, null, 2), 'utf8')
await writeFile(reportPath, JSON.stringify({ summary, changed }, null, 2), 'utf8')

console.log(JSON.stringify(summary, null, 2))
