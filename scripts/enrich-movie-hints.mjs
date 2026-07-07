import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sanitizeMovieRecord } from './movie-hint-sanitize.mjs'

const root = resolve(import.meta.dirname, '..')
const envFile = resolve(root, '.env.local')
if (!process.env.KINOPOISK_API_KEY && existsSync(envFile)) {
  const content = await readFile(envFile, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const [key, ...value] = line.split('=')
    if (key && value.length && !key.trim().startsWith('#')) process.env[key.trim()] = value.join('=').trim()
  }
}

const apiKey = process.env.KINOPOISK_API_KEY
if (!apiKey) throw new Error('Set KINOPOISK_API_KEY in environment or .env.local')

const batchSize = Number(process.env.KINOPOISK_HINT_BATCH || 60)
const fetchDetails = process.env.KINOPOISK_HINTS_FETCH_DETAILS !== '0'
const fetchStaff = process.env.KINOPOISK_HINTS_FETCH_STAFF !== '0'
const fetchFacts = process.env.KINOPOISK_HINTS_FETCH_FACTS !== '0'
const fetchAwards = process.env.KINOPOISK_HINTS_FETCH_AWARDS !== '0'

const SOURCE_DETAILS = 'kinopoisk_api_hints_details'
const SOURCE_STAFF = 'kinopoisk_api_staff'
const SOURCE_FACTS = 'kinopoisk_api_facts'
const SOURCE_AWARDS = 'kinopoisk_api_awards'

const cleanText = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const person = (item) => ({
  nameRu: item?.nameRu || item?.nameEn || 'Не указано',
  nameOriginal: item?.nameEn || item?.nameRu || '',
  photoUrl: item?.posterUrl || null,
})

const api = 'https://kinopoiskapiunofficial.tech'
const request = async (path, retries = 4) => {
  const response = await fetch(api + path, {
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
  })
  if ((response.status === 429 || response.status >= 500) && retries) {
    await new Promise((done) => setTimeout(done, (5 - retries) * 750))
    return request(path, retries - 1)
  }
  if (!response.ok) {
    const error = new Error(`${response.status} ${path}`)
    error.statusCode = response.status
    throw error
  }
  return response.json()
}

const moviesPath = resolve(root, 'public', 'data', 'movies.generated.json')
const sourcePath = resolve(root, 'public', 'data', 'source.json')
const movies = JSON.parse(await readFile(moviesPath, 'utf8'))
const source = existsSync(sourcePath) ? JSON.parse(await readFile(sourcePath, 'utf8')) : {}

const needsDetails = (item, sourceSet) =>
  fetchDetails && (!sourceSet.has(SOURCE_DETAILS) || !cleanText(item.plotHint || item.description) || item.slogan === undefined)
const needsStaff = (item, sourceSet) =>
  fetchStaff && (
    !sourceSet.has(SOURCE_STAFF)
    || !Array.isArray(item.cast)
    || !Array.isArray(item.supportingCast)
    || item.cast.length === 0
    || item.supportingCast.length === 0
  )
const needsFacts = (item, sourceSet) =>
  fetchFacts && (!sourceSet.has(SOURCE_FACTS) || !Array.isArray(item.facts) || item.facts.length === 0)
const needsAwards = (item, sourceSet) =>
  fetchAwards && (
    !sourceSet.has(SOURCE_AWARDS)
    || !item.awards
    || typeof item.awards !== 'object'
    || !Array.isArray(item.awards.notable)
  )

const pending = movies.filter((item) => {
  if (!Number.isInteger(item?.kinopoiskId)) return false
  const sourceSet = new Set(Array.isArray(item?.dataQuality?.source) ? item.dataQuality.source : [])
  return needsDetails(item, sourceSet) || needsStaff(item, sourceSet) || needsFacts(item, sourceSet) || needsAwards(item, sourceSet)
}).slice(0, Math.max(1, batchSize))

console.log(`Pending movies in this batch: ${pending.length}`)
if (!pending.length) {
  console.log('Nothing to enrich.')
  process.exit(0)
}

let processed = 0
let updated = 0
let failed = 0
let requestCount = 0
let quotaHit = false

const flush = async () => {
  await writeFile(moviesPath, JSON.stringify(movies, null, 2), 'utf8')
}

