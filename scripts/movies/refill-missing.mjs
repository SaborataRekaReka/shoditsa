import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sanitizeMovieRecord } from '../shared/movie-hint-sanitize.mjs'

const root = resolve(import.meta.dirname, '../..')
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

const api = 'https://kinopoiskapiunofficial.tech'
const request = async (path, retries = 4) => {
  const response = await fetch(api + path, { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } })
  if ((response.status === 429 || response.status >= 500) && retries) {
    await new Promise((done) => setTimeout(done, (5 - retries) * 700))
    return request(path, retries - 1)
  }
  if (!response.ok) throw new Error(`${response.status} ${path}`)
  return response.json()
}

const inferLanguage = (countries) => {
  const first = countries?.[0] ?? ''
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

const moviesPath = resolve(root, 'public', 'data', 'movies.generated.json')
const movies = JSON.parse(await readFile(moviesPath, 'utf8'))

const isPlaceholder = (item) => {
  if (!Number.isInteger(item?.kinopoiskId)) return false
  const title = String(item.titleRu ?? '')
  const syntheticTitle = title.endsWith(`#${item.kinopoiskId}`)
  const sparseCore = (!item.titleOriginal || !String(item.titleOriginal).trim())
    && (!Array.isArray(item.genres) || item.genres.length === 0)
    && (!Array.isArray(item.countries) || item.countries.length === 0)
  return syntheticTitle || sparseCore
}

const pending = movies.filter(isPlaceholder)
console.log(`Pending refill: ${pending.length}`)
if (!pending.length) {
  console.log('Nothing to refill.')
  process.exit(0)
}

let updated = 0
let failed = 0
let quotaHit = false

for (let i = 0; i < pending.length; i += 1) {
  const movie = pending[i]
  try {
    const details = await request(`/api/v2.2/films/${movie.kinopoiskId}`)

    const countries = (details.countries ?? []).map((entry) => entry?.country || entry).filter(Boolean)
    const genres = (details.genres ?? []).map((entry) => entry?.genre || entry).filter(Boolean).slice(0, 5)

    movie.titleRu = details.nameRu || details.nameOriginal || details.nameEn || movie.titleRu
    movie.titleOriginal = details.nameOriginal || details.nameEn || movie.titleOriginal || ''

    const alternatives = new Set(Array.isArray(movie.alternativeTitles) ? movie.alternativeTitles : [])
    for (const alt of [details.nameEn, details.nameOriginal]) if (alt) alternatives.add(alt)
    movie.alternativeTitles = [...alternatives]

    const yearNumber = Number(details.year)
    if (Number.isFinite(yearNumber) && yearNumber > 1800) movie.year = yearNumber

    if (countries.length) movie.countries = countries
    if (!Array.isArray(movie.countries)) movie.countries = []
    if (genres.length) movie.genres = genres
    if (!Array.isArray(movie.genres)) movie.genres = []

    movie.originalLanguage = inferLanguage(movie.countries)
    movie.ageRating = details.ratingAgeLimits ? `${String(details.ratingAgeLimits).replace('age', '')}+` : (movie.ageRating ?? null)
    movie.runtimeMinutes = details.filmLength ?? movie.runtimeMinutes ?? null
    movie.imdbId = details.imdbId ?? movie.imdbId ?? null
    movie.ratings = {
      kinopoisk: details.ratingKinopoisk ?? movie.ratings?.kinopoisk ?? null,
      imdb: details.ratingImdb ?? movie.ratings?.imdb ?? null,
    }
    movie.votes = {
      kinopoisk: details.ratingKinopoiskVoteCount ?? movie.votes?.kinopoisk ?? null,
      imdb: details.ratingImdbVoteCount ?? movie.votes?.imdb ?? null,
    }

    movie.posterUrl = details.posterUrl || movie.posterUrl || null
    movie.backdropUrl = details.coverUrl || movie.backdropUrl || null
    movie.description = details.description || details.shortDescription || movie.description || null
    movie.plotHint = cleanText(details.shortDescription || details.description || movie.plotHint || movie.description || '') || null
    movie.slogan = cleanText(details.slogan || movie.slogan || '') || null

    if (!Array.isArray(movie.directors)) movie.directors = []
    if (!Array.isArray(movie.showrunners)) movie.showrunners = []
    if (!Array.isArray(movie.writers)) movie.writers = []
    if (!Array.isArray(movie.cast)) movie.cast = []
    if (!Array.isArray(movie.supportingCast)) movie.supportingCast = []
    if (!Array.isArray(movie.facts)) movie.facts = []
    if (!movie.awards || typeof movie.awards !== 'object') movie.awards = null

    const source = new Set(Array.isArray(movie.dataQuality?.source) ? movie.dataQuality.source : [])
    source.add('kinopoisk_api_unofficial_refill')
    movie.dataQuality = {
      source: [...source],
      verified: true,
      missingFields: Array.isArray(movie.dataQuality?.missingFields) ? movie.dataQuality.missingFields : [],
    }

    Object.assign(movie, sanitizeMovieRecord(movie))

    updated += 1
    process.stdout.write(`\rRefilled ${updated}/${pending.length}`)
  } catch (error) {
    failed += 1
    const message = String(error?.message ?? error)
    process.stdout.write(`\rRefilled ${updated}/${pending.length}, failed ${failed}`)
    if (message.includes('402')) {
      quotaHit = true
      break
    }
  }
}

process.stdout.write('\n')
await writeFile(moviesPath, JSON.stringify(movies, null, 2), 'utf8')

const remaining = movies.filter(isPlaceholder).length
console.log(`Updated: ${updated}`)
console.log(`Failed: ${failed}`)
console.log(`Remaining placeholders: ${remaining}`)
console.log(`Quota hit: ${quotaHit}`)
