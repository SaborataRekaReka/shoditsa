import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const envFile = resolve(root, '.env.local')

if (existsSync(envFile)) {
  const content = await readFile(envFile, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const [key, ...rest] = line.split('=')
    if (!key || !rest.length) continue
    if (key.trim().startsWith('#')) continue
    if (!process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim()
  }
}

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return fallback
  return args[index + 1]
}

const inputPath = resolve(root, argValue('--in', 'public/data/series.generated.json'))
const outputPath = resolve(root, argValue('--out', 'public/data/series.generated.json'))
const reportPath = resolve(root, argValue('--report', 'archive/reports/series-meta-enrichment-report.json'))
const force = args.includes('--force')
const maxItemsArg = Number(argValue('--max-items', '0'))
const maxItems = Number.isFinite(maxItemsArg) && maxItemsArg > 0 ? maxItemsArg : null

const keys = [
  ...String(process.env.KINOPOISK_API_KEYS || '')
    .split(/[\n,;\s]+/)
    .map((value) => value.trim())
    .filter(Boolean),
  ...(!process.env.KINOPOISK_API_KEY ? [] : [String(process.env.KINOPOISK_API_KEY).trim()]),
]

const uniqueKeys = [...new Set(keys)]

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

const data = await readCollection(inputPath)
const seriesItems = data.filter((item) => item?.mode === 'series')

const queue = seriesItems.filter((item) => {
  if (force) return true
  const hasSeasonsCount = Number.isFinite(item?.seasonsCount)
  const hasSeriesStatus = hasTargetStatus(item?.seriesStatus)
  return !hasSeasonsCount || !hasSeriesStatus
})

const targets = maxItems ? queue.slice(0, maxItems) : queue

console.log(`Series total: ${seriesItems.length}`)
console.log(`Need enrichment: ${targets.length}`)
console.log(`API keys loaded: ${uniqueKeys.length}`)
if (!uniqueKeys.length) {
  console.log('Kinopoisk API keys missing: will use TVMaze + offline fallback only')
}

let updated = 0
let skipped = 0
let fallbackStatusUsed = 0
let seasonsEndpointUsed = 0
let tvmazeLookupUsed = 0
let tvmazeStatusUsed = 0
let tvmazeSeasonsUsed = 0
const skippedItems = []

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
  let seasonsCount = beforeSeasons
  let seriesStatus = beforeStatus
  let details = null
  let kinopoiskError = null
  let tvmazeError = null

  try {
    if (kinopoiskId != null && canUseKinopoiskApi()) {
      details = await request(`/api/v2.2/films/${kinopoiskId}`)

      const seasonsFromDetails = Number(details?.seasons)
      if (seasonsCount == null && Number.isFinite(seasonsFromDetails) && seasonsFromDetails > 0) {
        seasonsCount = seasonsFromDetails
      }

      if (seasonsCount == null) {
        try {
          const seasonsData = await request(`/api/v2.2/films/${kinopoiskId}/seasons`)
          if (Number.isFinite(Number(seasonsData?.total))) {
            seasonsCount = Number(seasonsData.total)
          } else if (Array.isArray(seasonsData?.items)) {
            seasonsCount = seasonsData.items.length
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
          if (cachedCount != null) seasonsCount = cachedCount
        }
      }
    } catch (error) {
      tvmazeError = String(error?.message || error).slice(0, 220)
    }
  }

  if (!hasTargetStatus(seriesStatus)) {
    seriesStatus = fallbackStatus(item, details)
    fallbackStatusUsed += 1
  }

  item.seriesStatus = seriesStatus
  if (seasonsCount != null) item.seasonsCount = seasonsCount

  const changed = beforeSeasons !== seasonsCount || beforeStatus !== seriesStatus
  const stillMissingTarget = !Number.isFinite(Number(item?.seasonsCount)) || !hasTargetStatus(item?.seriesStatus)

  if (!changed && stillMissingTarget) {
    skipped += 1
    skippedItems.push({
      id: item?.id ?? (kinopoiskId != null ? `kp_${kinopoiskId}` : null),
      kinopoiskId,
      imdbId,
      reason: kinopoiskError || tvmazeError || 'no_series_meta_source',
    })
    continue
  }

  if (item?.dataQuality && Array.isArray(item.dataQuality.source)) {
    const marker = seasonsCount != null ? 'series_meta_tvmaze_or_kinopoisk' : 'series_status_fallback'
    if (!item.dataQuality.source.includes(marker)) item.dataQuality.source.push(marker)
  }

  updated += 1

  const processed = index + 1
  if (processed % 25 === 0 || processed === targets.length) {
    console.log(`processed=${processed}/${targets.length} updated=${updated} skipped=${skipped}`)
  }
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
  tvmazeLookupUsed,
  tvmazeStatusUsed,
  tvmazeSeasonsUsed,
  keyUsage: keyState.map((entry, idx) => ({ index: idx + 1, used: entry.used, exhausted: entry.exhausted })),
  skippedItems,
}

await mkdir(resolve(reportPath, '..'), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log('Done')
console.log(`updated=${updated}`)
console.log(`skipped=${skipped}`)
console.log(`out=${outputPath}`)
console.log(`report=${reportPath}`)