import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
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

const modeArg = String(argValue('--mode', 'movie')).toLowerCase()
if (!['movie', 'series'].includes(modeArg)) throw new Error('Invalid --mode. Use "movie" or "series"')
const mode = modeArg
const mergeOutput = args.includes('--merge')

const idsPath = resolve(root, argValue('--ids', 'data/kinopoisk-navigator-ids.json'))
const outPath = resolve(root, argValue('--out', mode === 'series' ? 'public/data/series.generated.json' : 'public/data/movies.generated.json'))
const moviesPath = resolve(root, argValue('--movies', 'public/data/movies.generated.json'))
const seriesPath = resolve(root, argValue('--series', 'public/data/series.generated.json'))
const sourcePath = resolve(root, argValue('--source', 'public/data/source.json'))
const skippedPath = resolve(root, argValue('--skipped', 'data/kinopoisk-navigator-skipped.json'))
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
if (!uniqueKeys.length) throw new Error('Set KINOPOISK_API_KEYS or KINOPOISK_API_KEY')

const api = 'https://kinopoiskapiunofficial.tech'
const delay = (ms) => new Promise((resolveDone) => setTimeout(resolveDone, ms))

const keyState = uniqueKeys.map((key) => ({
  key,
  exhausted: false,
  cooldownUntil: 0,
  used: 0,
  failures: 0,
}))

let pointer = 0

const activeStates = () => keyState.filter((entry) => !entry.exhausted)

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

const inferLanguage = (countries) => {
  const first = countries[0] ?? ''
  if (['Россия', 'СССР', 'Беларусь', 'Казахстан'].includes(first)) return 'ru'
  if (first === 'Франция') return 'fr'
  if (first === 'Италия') return 'it'
  if (first === 'Испания') return 'es'
  if (first === 'Германия') return 'de'
  if (first === 'Япония') return 'ja'
  if (first === 'Корея Южная') return 'ko'
  return 'en'
}

const cleanText = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const person = (item) => ({
  nameRu: item?.nameRu || item?.nameEn || 'Не указано',
  nameOriginal: item?.nameEn || item?.nameRu || '',
  photoUrl: item?.posterUrl || null,
})

const isValidYear = (year) => Number.isFinite(year) && year > 1880 && year < 2100

const missingCore = (item) => {
  const miss = []
  if (!item.titleRu) miss.push('titleRu')
  if (!isValidYear(item.year) && !isValidYear(item.endYear)) miss.push('year')
  if (!Array.isArray(item.countries) || !item.countries.length) miss.push('countries')
  if (!Array.isArray(item.genres) || !item.genres.length) miss.push('genres')

  if (mode === 'movie') {
    if (!Array.isArray(item.directors) || !item.directors.length) miss.push('directors')
    if (!Array.isArray(item.cast) || !item.cast.length) miss.push('cast')
  }

  return miss
}

