import { isDeepStrictEqual } from 'node:util'

const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
)

const cleanText = (value) => String(value ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const positiveInteger = (value) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export const sameJsonValue = (left, right) => isDeepStrictEqual(left ?? null, right ?? null)

const person = (value) => {
  const entry = asObject(value)
  const nameRu = cleanText(entry.nameRu || entry.nameEn)
  if (!nameRu) return null
  return {
    nameRu,
    nameOriginal: cleanText(entry.nameEn || entry.nameRu),
    photoUrl: cleanText(entry.posterUrl) || null,
  }
}

export const SERIES_TYPES = new Set(['TV_SERIES', 'MINI_SERIES', 'TV_SHOW'])

export const isSeriesDetails = (value) => {
  const details = asObject(value)
  const type = cleanText(details.type).toUpperCase()
  return SERIES_TYPES.has(type) || (type === '' && details.serial === true)
}

export const seasonProfile = (value) => {
  const response = asObject(value)
  const items = Array.isArray(response.items) ? response.items : []
  const seasonsCount = positiveInteger(response.total) ?? positiveInteger(items.length)
  const episodes = items.reduce((total, season) => {
    const entries = Array.isArray(asObject(season).episodes) ? asObject(season).episodes : []
    return total + entries.length
  }, 0)
  return {
    seasonsCount,
    episodes: positiveInteger(episodes),
  }
}

export const needsSupportingCast = (payload) => {
  const current = asObject(payload).supportingCast
  return !Array.isArray(current) || current.length === 0
}

export const buildSeriesProfileChanges = ({ payload: payloadValue, details: detailsValue, seasons: seasonsValue, staff: staffValue }) => {
  const payload = asObject(payloadValue)
  const details = asObject(detailsValue)
  const seasons = seasonProfile(seasonsValue)
  const staff = Array.isArray(staffValue) ? staffValue : []
  const changes = []

  const add = (field, after, source) => {
    const before = payload[field] ?? null
    if (after == null || sameJsonValue(before, after)) return
    changes.push({ field, before, after, source })
  }

  if (seasons.episodes != null) add('episodes', seasons.episodes, 'kinopoisk_seasons')
  if (seasons.seasonsCount != null) add('seasonsCount', seasons.seasonsCount, 'kinopoisk_seasons')

  if (typeof details.completed === 'boolean') {
    add('seriesStatus', details.completed ? 'Закончен' : 'Еще выходит', 'kinopoisk_details')
  }

  const endYear = positiveInteger(details.endYear)
  if (endYear != null) add('endYear', endYear, 'kinopoisk_details')

  if (!cleanText(payload.slogan)) {
    const slogan = cleanText(details.slogan)
    if (slogan) add('slogan', slogan, 'kinopoisk_details')
  }

  if (!cleanText(payload.backdropUrl)) {
    const backdropUrl = cleanText(details.coverUrl)
    if (backdropUrl) add('backdropUrl', backdropUrl, 'kinopoisk_details')
  }

  if (needsSupportingCast(payload)) {
    const actors = staff.filter((entry) => asObject(entry).professionKey === 'ACTOR')
    const supportingCast = actors.slice(5, 10).map(person).filter(Boolean)
    if (supportingCast.length) add('supportingCast', supportingCast, 'kinopoisk_staff')
  }

  return changes
}

export const applySeriesProfileChanges = (payloadValue, changes) => {
  const payload = asObject(payloadValue)
  const quality = asObject(payload.dataQuality)
  const currentSources = Array.isArray(quality.source)
    ? quality.source.filter((entry) => typeof entry === 'string' && entry.trim())
    : []
  const next = { ...payload }
  for (const change of changes) next[change.field] = change.after

  const sourceMarkers = []
  if (changes.some((change) => change.source === 'kinopoisk_seasons')) {
    sourceMarkers.push('series_profile_kinopoisk_seasons')
  }
  if (changes.some((change) => change.source === 'kinopoisk_details')) {
    sourceMarkers.push('series_profile_kinopoisk_details')
  }
  if (changes.some((change) => change.source === 'kinopoisk_staff')) {
    sourceMarkers.push('series_profile_kinopoisk_staff')
  }
  next.dataQuality = {
    ...quality,
    source: [...new Set([...currentSources, ...sourceMarkers])],
  }
  return next
}

export const summarizeSeriesProfileUpdates = (updates) => {
  const summary = {}
  for (const update of updates) {
    for (const change of update.changes) {
      summary[change.field] = (summary[change.field] ?? 0) + 1
    }
  }
  return Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)))
}
