import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse as parseDotenv } from 'dotenv'
import { applySeriesOverride, loadSeriesOverrides } from './manual-overrides.mjs'
import {
  fetchWikidataSeasonsByKinopoiskIds,
  kinopoiskKeysFromEnvironment,
} from './season-sources.mjs'

const root = resolve(import.meta.dirname, '../..')
const args = process.argv.slice(2)
const externallyDefinedEnvironment = new Set(Object.keys(process.env))

for (const filename of ['.env', '.env.local']) {
  const envFile = resolve(root, filename)
  if (!existsSync(envFile)) continue
  const parsed = parseDotenv(await readFile(envFile))
  for (const [key, value] of Object.entries(parsed)) {
    if (!externallyDefinedEnvironment.has(key)) process.env[key] = value
  }
}

const argValue = (name, fallback) => {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return fallback
  return args[index + 1]
}

const useAdminSecrets = args.includes('--admin-secrets')
if (useAdminSecrets) {
  const [{ loadConfig }, { createDatabase }, { loadIntegrationEnvironment }] = await Promise.all([
    import('@shoditsa/config'),
    import('@shoditsa/database'),
    import('../../apps/api/src/modules/admin/integration-secrets.js'),
  ])
  const config = loadConfig()
  const { db, client } = createDatabase(config)
  try {
    Object.assign(process.env, await loadIntegrationEnvironment(db, config))
  } finally {
    await client.end()
  }
}

const seriesOverrides = await loadSeriesOverrides(root)
const configuredLibraryRoot = process.env.CONTENT_RELEASE_ROOT?.trim()
  ? resolve(root, process.env.CONTENT_RELEASE_ROOT.trim())
  : resolve(root, 'public/data/libraries')
const defaultSeriesPath = resolve(configuredLibraryRoot, 'series/items.json')
const inputPath = resolve(root, argValue('--in', defaultSeriesPath))
const outputPath = resolve(root, argValue('--out', inputPath))
const reportPath = resolve(root, argValue('--report', 'archive/reports/series-meta-enrichment-report.json'))
const force = args.includes('--force')
const maxItemsArg = Number(argValue('--max-items', '0'))
const maxItems = Number.isFinite(maxItemsArg) && maxItemsArg > 0 ? maxItemsArg : null
const uniqueKeys = kinopoiskKeysFromEnvironment(process.env)

const api = 'https://kinopoiskapiunofficial.tech'
const tvmazeApi = 'https://api.tvmaze.com'
const delay = (ms) => new Promise((resolveDone) => setTimeout(resolveDone, ms))

const keyState = uniqueKeys.map((key) => ({
  key,
  exhausted: false,
  cooldownUntil: 0,
  used: 0,
  failures: 0,
}))

let pointer = 0
let tvmazeNextAllowedAt = 0

const activeStates = () => keyState.filter((entry) => !entry.exhausted)

const canUseKinopoiskApi = () => activeStates().length > 0

const pickState = async () => {
  const active = activeStates()
  if (!active.length) throw new Error('All API keys are exhausted')

  for (let i = 0; i < keyState.length; i += 1) {
    const idx = (pointer + i) % keyState.length
    const state = keyState[idx]
    if (state.exhausted) continue
    if (Date.now() < state.cooldownUntil) continue
    pointer = (idx + 1) % keyState.length
    return state
  }

  const waits = keyState
    .filter((entry) => !entry.exhausted)
    .map((entry) => Math.max(0, entry.cooldownUntil - Date.now()))
  const waitMs = Math.max(80, Math.min(...waits))
  await delay(waitMs)
  return pickState()
}

const request = async (path) => {
  if (!canUseKinopoiskApi()) throw new Error('All API keys are exhausted')

  for (let attempt = 0; attempt < uniqueKeys.length * 12; attempt += 1) {
    const state = await pickState()
    const response = await fetch(api + path, {
      headers: {
        'X-API-KEY': state.key,
        'Content-Type': 'application/json',
      },
    })

    if (response.ok) {
      state.used += 1
      state.failures = 0
      state.cooldownUntil = 0
      return response.json()
    }

    const body = await response.text().catch(() => '')
    const exhaustedByBody = /quota|limit|daily|exceeded|превышен/i.test(body)

    if (response.status === 402 || response.status === 401 || response.status === 403 || exhaustedByBody) {
      state.exhausted = true
      continue
    }

    if (response.status === 429 || response.status >= 500) {
      state.failures += 1
      const backoff = Math.min(12000, 450 * (state.failures + 1))
      state.cooldownUntil = Date.now() + backoff
      continue
    }

    throw new Error(`${response.status} ${path} ${body.slice(0, 180)}`)
  }

  throw new Error(`Retries exhausted for ${path}`)
}