const readCollection = async (pathToJson) => {
  if (!existsSync(pathToJson)) return []
  try {
    const parsed = JSON.parse(await readFile(pathToJson, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const idsRaw = JSON.parse(await readFile(idsPath, 'utf8'))
if (!Array.isArray(idsRaw)) throw new Error(`IDs file is not an array: ${idsPath}`)

const ids = [...new Set(idsRaw.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
const targetIds = maxItems ? ids.slice(0, maxItems) : ids

const items = []
const skipped = []
let processed = 0

console.log(`IDs loaded: ${targetIds.length}`)
console.log(`API keys loaded: ${uniqueKeys.length}`)
console.log(`Mode: ${mode}`)

for (const kinopoiskId of targetIds) {
  processed += 1
  try {
    const details = await request(`/api/v2.2/films/${kinopoiskId}`)
    const staff = await request(`/api/v1/staff?filmId=${kinopoiskId}`)

    const countries = (details.countries ?? []).map((entry) => entry?.country).filter(Boolean)
    const genres = (details.genres ?? []).map((entry) => entry?.genre).filter(Boolean).slice(0, 5)
    const directors = staff.filter((entry) => entry.professionKey === 'DIRECTOR').slice(0, 3).map(person)
    const writers = staff.filter((entry) => entry.professionKey === 'WRITER').slice(0, 3).map(person)
    const producers = staff.filter((entry) => entry.professionKey === 'PRODUCER').slice(0, 3).map(person)
    const actors = staff.filter((entry) => entry.professionKey === 'ACTOR')
    const cast = actors.slice(0, 5).map(person)
    const supportingCast = actors.slice(5, 10).map(person)
    const showrunners = mode === 'series'
      ? [...new Map([...writers, ...producers].map((entry) => [entry.nameRu, entry])).values()].slice(0, 2)
      : []

    const yearNumber = Number(details.year)
    const item = {
      id: `kp_${kinopoiskId}`,
      mode,
      titleRu: details.nameRu || details.nameOriginal || details.nameEn || `Кинопоиск #${kinopoiskId}`,
      titleOriginal: details.nameOriginal || details.nameEn || '',
      alternativeTitles: [...new Set([details.nameEn, details.nameOriginal].filter(Boolean))],
      year: Number.isFinite(yearNumber) ? yearNumber : null,
      endYear: details.endYear ? Number(details.endYear) : null,
      countries,
      originalLanguage: inferLanguage(countries),
      genres,
      ageRating: details.ratingAgeLimits ? `${String(details.ratingAgeLimits).replace('age', '')}+` : null,
      runtimeMinutes: details.filmLength ?? null,
      directors,
      showrunners,
      writers,
      cast,
      supportingCast,
      studios: [],
      kinopoiskId,
      imdbId: details.imdbId ?? null,
      ratings: {
        kinopoisk: details.ratingKinopoisk ?? null,
        imdb: details.ratingImdb ?? null,
      },
      votes: {
        kinopoisk: details.ratingKinopoiskVoteCount ?? null,
        imdb: details.ratingImdbVoteCount ?? null,
      },
      popularityScore: Math.max(20, Math.round(101 - processed * 0.15)),
      budget: null,
      posterUrl: details.posterUrl || null,
      backdropUrl: details.coverUrl || null,
      description: details.description || details.shortDescription || null,
      plotHint: cleanText(details.shortDescription || details.description || ''),
      slogan: cleanText(details.slogan || ''),
      facts: [],
      awards: null,
      topRank: processed,
      dataQuality: {
        source: ['kinopoisk_navigator_ids', 'kinopoisk_api_unofficial', 'kinopoisk_api_staff'],
        verified: true,
        missingFields: [],
      },
    }

    const miss = missingCore(item)
    if (miss.length) {
      skipped.push({ kinopoiskId, reason: `missing:${miss.join(',')}` })
      continue
    }

    items.push(item)
  } catch (error) {
    skipped.push({ kinopoiskId, reason: String(error?.message || error).slice(0, 220) })
  }

  if (processed % 25 === 0 || processed === targetIds.length) {
    console.log(`processed=${processed}/${targetIds.length} added=${items.length} skipped=${skipped.length}`)
  }
}

const sorted = items.sort((a, b) => (b.ratings.kinopoisk ?? 0) - (a.ratings.kinopoisk ?? 0))

let outputItems = sorted
if (mergeOutput) {
  const existing = await readCollection(outPath)
  const merged = new Map(existing.map((entry) => [entry?.id || `kp_${entry?.kinopoiskId}`, entry]))
  for (const entry of sorted) merged.set(entry.id, entry)
  outputItems = [...merged.values()]
}

outputItems = outputItems
  .filter((entry) => entry && typeof entry === 'object')
  .sort((a, b) => (b?.ratings?.kinopoisk ?? 0) - (a?.ratings?.kinopoisk ?? 0))

outputItems.forEach((entry, index) => {
  entry.mode = mode
  entry.topRank = index + 1
})

await mkdir(resolve(outPath, '..'), { recursive: true })
await writeFile(outPath, `${JSON.stringify(outputItems, null, 2)}\n`, 'utf8')

const movieCount = mode === 'movie' ? outputItems.length : (await readCollection(moviesPath)).length
const seriesCount = mode === 'series' ? outputItems.length : (await readCollection(seriesPath)).length

await writeFile(
  sourcePath,
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    requestedSource: 'https://www.kinopoisk.ru/top/navigator/',
    currentMovieSubset: mode === 'movie' ? 'Navigator IDs + details + staff, incomplete titles skipped' : undefined,
    currentSeriesSubset: mode === 'series' ? 'Navigator IDs + details + staff, incomplete titles skipped' : undefined,
    api: 'https://kinopoiskapiunofficial.tech/documentation/api/',
    includeSeries: mode === 'series',
    includeStaff: true,
    includeFacts: false,
    includeAwards: false,
    sourceListIdCount: targetIds.length,
    mode,
    mergeOutput,
    outputCount: outputItems.length,
    movieCount,
    skippedCount: skipped.length,
    seriesCount,
    keyUsage: keyState.map((entry, index) => ({ index: index + 1, used: entry.used, exhausted: entry.exhausted })),
  }, null, 2)}\n`,
  'utf8',
)

await mkdir(resolve(skippedPath, '..'), { recursive: true })
await writeFile(skippedPath, `${JSON.stringify(skipped, null, 2)}\n`, 'utf8')

console.log('Done:')
console.log(`added=${sorted.length}`)
console.log(`output=${outputItems.length}`)
console.log(`skipped=${skipped.length}`)
console.log(`out=${outPath}`)
console.log(`skippedFile=${skippedPath}`)
