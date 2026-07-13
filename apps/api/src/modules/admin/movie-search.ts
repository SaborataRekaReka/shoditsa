import { ApiError } from '../../lib/errors.js'

export type KinopoiskMovieMatch = {
  kinopoiskId: number
  title: string
  year: number
}

type KinopoiskSearchResult = {
  filmId?: unknown
  nameRu?: unknown
  nameEn?: unknown
  year?: unknown
  type?: unknown
}

export const normalizeMovieTitle = (value: unknown) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU')
  .replaceAll('ё', 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim()

export const searchKinopoiskMovie = async (
  query: string,
  requestedYear: number | null,
  keyList: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KinopoiskMovieMatch | null> => {
  const keys = [...new Set(keyList.split(/[,;\s]+/).map((value) => value.trim()).filter(Boolean))]
  if (!keys.length) throw new ApiError(409, 'KINOPOISK_API_KEY_REQUIRED', 'Добавьте ключ Кинопоиск Unofficial API в разделе «API-интеграции»')

  let lastFailure = ''
  for (const key of keys) {
    try {
      const response = await fetchImpl(`https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(query)}&page=1`, {
        headers: { 'X-API-KEY': key, Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) {
        lastFailure = `HTTP ${response.status}`
        if ([401, 402, 403, 429].includes(response.status) || response.status >= 500) continue
        throw new ApiError(502, 'KINOPOISK_SEARCH_FAILED', `Кинопоиск не смог найти «${query}»`)
      }

      const payload = await response.json() as { films?: unknown }
      const films = (Array.isArray(payload.films) ? payload.films : [])
        .map((entry) => entry && typeof entry === 'object' ? entry as KinopoiskSearchResult : {})
        .filter((entry) => ['FILM', 'VIDEO', 'TV_MOVIE'].includes(String(entry.type ?? '').toUpperCase()))
        .map((entry) => ({
          kinopoiskId: Number(entry.filmId),
          title: String(entry.nameRu || entry.nameEn || '').trim(),
          year: Number.parseInt(String(entry.year ?? ''), 10),
          normalizedTitles: [entry.nameRu, entry.nameEn].map(normalizeMovieTitle).filter(Boolean),
        }))
        .filter((entry) => Number.isSafeInteger(entry.kinopoiskId) && entry.kinopoiskId > 0)

      const yearMatches = requestedYear ? films.filter((entry) => entry.year === requestedYear) : films
      if (!yearMatches.length) return null
      const normalizedQuery = normalizeMovieTitle(query)
      const score = (entry: typeof yearMatches[number]) => entry.normalizedTitles.includes(normalizedQuery)
        ? 2
        : entry.normalizedTitles.some((title) => title.startsWith(normalizedQuery) || normalizedQuery.startsWith(title)) ? 1 : 0
      const match = yearMatches.sort((left, right) => score(right) - score(left))[0]
      return { kinopoiskId: match.kinopoiskId, title: match.title, year: match.year }
    } catch (error) {
      if (error instanceof ApiError) throw error
      lastFailure = error instanceof Error ? error.message : String(error)
    }
  }

  throw new ApiError(502, 'KINOPOISK_SEARCH_FAILED', `Не удалось выполнить поиск Кинопоиска для «${query}»${lastFailure ? ` (${lastFailure})` : ''}`)
}
