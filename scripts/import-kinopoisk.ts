import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

type Mode = 'movie' | 'series'
type CollectionItem = Record<string, any> & { kinopoiskId: number }

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
if (!apiKey) throw new Error('Укажите KINOPOISK_API_KEY в окружении или .env.local')
const includeSeries = process.env.KINOPOISK_INCLUDE_SERIES === '1'
const includeStaff = process.env.KINOPOISK_INCLUDE_STAFF === '1'
const includeFacts = process.env.KINOPOISK_INCLUDE_FACTS === '1'
const includeAwards = process.env.KINOPOISK_INCLUDE_AWARDS === '1'

const api = 'https://kinopoiskapiunofficial.tech'
const request = async <T>(path: string, retries = 4): Promise<T> => {
  const response = await fetch(api + path, { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } })
  if ((response.status === 429 || response.status >= 500) && retries) {
    await new Promise((done) => setTimeout(done, (5 - retries) * 650))
    return request<T>(path, retries - 1)
  }
  if (!response.ok) throw new Error(`${response.status} ${path}`)
  return response.json() as Promise<T>
}

const getCollection = async (type: string, pages: number) => {
  const result: CollectionItem[] = []
  for (let page = 1; page <= pages; page += 1) {
    const response = await request<{ items: CollectionItem[] }>(`/api/v2.2/films/collections?type=${type}&page=${page}`)
    result.push(...response.items)
    process.stdout.write(`\r${type}: ${result.length} карточек`)
  }
  process.stdout.write('\n')
  return result
}