const tvmazeRequestJson = async (path) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const now = Date.now()
    if (tvmazeNextAllowedAt > now) {
      await delay(tvmazeNextAllowedAt - now)
    }

    // A short pace keeps us comfortably under public API limits.
    tvmazeNextAllowedAt = Date.now() + 130

    const response = await fetch(tvmazeApi + path, {
      headers: {
        'User-Agent': 'seans-starter-pack/series-meta-enrich',
        Accept: 'application/json',
      },
    })

    if (response.status === 404) return null
    if (response.ok) return response.json()

    if (response.status === 429 || response.status >= 500) {
      await delay(Math.min(4000, 250 * (attempt + 1)))
      continue
    }

    const body = await response.text().catch(() => '')
    throw new Error(`TVMaze ${response.status} ${path} ${body.slice(0, 180)}`)
  }

  throw new Error(`TVMaze retries exhausted for ${path}`)
}

const parseKinopoiskId = (item) => {
  if (Number.isInteger(item?.kinopoiskId) && item.kinopoiskId > 0) return item.kinopoiskId
  if (typeof item?.kinopoiskId === 'string' && /^\d+$/.test(item.kinopoiskId)) return Number(item.kinopoiskId)
  if (typeof item?.id === 'string') {
    const match = item.id.match(/^kp_(\d+)$/)
    if (match) return Number(match[1])
  }
  return null
}

const hasTargetStatus = (value) => value === 'Еще выходит' || value === 'Закончен'

const parseImdbId = (item) => {
  if (typeof item?.imdbId !== 'string') return null
  const imdbId = item.imdbId.trim()
  if (/^tt\d+$/i.test(imdbId)) return imdbId.toLowerCase()
  return null
}

const mapTvmazeStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'ended') return 'Закончен'
  return 'Еще выходит'
}

