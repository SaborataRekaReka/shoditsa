import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildPlotHint, cleanText, titleTokens, titleVariants } from './plot-hint.mjs'

const API_BASE = 'https://shikimori.io'
const REDACTION = '[REDACTED]'
const WORD_CHAR_CLASS = 'A-Za-zА-Яа-яЁё0-9'

const root = resolve(import.meta.dirname, '..')
const envFile = resolve(root, '.env.local')

if (existsSync(envFile)) {
  const content = await readFile(envFile, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const [rawKey, ...rawRest] = line.split('=')
    if (!rawKey || !rawRest.length) continue
    const key = rawKey.trim()
    if (!key || key.startsWith('#')) continue
    if (process.env[key]) continue
    process.env[key] = rawRest.join('=').trim()
  }
}

const args = process.argv.slice(2)
const hasFlag = (name) => args.includes(name)
const argValue = (name, fallback) => {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return fallback
  return args[index + 1]
}

const toInteger = (value, fallback) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const sleep = (ms) => new Promise((resolveDone) => setTimeout(resolveDone, ms))

const maxItems = clamp(toInteger(argValue('--max-items', '500'), 500), 1, 5000)
const perPage = clamp(toInteger(argValue('--limit', '50'), 50), 1, 50)
const startPage = Math.max(1, toInteger(argValue('--page-start', '1'), 1))
const delayMs = Math.max(0, toInteger(argValue('--delay-ms', '700'), 700))
const fetchRoles = hasFlag('--fetch-roles')
const keepNsfw = hasFlag('--keep-nsfw')
const statusFilter = cleanText(argValue('--status', ''))
const kindFilter = cleanText(argValue('--kind', ''))
const globalLoreKeywords = cleanText(argValue('--lore-keywords', ''))
  .split(',')
  .map((value) => cleanText(value))
  .filter(Boolean)

const outPath = resolve(root, argValue('--out', 'public/data/animes.generated.json'))
const sourcePath = resolve(root, argValue('--source', 'public/data/source.json'))
const skippedPath = resolve(root, argValue('--skipped', 'data/shikimori-anime-skipped.json'))

const userAgent = String(
  process.env.SHIKIMORI_USER_AGENT
  || process.env.SHIKIMORI_APP_NAME
  || process.env.SHIKIMORI_APPLICATION_NAME
  || 'seans-anime-import/1.0',
).trim()

if (!userAgent) throw new Error('User-Agent is required. Set SHIKIMORI_USER_AGENT in .env.local')

const requestHeaders = {
  'User-Agent': userAgent,
  Accept: 'application/json',
}

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const uniqueStrings = (values) => [...new Set(values.map((value) => cleanText(value)).filter(Boolean))]
const toNumberOrNull = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
const toIntOrNull = (value) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : null
}

const toAbsoluteUrl = (value) => {
  const text = cleanText(value)
  if (!text) return null
  if (/^https?:\/\//i.test(text)) return text
  return `${API_BASE}${text.startsWith('/') ? text : `/${text}`}`
}

const stripShikiMarkup = (value) => String(value || '')
  .replace(/\[\[([^\[\]]+)\]\]/g, '$1')
  .replace(/\[\/?[a-z_]+(?:=[^\]]+)?\]/gi, ' ')

const stripHtml = (value) => cleanText(stripShikiMarkup(String(value || '').replace(/<[^>]+>/g, ' ')))
const pickYear = (value) => {
  const text = cleanText(value)
  const match = text.match(/\b(19\d{2}|20\d{2})\b/)
  if (!match) return null
  const year = Number(match[1])
  return Number.isFinite(year) ? year : null
}

const KIND_LABELS = {
  tv: 'TV сериал',
  movie: 'Фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Спешл',
  tv_special: 'TV спешл',
  music: 'Музыкальный клип',
  pv: 'Промо',
  cm: 'Реклама',
}

const STATUS_LABELS = {
  anons: 'Анонс',
  ongoing: 'Онгоинг',
  released: 'Вышло',
}

const SOURCE_LABELS = {
  original: 'Оригинал',
  manga: 'Манга',
  novel: 'Роман',
  light_novel: 'Ранобэ',
  visual_novel: 'Визуальная новелла',
  game: 'Игра',
  web_manga: 'Веб-манга',
  card_game: 'Карточная игра',
  radio: 'Радио',
  music: 'Музыка',
  other: 'Другое',
  unknown: 'Неизвестно',
}

