export type ManualArtist = { artist: string; country?: string; hint?: string }
export type ManualMovie = { kinopoiskId: number; hint?: string } | { query: string; year?: number }
export type ManualAnime = { shikimoriId: number; hint?: string }

const parseIdAndHint = (line: string) => {
  const [rawId, ...rest] = line.split(/[;,\t]/).map((entry) => entry.trim().replace(/^"|"$/g, ''))
  const hint = rest.join(' ').trim()
  return { rawId, hint: hint || undefined }
}

const positiveInteger = (value: string | undefined) => {
  if (!value || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

const parseKinopoiskId = (line: string, rawId: string) => {
  const urlMatch = line.match(/(?:https?:\/\/)?(?:www\.)?kinopoisk\.ru\/(?:film|series)\/(\d+)(?:[/?#]|$)/i)
  if (urlMatch) return positiveInteger(urlMatch[1])
  const prefixed = rawId.match(/^(?:kp|kinopoisk)[_:-]?(\d+)$/i)
  return positiveInteger(prefixed?.[1] ?? rawId)
}

const parseShikimoriId = (line: string, rawId: string) => {
  const urlMatch = line.match(/(?:https?:\/\/)?(?:www\.)?shikimori\.(?:one|io)\/(?:animes?|anime)\/(\d+)(?:[/?#]|$)/i)
  if (urlMatch) return positiveInteger(urlMatch[1])
  const prefixed = rawId.match(/^(?:shiki|shikimori)[_:-]?(\d+)$/i)
  return positiveInteger(prefixed?.[1] ?? rawId)
}

const parseMovieQuery = (line: string): { query: string; year?: number } | null => {
  const unquoted = line.trim().replace(/^"|"$/g, '')
  const parenthesizedYear = unquoted.match(/\s*\([^()]*(?:,\s*)?((?:18|19|20|21)\d{2})\)\s*$/)
  const commaYear = parenthesizedYear ? null : unquoted.match(/,\s*((?:18|19|20|21)\d{2})\s*$/)
  const yearMatch = parenthesizedYear ?? commaYear
  const query = (yearMatch ? unquoted.slice(0, yearMatch.index) : unquoted).trim()
  if (!query) return null
  return { query, ...(yearMatch ? { year: Number(yearMatch[1]) } : {}) }
}

export const parseArtistList = (value: string): ManualArtist[] => value.split(/\r?\n/).flatMap((raw, index) => {
  const line = raw.trim()
  if (!line || (index === 0 && /^(artist|исполнитель)([,;\t]|$)/i.test(line))) return []
  const separator = line.includes('\t') ? '\t' : line.includes(';') ? ';' : line.includes(',') ? ',' : null
  const parts = separator ? line.split(separator).map((entry) => entry.trim().replace(/^"|"$/g, '')) : [line]
  return [{ artist: parts[0], ...(parts[1] ? { country: parts[1] } : {}), ...(parts.slice(2).join(' ').trim() ? { hint: parts.slice(2).join(' ').trim() } : {}) }]
}).slice(0, 500)

export const parseMovieList = (value: string): ManualMovie[] => {
  const movies: ManualMovie[] = []
  for (const [index, raw] of value.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line || (index === 0 && /^(kinopoisk|кинопоиск|id)([,;\t]|$)/i.test(line))) continue
    const { rawId, hint } = parseIdAndHint(line)
    const kinopoiskId = parseKinopoiskId(line, rawId)
    if (kinopoiskId) movies.push({ kinopoiskId, ...(hint ? { hint } : {}) })
    else {
      const query = parseMovieQuery(line)
      if (query) movies.push(query)
    }
    if (movies.length === 500) break
  }
  return movies
}

export const parseAnimeList = (value: string): ManualAnime[] => value.split(/\r?\n/).flatMap((raw, index) => {
  const line = raw.trim()
  if (!line || (index === 0 && /^(shikimori|шикимори|id)([,;\t]|$)/i.test(line))) return []
  const { rawId, hint } = parseIdAndHint(line)
  const shikimoriId = parseShikimoriId(line, rawId)
  return shikimoriId ? [{ shikimoriId, ...(hint ? { hint } : {}) }] : []
}).slice(0, 500)