const readCollection = async (pathToJson) => {
  const raw = await readFile(pathToJson, 'utf8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error(`Expected array JSON: ${pathToJson}`)
  return parsed
}

const currentYear = new Date().getUTCFullYear()
const fallbackStatus = (item, details) => {
  const endYearFromItem = Number(item?.endYear)
  const endYearFromDetails = Number(details?.endYear)
  const endYear = Number.isFinite(endYearFromItem) && endYearFromItem > 0
    ? endYearFromItem
    : (Number.isFinite(endYearFromDetails) && endYearFromDetails > 0 ? endYearFromDetails : null)

  if (endYear != null && endYear <= currentYear) return 'Закончен'
  return 'Еще выходит'
}

const data = (await readCollection(inputPath)).map((item) => applySeriesOverride(item, seriesOverrides))
const seriesItems = data.filter((item) => item?.mode === 'series')
const managedSeasonSourceMarkers = new Set([
  'series_meta_kinopoisk',
  'series_meta_wikidata',
  'series_meta_tvmaze',
  'series_meta_wikidata_tvmaze',
  'series_meta_conflict',
])
const hasManagedSeasonSource = (item) => item?.dataQuality?.source
  ?.some((source) => managedSeasonSourceMarkers.has(source)) === true

const queue = seriesItems.filter((item) => {
  if (force) return true
  const hasSeasonsCount = Number.isFinite(item?.seasonsCount)
  const hasSeriesStatus = hasTargetStatus(item?.seriesStatus)
  return !hasSeasonsCount || !hasSeriesStatus || hasManagedSeasonSource(item)
})

const targets = maxItems ? queue.slice(0, maxItems) : queue
const wikidataTargetIds = targets
  .filter((item) => (
    !Number.isFinite(Number(item?.seasonsCount))
    || hasManagedSeasonSource(item)
  ))
  .map(parseKinopoiskId)
  .filter((value) => value != null)

let wikidataSeasons = {
  counts: new Map(),
  imdbIds: new Map(),
  sourceUrls: new Map(),
  conflicts: [],
  entityCount: 0,
}
let wikidataError = null
try {
  wikidataSeasons = await fetchWikidataSeasonsByKinopoiskIds(wikidataTargetIds)
} catch (error) {
  wikidataError = String(error?.message || error).slice(0, 300)
}

console.log(`Series total: ${seriesItems.length}`)
console.log(`Need enrichment: ${targets.length}`)
console.log(`API keys loaded: ${uniqueKeys.length}`)
console.log(`Wikidata exact entities loaded: ${wikidataSeasons.entityCount} (${wikidataSeasons.counts.size} season counts, ${wikidataSeasons.imdbIds.size} IMDb bridges)`)
if (wikidataError) console.log(`Wikidata unavailable: ${wikidataError}`)
if (!uniqueKeys.length) {
  console.log(useAdminSecrets
    ? 'No Kinopoisk keys found in the connected admin database or environment; using exact public fallbacks'
    : 'Kinopoisk admin secrets were not requested; using environment keys and exact public fallbacks')
}

let updated = 0
let skipped = 0
let fallbackStatusUsed = 0
let seasonsEndpointUsed = 0
let wikidataSeasonsUsed = 0
let tvmazeLookupUsed = 0
let tvmazeStatusUsed = 0
let tvmazeSeasonsUsed = 0
const skippedItems = []
const enrichedItems = []
const publicSourceConflicts = []
const sourceCounts = {
  kinopoisk: 0,
  wikidata: 0,
  tvmaze: 0,
  wikidata_tvmaze: 0,
}

const tvmazeShowCache = new Map()
const tvmazeSeasonsCache = new Map()

for (let index = 0; index < targets.length; index += 1) {
  const item = targets[index]
  const kinopoiskId = parseKinopoiskId(item)
  if (!kinopoiskId) {
    // Keep going: TVMaze fallback can still work through IMDb id.
  }

  const beforeSeasons = Number.isFinite(Number(item?.seasonsCount)) ? Number(item.seasonsCount) : null
  const beforeStatus = hasTargetStatus(item?.seriesStatus) ? item.seriesStatus : null
  const beforeManagedMarkers = (item?.dataQuality?.source ?? [])
    .filter((source) => managedSeasonSourceMarkers.has(source))
  const hadManagedSeasonSource = hasManagedSeasonSource(item)
  let seasonsCount = hadManagedSeasonSource ? null : beforeSeasons
  let seriesStatus = beforeStatus
  let seasonsSource = seasonsCount == null ? null : 'existing'
  let seasonsSourceUrl = null
  let seasonsCorroboratingSourceUrl = null
  let seasonConflict = null
  let details = null
  let kinopoiskError = null
  let tvmazeError = null

  try {
    if (kinopoiskId != null && canUseKinopoiskApi()) {
      details = await request(`/api/v2.2/films/${kinopoiskId}`)

      const seasonsFromDetails = Number(details?.seasons)
      if (seasonsCount == null && Number.isFinite(seasonsFromDetails) && seasonsFromDetails > 0) {
        seasonsCount = seasonsFromDetails
        seasonsSource = 'kinopoisk'
      }

      if (seasonsCount == null) {
        try {
          const seasonsData = await request(`/api/v2.2/films/${kinopoiskId}/seasons`)
          let endpointCount = null
          if (Number.isFinite(Number(seasonsData?.total))) {
            endpointCount = Number(seasonsData.total)
          } else if (Array.isArray(seasonsData?.items)) {
            endpointCount = seasonsData.items.length
          }
          if (Number.isInteger(endpointCount) && endpointCount > 0) {
            seasonsCount = endpointCount
            seasonsSource = 'kinopoisk'
          }
          seasonsEndpointUsed += 1
        } catch {
          // Keep null if the seasons endpoint is unavailable for this id.
        }
      }

      const completed = typeof details?.completed === 'boolean' ? details.completed : null
      if (completed != null) {
        seriesStatus = completed ? 'Закончен' : 'Еще выходит'
      }
    }
  } catch (error) {
    kinopoiskError = String(error?.message || error).slice(0, 220)
  }

  const imdbId = parseImdbId(item)
    ?? (kinopoiskId == null ? null : wikidataSeasons.imdbIds.get(String(kinopoiskId)) ?? null)
  let tvmazeCount = null
  let tvmazeSourceUrl = null
  if ((seasonsCount == null || !hasTargetStatus(seriesStatus)) && imdbId) {
    try {
      let tvmazeShow = tvmazeShowCache.get(imdbId)
      if (tvmazeShow === undefined) {
        tvmazeShow = await tvmazeRequestJson(`/lookup/shows?imdb=${encodeURIComponent(imdbId)}`)
        tvmazeShowCache.set(imdbId, tvmazeShow)
        tvmazeLookupUsed += 1
      }

      if (tvmazeShow) {
        if (!hasTargetStatus(seriesStatus)) {
          const mapped = mapTvmazeStatus(tvmazeShow.status)
          if (hasTargetStatus(mapped)) {
            seriesStatus = mapped
            tvmazeStatusUsed += 1
          }
        }

        if (seasonsCount == null && Number.isInteger(tvmazeShow?.id) && tvmazeShow.id > 0) {
          let cachedCount = tvmazeSeasonsCache.get(tvmazeShow.id)
          if (cachedCount === undefined) {
            const seasons = await tvmazeRequestJson(`/shows/${tvmazeShow.id}/seasons`)
            if (Array.isArray(seasons)) {
              const numbered = seasons.filter((entry) => Number.isFinite(Number(entry?.number)) && Number(entry.number) > 0)
              cachedCount = numbered.length || seasons.length || null
            } else {
              cachedCount = null
            }
            tvmazeSeasonsCache.set(tvmazeShow.id, cachedCount)
            if (cachedCount != null) tvmazeSeasonsUsed += 1
          }
          if (cachedCount != null) {
            tvmazeCount = cachedCount
            tvmazeSourceUrl = `https://www.tvmaze.com/shows/${tvmazeShow.id}`
          }
        }
      }
    } catch (error) {
      tvmazeError = String(error?.message || error).slice(0, 220)
    }
  }

  if (seasonsCount == null && kinopoiskId != null) {
    const wikidataCount = wikidataSeasons.counts.get(String(kinopoiskId))
    const wikidataSourceUrl = wikidataSeasons.sourceUrls.get(String(kinopoiskId)) ?? null
    if (
      Number.isInteger(tvmazeCount) && tvmazeCount > 0
      && Number.isInteger(wikidataCount) && wikidataCount > 0
      && tvmazeCount !== wikidataCount
    ) {
      seasonConflict = {
        id: item?.id ?? `kp_${kinopoiskId}`,
        kinopoiskId,
        wikidataCount,
        tvmazeCount,
        wikidataSourceUrl,
        tvmazeSourceUrl,
      }
      publicSourceConflicts.push(seasonConflict)
    } else if (
      Number.isInteger(tvmazeCount) && tvmazeCount > 0
      && Number.isInteger(wikidataCount) && wikidataCount > 0
    ) {
      seasonsCount = tvmazeCount
      seasonsSource = 'wikidata_tvmaze'
      seasonsSourceUrl = tvmazeSourceUrl
      seasonsCorroboratingSourceUrl = wikidataSourceUrl
      wikidataSeasonsUsed += 1
    } else if (Number.isInteger(tvmazeCount) && tvmazeCount > 0) {
      seasonsCount = tvmazeCount
      seasonsSource = 'tvmaze'
      seasonsSourceUrl = tvmazeSourceUrl
    } else if (Number.isInteger(wikidataCount) && wikidataCount > 0) {
      seasonsCount = wikidataCount
      seasonsSource = 'wikidata'
      seasonsSourceUrl = wikidataSourceUrl
      wikidataSeasonsUsed += 1
    }
  } else if (seasonsCount == null && Number.isInteger(tvmazeCount) && tvmazeCount > 0) {
    seasonsCount = tvmazeCount
    seasonsSource = 'tvmaze'
    seasonsSourceUrl = tvmazeSourceUrl
  }

  if (seasonsCount == null && beforeSeasons != null && seasonConflict == null) {
    seasonsCount = beforeSeasons
    seasonsSource = 'existing'
  }

  if (!hasTargetStatus(seriesStatus)) {
    seriesStatus = fallbackStatus(item, details)
    fallbackStatusUsed += 1
  }

  item.seriesStatus = seriesStatus
  if (seasonsCount != null) {
    item.seasonsCount = seasonsCount
  } else if (seasonConflict != null) {
    delete item.seasonsCount
  }

  if (item?.dataQuality && Array.isArray(item.dataQuality.source)) {
    const nextMarker = seasonConflict
      ? 'series_meta_conflict'
      : seasonsSource && seasonsSource !== 'existing'
        ? `series_meta_${seasonsSource}`
        : null
    if (nextMarker) {
      item.dataQuality.source = item.dataQuality.source
        .filter((source) => !managedSeasonSourceMarkers.has(source))
      item.dataQuality.source.push(nextMarker)
    } else if (!hasTargetStatus(beforeStatus) && !item.dataQuality.source.includes('series_status_fallback')) {
      item.dataQuality.source.push('series_status_fallback')
    }
  }

  const afterManagedMarkers = (item?.dataQuality?.source ?? [])
    .filter((source) => managedSeasonSourceMarkers.has(source))
  const changed = beforeSeasons !== seasonsCount
    || beforeStatus !== seriesStatus
    || JSON.stringify(beforeManagedMarkers) !== JSON.stringify(afterManagedMarkers)
  const stillMissingTarget = !Number.isFinite(Number(item?.seasonsCount)) || !hasTargetStatus(item?.seriesStatus)

  if (!changed && stillMissingTarget) {
    skipped += 1
    skippedItems.push({
      id: item?.id ?? (kinopoiskId != null ? `kp_${kinopoiskId}` : null),
      kinopoiskId,
      imdbId,
      reason: seasonConflict
        ? `public_source_conflict:wikidata=${seasonConflict.wikidataCount},tvmaze=${seasonConflict.tvmazeCount}`
        : kinopoiskError || tvmazeError || 'no_series_meta_source',
    })
    continue
  }

  if (seasonsCount != null && seasonsSource && seasonsSource !== 'existing') {
    sourceCounts[seasonsSource] += 1
    enrichedItems.push({
      id: item?.id ?? (kinopoiskId != null ? `kp_${kinopoiskId}` : null),
      kinopoiskId,
      previousSeasonsCount: beforeSeasons,
      seasonsCount,
      source: seasonsSource,
      sourceUrl: seasonsSourceUrl,
      corroboratingSourceUrl: seasonsCorroboratingSourceUrl,
    })
  }

  updated += 1

  const processed = index + 1
  if (processed % 25 === 0 || processed === targets.length) {
    console.log(`processed=${processed}/${targets.length} updated=${updated} skipped=${skipped}`)
  }
}

for (let index = 0; index < data.length; index += 1) {
  data[index] = applySeriesOverride(data[index], seriesOverrides)
}

await mkdir(resolve(outputPath, '..'), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')

const report = {
  generatedAt: new Date().toISOString(),
  inputPath,
  outputPath,
  totalSeries: seriesItems.length,
  requestedToEnrich: targets.length,
  updated,
  skipped,
  fallbackStatusUsed,
  seasonsEndpointUsed,
  wikidataEntitiesMatched: wikidataSeasons.entityCount,
  wikidataMatched: wikidataSeasons.counts.size,
  wikidataImdbBridges: wikidataSeasons.imdbIds.size,
  wikidataSeasonsUsed,
  wikidataConflicts: wikidataSeasons.conflicts,
  wikidataError,
  tvmazeLookupUsed,
  tvmazeStatusUsed,
  tvmazeSeasonsUsed,
  publicSourceConflicts,
  sourceCounts,
  keyUsage: keyState.map((entry, idx) => ({ index: idx + 1, used: entry.used, exhausted: entry.exhausted })),
  enrichedItems,
  skippedItems,
}

await mkdir(resolve(reportPath, '..'), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log('Done')
console.log(`updated=${updated}`)
console.log(`skipped=${skipped}`)
console.log(`out=${outputPath}`)
console.log(`report=${reportPath}`)