const AGE_LABELS = {
  none: null,
  g: 'G',
  pg: 'PG',
  pg_13: 'PG-13',
  r: 'R',
  r_plus: 'R+',
  rx: 'Rx',
}

const normalizedKeywordList = (values, minLength = 4) => {
  const seen = new Set()
  const result = []
  for (const value of values) {
    const cleaned = cleanText(value)
    if (!cleaned) continue
    const normalized = cleaned.toLowerCase()
    if (normalized.length < minLength) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(cleaned)
  }
  return result
}

const normalizeHint = (value, maxLength = 220) => {
  let text = cleanText(value)
  if (!text) return ''
  text = text
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(?:\[\s*REDACTED\s*\][\s,;:]*){2,}/gi, `${REDACTION} `)
    .replace(/^[\s,;:!?-]+/, '')
    .replace(/[\s,;:!?-]+$/, '')
    .trim()

  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength).trimEnd()}...`
  }
  return text
}

const replaceBounded = (text, keyword) => {
  const source = cleanText(keyword)
  if (!source) return text
  const escaped = escapeRegExp(source)
  const pattern = new RegExp(`(^|[^${WORD_CHAR_CLASS}])${escaped}(?=$|[^${WORD_CHAR_CLASS}])`, 'giu')
  return text.replace(pattern, `$1${REDACTION}`)
}

const extractBracketKeywords = (value) => {
  const text = String(value || '')
  if (!text) return []

  const explicitCharacters = [...text.matchAll(/\[character=\d+\]([^\[]+?)\[\/character\]/gi)]
    .map((match) => cleanText(match[1]))

  const aliasesBeforeBracket = [...text.matchAll(/([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'\-.]{1,25}(?:\s+[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'\-.]{1,25})?)\s*\[[^\]]{2,60}\]/g)]
    .map((match) => cleanText(match[1]))

  const bracketed = [...text.matchAll(/\[([^\[\]]{3,80})\]/g)]
    .map((match) => cleanText(match[1]))
    .filter((item) => item && !/[=<>/]/.test(item))

  return uniqueStrings([...explicitCharacters, ...aliasesBeforeBracket, ...bracketed])
}

const redactExplicitKeywords = (value, keywords, minLength = 4) => {
  let result = value
  for (const keyword of normalizedKeywordList(keywords, minLength)) {
    result = replaceBounded(result, keyword)

    const tokenSource = /^[A-Za-zА-Яа-яЁё0-9'\-.\s]+$/.test(keyword) ? keyword : ''
    for (const token of titleTokens(tokenSource)) {
      if (token.length < 4) continue
      result = replaceBounded(result, token)
    }
  }
  return normalizeHint(result)
}

const dedupePeople = (items, limit) => {
  const seen = new Set()
  const result = []
  for (const item of items) {
    const nameRu = cleanText(item?.nameRu || '')
    const nameOriginal = cleanText(item?.nameOriginal || '')
    const key = `${nameRu.toLowerCase()}|${nameOriginal.toLowerCase()}`
    if (!nameRu && !nameOriginal) continue
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
    if (result.length >= limit) break
  }
  return result
}

const personFromRole = (person) => ({
  nameRu: cleanText(person?.russian || person?.name || ''),
  nameOriginal: cleanText(person?.name || person?.russian || ''),
  photoUrl: toAbsoluteUrl(person?.image?.x96 || person?.image?.original || person?.image?.preview || ''),
})

const parseRoles = (roles) => {
  if (!Array.isArray(roles)) return { creators: [], cast: [], characterNames: [] }

  const creators = []
  const cast = []
  const characterNames = []

  for (const role of roles) {
    const roleText = [
      ...(Array.isArray(role?.roles) ? role.roles : []),
      ...(Array.isArray(role?.roles_russian) ? role.roles_russian : []),
    ].join(' ').toLowerCase()

    if (role?.character) {
      const characterName = cleanText(role.character.russian || role.character.name || '')
      if (characterName) characterNames.push(characterName)
    }

    if (!role?.person) continue
    const person = personFromRole(role.person)

    const isCreator = /director|режисс|creator|создател|author|автор|screenplay|сценар|series composition|композици/i.test(roleText)
    const isCast = /seiyuu|voice|actor|акт[её]р|озвуч/i.test(roleText)

    if (isCreator) creators.push(person)
    if (isCast || (!isCreator && !isCast)) cast.push(person)
  }

  return {
    creators: dedupePeople(creators, 4),
    cast: dedupePeople(cast, 8),
    characterNames: uniqueStrings(characterNames),
  }
}

const baseDescription = (details, summary) => {
  const description = stripHtml(details?.description || '')
  if (description) return description
  const fallback = stripHtml(summary?.description || '')
  return fallback || ''
}

const buildSafeAnimeHint = ({ details, summary, characterNames, loreKeywords }) => {
  const titleRu = cleanText(details?.russian || summary?.russian || '')
  const titleOriginal = cleanText(details?.name || summary?.name || '')
  const description = baseDescription(details, summary)
  if (!description) return ''
  const rawDescription = String(details?.description || '')
  const inlineKeywords = extractBracketKeywords(rawDescription)

  const base = buildPlotHint({
    title: titleRu || titleOriginal,
    text: description,
    maxLength: 260,
  })

  const titleAndLoreKeywords = uniqueStrings([
    titleRu,
    titleOriginal,
    ...(Array.isArray(details?.synonyms) ? details.synonyms : []),
    ...(Array.isArray(details?.english) ? details.english : []),
    ...(Array.isArray(details?.japanese) ? details.japanese : []),
    ...(loreKeywords ?? []),
  ])

  const nameKeywords = uniqueStrings([
    ...(characterNames ?? []),
    ...inlineKeywords,
  ])

  const expandedTitleAndLore = uniqueStrings(titleAndLoreKeywords.flatMap((keyword) => [
    keyword,
    ...titleVariants(keyword),
    ...titleTokens(keyword),
  ]))

  const expandedNames = uniqueStrings(nameKeywords.flatMap((keyword) => [
    keyword,
    ...titleVariants(keyword),
    ...titleTokens(keyword),
  ]))

  const redactedTitlesAndLore = redactExplicitKeywords(base, expandedTitleAndLore, 4)
  const redactedNames = redactExplicitKeywords(redactedTitlesAndLore, expandedNames, 3)

  return redactedNames
}

const createSafeFacts = ({ kindLabel, statusLabel, episodes, episodesAired, sourceLabel, season }) => {
  const facts = []
  if (kindLabel) facts.push(`Формат: ${kindLabel}`)
  if (statusLabel) facts.push(`Статус: ${statusLabel}`)
  if (episodes != null) facts.push(`Эпизоды: ${episodes}`)
  if (episodesAired != null && episodesAired > 0) facts.push(`Вышло эпизодов: ${episodesAired}`)
  if (season) facts.push(`Сезон: ${season}`)
  if (sourceLabel) facts.push(`Первоисточник: ${sourceLabel}`)
  return facts.slice(0, 4)
}

const readJsonIfExists = async (filePath, fallback) => {
  if (!existsSync(filePath)) return fallback
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

let lastRequestAt = 0

const requestJson = async (path) => {
  let lastError = null

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const elapsed = Date.now() - lastRequestAt
    if (elapsed < delayMs) await sleep(delayMs - elapsed)

    const response = await fetch(`${API_BASE}${path}`, { headers: requestHeaders })
    lastRequestAt = Date.now()

    if (response.ok) return response.json()

    const body = await response.text().catch(() => '')
    const canRetry = response.status === 429 || response.status >= 500

    if (!canRetry) {
      throw new Error(`${response.status} ${path} ${body.slice(0, 180)}`)
    }

    const retryAfter = Number(response.headers.get('retry-after'))
    const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(10_000, 1_000 * (attempt + 1))

    lastError = new Error(`${response.status} ${path} ${body.slice(0, 180)}`)
    await sleep(backoffMs)
  }

  throw lastError ?? new Error(`Failed request ${path}`)
}

const makePopularityQuery = (page) => {
  const params = new URLSearchParams({
    order: 'popularity',
    limit: String(perPage),
    page: String(page),
  })

  if (!keepNsfw) params.set('censored', 'true')
  if (statusFilter) params.set('status', statusFilter)
  if (kindFilter) params.set('kind', kindFilter)

  return `/api/animes?${params.toString()}`
}

const printHeader = () => {
  console.log('Shikimori anime import started')
  console.log(`user-agent=${userAgent}`)
  console.log(`target=${maxItems} per_page=${perPage} page_start=${startPage}`)
  console.log(`fetch_roles=${fetchRoles ? 'yes' : 'no'} delay_ms=${delayMs}`)
  if (statusFilter) console.log(`status_filter=${statusFilter}`)
  if (kindFilter) console.log(`kind_filter=${kindFilter}`)
  if (keepNsfw) console.log('censored_filter=off')
  if (globalLoreKeywords.length) console.log(`global_lore_keywords=${globalLoreKeywords.length}`)
}

printHeader()

const listEntries = []
const seenIds = new Set()
let page = startPage

while (listEntries.length < maxItems) {
  const endpoint = makePopularityQuery(page)
  const chunk = await requestJson(endpoint)

  if (!Array.isArray(chunk) || !chunk.length) {
    console.log(`No more entries on page ${page}, stopping`) 
    break
  }

  for (let i = 0; i < chunk.length; i += 1) {
    const item = chunk[i]
    const id = toIntOrNull(item?.id)
    if (id == null) continue
    if (seenIds.has(id)) continue

    seenIds.add(id)
    const globalRank = ((page - 1) * perPage) + i + 1
    listEntries.push({ id, summary: item, rank: globalRank })

    if (listEntries.length >= maxItems) break
  }

  console.log(`list page=${page} collected=${listEntries.length}/${maxItems}`)
  page += 1
}

const imported = []
const skipped = []

for (const [index, row] of listEntries.entries()) {
  const { id, summary, rank } = row

  try {
    const details = await requestJson(`/api/animes/${id}`)
    const roles = fetchRoles ? await requestJson(`/api/animes/${id}/roles`) : []
    const roleData = parseRoles(roles)

    const titleRu = cleanText(details?.russian || summary?.russian || details?.name || summary?.name || `Anime #${id}`)
    const titleOriginal = cleanText(details?.name || summary?.name || details?.russian || summary?.russian || '')

    const alternatives = uniqueStrings([
      ...(Array.isArray(details?.synonyms) ? details.synonyms : []),
      ...(Array.isArray(details?.english) ? details.english : []),
      ...(Array.isArray(details?.japanese) ? details.japanese : []),
    ]).filter((name) => name !== titleRu && name !== titleOriginal)

    const genres = uniqueStrings((Array.isArray(details?.genres) ? details.genres : [])
      .map((genre) => cleanText(genre?.russian || genre?.name || '')))
      .slice(0, 8)

    const studios = uniqueStrings((Array.isArray(details?.studios) ? details.studios : [])
      .map((studio) => cleanText(studio?.name || studio?.filtered_name || '')))
      .slice(0, 5)

    const startedOn = cleanText(details?.aired_on || summary?.aired_on || '') || null
    const releasedOn = cleanText(details?.released_on || summary?.released_on || '') || null
    const year = pickYear(startedOn)
    const endYear = pickYear(releasedOn)
    const kindCode = cleanText(details?.kind || summary?.kind || '').toLowerCase() || null
    const statusCode = cleanText(details?.status || summary?.status || '').toLowerCase() || null
    const sourceCode = cleanText(details?.source || '').toLowerCase() || null
    const kindLabel = kindCode ? (KIND_LABELS[kindCode] || kindCode) : null
    const statusLabel = statusCode ? (STATUS_LABELS[statusCode] || statusCode) : null
    const sourceLabel = sourceCode ? (SOURCE_LABELS[sourceCode] || sourceCode) : null
    const seasonLabel = cleanText(details?.season || '') || null

    const episodes = toIntOrNull(details?.episodes ?? summary?.episodes)
    const episodesAired = toIntOrNull(details?.episodes_aired ?? summary?.episodes_aired)
    const duration = toIntOrNull(details?.duration)
    const score = toNumberOrNull(details?.score ?? summary?.score)
    const ageRatingCode = cleanText(details?.rating || '').toLowerCase()
    const ageRating = AGE_LABELS[ageRatingCode] ?? (ageRatingCode || null)

    const posterUrl = toAbsoluteUrl(details?.image?.original || summary?.image?.original || summary?.image?.preview || summary?.image?.x96 || '')
    const coverUrl = toAbsoluteUrl(details?.image?.original || summary?.image?.original || '')

    const loreKeywords = uniqueStrings([
      ...globalLoreKeywords,
      cleanText(details?.franchise || ''),
      ...alternatives,
      ...genres,
    ])

    const plotHint = buildSafeAnimeHint({
      details,
      summary,
      characterNames: roleData.characterNames,
      loreKeywords,
    })

    const description = baseDescription(details, summary) || null
    const shortDescription = plotHint || (description ? normalizeHint(description, 220) : null)
    const popularityScore = Math.max(1, Math.round(100 - ((rank - 1) * 99) / Math.max(1, maxItems - 1)))

    const facts = createSafeFacts({
      kindLabel,
      statusLabel,
      episodes,
      episodesAired,
      sourceLabel,
      season: seasonLabel,
    })

    const item = {
      id: `shiki_${id}`,
      mode: 'anime',
      titleRu,
      titleOriginal,
      alternativeTitles: alternatives,
      year,
      endYear,
      releaseDate: startedOn,
      countries: ['Япония'],
      originalLanguage: 'ja',
      genres,
      ageRating,
      runtimeMinutes: duration,
      episodes,
      directors: roleData.creators,
      cast: roleData.cast,
      studios,
      ratings: {
        recognizability: score,
      },
      votes: {},
      popularityScore,
      posterUrl,
      headerUrl: null,
      backdropUrl: coverUrl,
      description,
      shortDescription,
      plotHint: plotHint || null,
      slogan: null,
      facts,
      awards: null,
      topRank: rank,
      seriesStatus: statusLabel,
      seasonsCount: null,
      dataQuality: {
        source: [
          'shikimori_api_v1',
          'shikimori_popularity_order',
          ...(fetchRoles ? ['shikimori_roles'] : []),
        ],
        verified: true,
        missingFields: [
          !description ? 'description' : null,
          !plotHint ? 'plotHint' : null,
          !posterUrl ? 'posterUrl' : null,
          !studios.length ? 'studios' : null,
          !roleData.cast.length ? 'cast' : null,
        ].filter(Boolean),
      },
      animeKind: kindLabel,
      animeKindCode: kindCode,
      animeStatus: statusLabel,
      animeStatusCode: statusCode,
      animeEpisodesAired: episodesAired,
      animeSource: sourceLabel,
      animeSourceCode: sourceCode,
      shikimoriId: id,
      shikimoriScore: score,
      shikimoriUrl: `https://shikimori.io${cleanText(summary?.url || details?.url || `/animes/${id}`)}`,
    }

    imported.push(item)
  } catch (error) {
    skipped.push({
      id,
      rank,
      reason: String(error?.message || error).slice(0, 240),
    })
  }

  if ((index + 1) % 20 === 0 || index + 1 === listEntries.length) {
    console.log(`details ${index + 1}/${listEntries.length} imported=${imported.length} skipped=${skipped.length}`)
  }
}