const loadTop500Ids = async () => {
  const top500Path = resolve(root, 'data', 'top500-ids.json')
  if (!existsSync(top500Path)) throw new Error('Файл data/top500-ids.json не найден. Сначала подготовьте список ID из Top-500.')
  const raw = await readFile(top500Path, 'utf8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('data/top500-ids.json должен быть массивом чисел')
  const ids = parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
  const unique = [...new Set(ids)]
  if (unique.length !== 500) {
    throw new Error(`Ожидалось 500 уникальных id в data/top500-ids.json, получено ${unique.length}`)
  }
  return unique
}

const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))
const inferLanguage = (countries: string[]) => {
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

const cleanText = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const person = (item: any) => ({ nameRu: item.nameRu || item.nameEn || 'Не указано', nameOriginal: item.nameEn || item.nameRu || '', photoUrl: item.posterUrl || null })
const enrich = async (items: CollectionItem[], mode: Mode, withStaff = false, withFacts = false, withAwards = false) => {
  const result: any[] = []
  let completed = 0
  for (const batch of chunks(items, 4)) {
    const rows = await Promise.all(batch.map(async (collection, sourceIndex) => {
      const detailsPromise = request<any>(`/api/v2.2/films/${collection.kinopoiskId}`).catch(() => collection)
      const staffPromise = withStaff ? request<any[]>(`/api/v1/staff?filmId=${collection.kinopoiskId}`).catch(() => []) : Promise.resolve<any[]>([])
      const factsPromise = withFacts
        ? request<{ items?: { text?: string; spoiler?: boolean }[] }>(`/api/v2.2/films/${collection.kinopoiskId}/facts`).catch(() => ({ items: [] }))
        : Promise.resolve<{ items?: { text?: string; spoiler?: boolean }[] }>({ items: [] })
      const awardsPromise = withAwards
        ? request<{ items?: { win?: boolean; name?: string; nominationName?: string; year?: number }[] }>(`/api/v2.2/films/${collection.kinopoiskId}/awards`).catch(() => ({ items: [] }))
        : Promise.resolve<{ items?: { win?: boolean; name?: string; nominationName?: string; year?: number }[] }>({ items: [] })
      const [details, staff, factsResponse, awardsResponse] = await Promise.all([
        detailsPromise,
        staffPromise,
        factsPromise,
        awardsPromise,
      ])
      const countries = (details.countries ?? collection.countries ?? []).map((entry: any) => entry.country).filter(Boolean)
      const genres = (details.genres ?? collection.genres ?? []).map((entry: any) => entry.genre).filter(Boolean).slice(0, 5)
      const directors = staff.filter((entry) => entry.professionKey === 'DIRECTOR').slice(0, 3).map(person)
      const writers = staff.filter((entry) => entry.professionKey === 'WRITER').slice(0, 3).map(person)
      const actors = staff.filter((entry) => entry.professionKey === 'ACTOR')
      const cast = actors.slice(0, 5).map(person)
      const supportingCast = actors.slice(5, 10).map(person)
      const facts = (factsResponse.items ?? [])
        .filter((entry) => entry?.text && !entry.spoiler)
        .map((entry) => cleanText(entry.text || ''))
        .filter(Boolean)
        .slice(0, 6)
      const awardsItems = awardsResponse.items ?? []
      const awardsWins = awardsItems.filter((award) => Boolean(award.win)).length
      const awards = withAwards
        ? {
            wins: awardsWins,
            nominations: Math.max(0, awardsItems.length - awardsWins),
            notable: awardsItems
              .slice(0, 3)
              .map((award) => cleanText(`${award.year ? `${award.year} · ` : ''}${award.name || ''}${award.nominationName ? ` — ${award.nominationName}` : ''}`))
              .filter(Boolean),
          }
        : null
      const rank = completed + sourceIndex + 1
      const titleRu = details.nameRu || collection.nameRu || details.nameOriginal || collection.nameOriginal || `Кинопоиск #${collection.kinopoiskId}`
      const yearNumber = Number(details.year || collection.year)
      const year = Number.isFinite(yearNumber) ? yearNumber : 2000
      const source = ['kinopoisk_top500_ids', 'kinopoisk_api_unofficial']
      if (withStaff) source.push('kinopoisk_api_staff')
      if (withFacts) source.push('kinopoisk_api_facts')
      if (withAwards) source.push('kinopoisk_api_awards')
      return {
        id: `kp_${collection.kinopoiskId}`,
        mode,
        titleRu,
        titleOriginal: details.nameOriginal || details.nameEn || collection.nameOriginal || collection.nameEn || '',
        alternativeTitles: [...new Set([details.nameEn, collection.nameEn, collection.nameOriginal].filter(Boolean))],
        year,
        endYear: details.endYear ? Number(details.endYear) : null,
        countries,
        originalLanguage: inferLanguage(countries),
        genres,
        ageRating: details.ratingAgeLimits ? String(details.ratingAgeLimits).replace('age', '') + '+' : null,
        runtimeMinutes: details.filmLength ?? null,
        directors,
        showrunners: mode === 'series' ? writers.slice(0, 2) : [],
        writers,
        cast,
        supportingCast,
        studios: [],
        kinopoiskId: collection.kinopoiskId,
        imdbId: details.imdbId ?? collection.imdbId ?? null,
        ratings: { kinopoisk: details.ratingKinopoisk ?? collection.ratingKinopoisk ?? null, imdb: details.ratingImdb ?? collection.ratingImdb ?? null },
        votes: { kinopoisk: details.ratingKinopoiskVoteCount ?? null, imdb: details.ratingImdbVoteCount ?? null },
        popularityScore: Math.max(20, Math.round(101 - rank * (mode === 'movie' ? .55 : 1.25))),
        budget: null,
        posterUrl: details.posterUrl || collection.posterUrl || null,
        backdropUrl: details.coverUrl || collection.coverUrl || null,
        description: details.description || details.shortDescription || collection.description || null,
        plotHint: cleanText(details.shortDescription || details.description || collection.description || ''),
        slogan: cleanText(details.slogan || ''),
        facts,
        awards,
        topRank: rank,
        dataQuality: { source, verified: true, missingFields: [] },
      }
    }))
    result.push(...rows)
    completed += batch.length
    process.stdout.write(`\r${mode}: обогащено ${completed}/${items.length}`)
  }
  process.stdout.write('\n')
  return result
}

const movieIds = await loadTop500Ids()
const moviesCollection = movieIds.map((kinopoiskId) => ({ kinopoiskId }))
const movies = await enrich(moviesCollection, 'movie', includeStaff, includeFacts, includeAwards)

const output = resolve(root, 'public', 'data')
await mkdir(output, { recursive: true })
let series: any[]
if (includeSeries) {
  const seriesCollection = await getCollection('TOP_250_TV_SHOWS', 2)
  series = await enrich(seriesCollection, 'series', includeStaff, includeFacts, includeAwards)
} else {
  const seriesPath = resolve(output, 'series.generated.json')
  series = existsSync(seriesPath) ? JSON.parse(await readFile(seriesPath, 'utf8')) : []
}

await Promise.all([
  writeFile(resolve(output, 'movies.generated.json'), JSON.stringify(movies, null, 2), 'utf8'),
  writeFile(resolve(output, 'series.generated.json'), JSON.stringify(series, null, 2), 'utf8'),
  writeFile(resolve(output, 'source.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    requestedSource: 'https://www.kinopoisk.ru/lists/movies/top500/',
    currentMovieSubset: 'Top-500 full list by fixed Kinopoisk IDs + details from API',
    api: 'https://kinopoiskapiunofficial.tech/documentation/api/',
    includeSeries,
    includeStaff,
    includeFacts,
    includeAwards,
    quotaSafeMode: !includeSeries && !includeStaff && !includeFacts && !includeAwards,
    sourceListIdCount: movieIds.length,
    movieCount: movies.length,
    seriesCount: series.length,
  }, null, 2), 'utf8'),
])
console.log(`Готово: ${movies.length} фильмов, ${series.length} сериалов. includeSeries=${includeSeries}, includeStaff=${includeStaff}, includeFacts=${includeFacts}, includeAwards=${includeAwards}`)