for (const movie of pending) {
  const sourceSet = new Set(Array.isArray(movie?.dataQuality?.source) ? movie.dataQuality.source : [])
  let changed = false

  try {
    if (needsDetails(movie, sourceSet)) {
      const details = await request(`/api/v2.2/films/${movie.kinopoiskId}`)
      requestCount += 1
      movie.plotHint = cleanText(details.shortDescription || details.description || movie.plotHint || movie.description || '') || null
      movie.description = details.description || details.shortDescription || movie.description || null
      movie.slogan = cleanText(details.slogan || movie.slogan || '') || null
      sourceSet.add(SOURCE_DETAILS)
      changed = true
    }

    if (needsStaff(movie, sourceSet)) {
      const staff = await request(`/api/v1/staff?filmId=${movie.kinopoiskId}`)
      requestCount += 1
      const actors = Array.isArray(staff) ? staff.filter((entry) => entry.professionKey === 'ACTOR') : []
      movie.cast = actors.slice(0, 5).map(person)
      movie.supportingCast = actors.slice(5, 10).map(person)
      sourceSet.add(SOURCE_STAFF)
      changed = true
    }

    if (needsFacts(movie, sourceSet)) {
      const factsResponse = await request(`/api/v2.2/films/${movie.kinopoiskId}/facts`)
      requestCount += 1
      movie.facts = (factsResponse.items ?? [])
        .filter((entry) => entry?.text && !entry.spoiler)
        .map((entry) => cleanText(entry.text || ''))
        .filter(Boolean)
        .slice(0, 8)
      sourceSet.add(SOURCE_FACTS)
      changed = true
    }

    if (changed) Object.assign(movie, sanitizeMovieRecord(movie))

    if (needsAwards(movie, sourceSet)) {
      const awardsResponse = await request(`/api/v2.2/films/${movie.kinopoiskId}/awards`)
      requestCount += 1
      const awardsItems = awardsResponse.items ?? []
      const wins = awardsItems.filter((award) => Boolean(award.win)).length
      movie.awards = {
        wins,
        nominations: Math.max(0, awardsItems.length - wins),
        notable: awardsItems
          .slice(0, 3)
          .map((award) => cleanText(`${award.year ? `${award.year} · ` : ''}${award.name || ''}${award.nominationName ? ` — ${award.nominationName}` : ''}`))
          .filter(Boolean),
      }
      sourceSet.add(SOURCE_AWARDS)
      changed = true
    }

    if (changed) Object.assign(movie, sanitizeMovieRecord(movie))

    movie.dataQuality = {
      source: [...sourceSet],
      verified: true,
      missingFields: Array.isArray(movie?.dataQuality?.missingFields) ? movie.dataQuality.missingFields : [],
    }

    processed += 1
    if (changed) updated += 1
    if (processed % 8 === 0) await flush()
    process.stdout.write(`\rProcessed ${processed}/${pending.length} | updated ${updated} | req ${requestCount}`)
  } catch (error) {
    failed += 1
    const statusCode = Number(error?.statusCode)
    const message = String(error?.message || error)
    process.stdout.write(`\rProcessed ${processed}/${pending.length} | updated ${updated} | failed ${failed} | req ${requestCount}`)
    if (statusCode === 402 || message.includes('402')) {
      quotaHit = true
      break
    }
  }
}

process.stdout.write('\n')
await flush()

const coverage = {
  withPlotHint: movies.filter((movie) => cleanText(movie.plotHint || movie.description)).length,
  withSlogan: movies.filter((movie) => cleanText(movie.slogan)).length,
  withMainCast: movies.filter((movie) => Array.isArray(movie.cast) && movie.cast.length > 0).length,
  withSupportingCast: movies.filter((movie) => Array.isArray(movie.supportingCast) && movie.supportingCast.length > 0).length,
  withFacts: movies.filter((movie) => Array.isArray(movie.facts) && movie.facts.length > 0).length,
  withAwards: movies.filter((movie) => movie.awards && typeof movie.awards === 'object').length,
}

source.generatedAt = new Date().toISOString()
source.hintEnrichment = {
  processed,
  updated,
  failed,
  requestCount,
  quotaHit,
  batchSize,
  coverage,
}
source.note = 'Hint enrichment is available: plot/slogan/cast/facts/awards data is being filled incrementally by batch'
await writeFile(sourcePath, JSON.stringify(source, null, 2), 'utf8')

console.log(`Processed: ${processed}`)
console.log(`Updated: ${updated}`)
console.log(`Failed: ${failed}`)
console.log(`Requests used: ${requestCount}`)
console.log(`Quota hit: ${quotaHit}`)
console.log(`Coverage: ${JSON.stringify(coverage)}`)