imported.sort((a, b) => (a.topRank ?? 0) - (b.topRank ?? 0))

await mkdir(resolve(outPath, '..'), { recursive: true })
await writeFile(outPath, `${JSON.stringify(imported, null, 2)}\n`, 'utf8')

await mkdir(resolve(skippedPath, '..'), { recursive: true })
await writeFile(skippedPath, `${JSON.stringify(skipped, null, 2)}\n`, 'utf8')

const source = await readJsonIfExists(sourcePath, {})
const nextSource = {
  ...source,
  generatedAt: new Date().toISOString(),
  animeCount: imported.length,
  animeSource: 'https://shikimori.io/animes?order=popularity',
  animeImport: {
    orderedBy: 'popularity',
    sequential: true,
    startPage,
    perPage,
    requested: maxItems,
    fetched: listEntries.length,
    imported: imported.length,
    skipped: skipped.length,
    fetchRoles,
    statusFilter: statusFilter || null,
    kindFilter: kindFilter || null,
    keepNsfw,
  },
}

await mkdir(resolve(sourcePath, '..'), { recursive: true })
await writeFile(sourcePath, `${JSON.stringify(nextSource, null, 2)}\n`, 'utf8')

console.log('Done:')
console.log(`output=${outPath}`)
console.log(`source=${sourcePath}`)
console.log(`skipped=${skippedPath}`)
console.log(`imported=${imported.length}`)
console.log(`skipped=${skipped.length}`)
