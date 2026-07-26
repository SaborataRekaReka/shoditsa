import { isDeepStrictEqual } from 'node:util'

const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
)

const cleanText = (value) => String(value ?? '').trim()
const people = (value) => Array.isArray(value) ? value : []

export const sameJsonValue = (left, right) => isDeepStrictEqual(left ?? null, right ?? null)

export const validPeople = (value) => {
  const entries = people(value)
  return entries.length > 0 && entries.every((entryValue) => {
    const entry = asObject(entryValue)
    return Boolean(cleanText(entry.nameRu) || cleanText(entry.nameOriginal))
  })
}

export const buildMovieHistoryChanges = ({
  payload: payloadValue,
  historicalDirectors,
  historicalWriters,
  directorSource,
  writerSource,
}) => {
  const payload = asObject(payloadValue)
  const changes = []
  const addSet = (field, after, source) => {
    const before = Object.hasOwn(payload, field) ? payload[field] : null
    if (sameJsonValue(before, after)) return
    changes.push({ field, operation: 'set', before, after, source })
  }

  if (people(payload.directors).length === 0 && validPeople(historicalDirectors)) {
    addSet('directors', historicalDirectors, directorSource)
  }
  if (people(payload.writers).length === 0 && validPeople(historicalWriters)) {
    addSet('writers', historicalWriters, writerSource)
  }

  if (Object.hasOwn(payload, 'seriesStatus')) {
    changes.push({
      field: 'seriesStatus',
      operation: 'delete',
      before: payload.seriesStatus,
      after: null,
      source: 'movie_mode_cleanup',
    })
  }
  if (people(payload.showrunners).length > 0) {
    addSet('showrunners', [], 'movie_mode_cleanup')
  }

  const quality = asObject(payload.dataQuality)
  const sources = Array.isArray(quality.source) ? quality.source : []
  if (sources.includes('series_status_fallback')) {
    addSet('dataQuality', {
      ...quality,
      source: sources.filter((entry) => entry !== 'series_status_fallback'),
    }, 'movie_mode_cleanup')
  }

  return changes
}

export const applyMovieHistoryChanges = (payloadValue, changes) => {
  const next = { ...asObject(payloadValue) }
  for (const change of changes) {
    if (change.operation === 'delete') delete next[change.field]
    else next[change.field] = change.after
  }
  return next
}

export const summarizeMovieHistoryUpdates = (updates) => {
  const summary = {}
  for (const update of updates) {
    for (const change of update.changes) {
      const key = change.operation === 'delete' ? `${change.field}:delete` : change.field
      summary[key] = (summary[key] ?? 0) + 1
    }
  }
  return Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)))
}

const localMediaPath = (value) => {
  const content = value.match(/^\/media\/content\/(movies|series|animes|games)\/(.+)$/)
  if (content) return `./data/libraries/${content[1]}/img/${content[2]}`

  const legacyContent = value.match(/^\/media\/(movies|series|animes|games)\/(.+)$/)
  if (legacyContent) return `./data/libraries/${legacyContent[1]}/img/${legacyContent[2]}`

  const person = value.match(/^\/media\/people\/(.+)$/)
  if (person) return `./data/libraries/people/img/${person[1]}`
  return value
}

export const localizeProductionMedia = (value) => {
  if (typeof value === 'string') return localMediaPath(value)
  if (Array.isArray(value)) return value.map(localizeProductionMedia)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      localizeProductionMedia(entry),
    ]))
  }
  return value
}

