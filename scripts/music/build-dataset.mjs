import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DEFAULT_SOURCE_RELATIVE = 'data/music/normalized/music_artists_enriched_first500_merged_retry_batched.resolved.json'
const TARGET_GENERATED_PATH = path.join(ROOT, 'public', 'data', 'music.generated.json')
const TARGET_ITEMS_PATH = path.join(ROOT, 'public', 'data', 'libraries', 'music', 'items.json')
const TARGET_SEARCH_INDEX_PATH = path.join(ROOT, 'public', 'data', 'libraries', 'music', 'search-index.json')
const SOURCE_META_PATH = path.join(ROOT, 'public', 'data', 'source.json')
const ORIGIN_SOURCE_PATH = path.join(ROOT, 'archive', 'local', 'music-pipeline', 'source', 'music_artists_merged_dedup.json')
const IMAGE_SOURCE_PRIORITY = ['spotify', 'wikimedia', 'wikidata', 'theaudiodb', 'lastfm']

const parseArgs = () => {
  const options = {
    input: DEFAULT_SOURCE_RELATIVE,
    merge: false,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--input=')) {
      const value = arg.slice('--input='.length).trim()
      if (value) options.input = value
      continue
    }
    if (arg === '--merge') options.merge = true
  }

  return options
}

// Признак «отечественная сцена» по авторитетному списку-источнику (там страна указана чисто, на русском).
// «Русскими» считаем всех русскоязычных/постсоветских артистов; «зарубежные» — только западные/международные.
const RUSSIAN_COUNTRY_RE = /росси|ссср|советск|украин|беларус|белорус|казахстан|азербайджан|груз|армен|латви|литв|эстони|молдав|молдов|узбекистан|киргиз|кыргыз|таджик|туркмен|абхаз/i
const isRussianCountry = (value) => RUSSIAN_COUNTRY_RE.test(String(value ?? ''))

const normalize = (value) => String(value ?? '')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const tokenize = (value) => normalize(value)
  .split(/\s+/)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2)

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

// Карты «ранг → происхождение» и «нормализованное имя → происхождение» из авторитетного источника.
let ORIGIN_LOOKUP = { byRank: new Map(), byName: new Map() }

const buildOriginLookup = () => {
  const byRank = new Map()
  const byName = new Map()
  if (!fs.existsSync(ORIGIN_SOURCE_PATH)) return { byRank, byName }
  let source
  try {
    source = readJson(ORIGIN_SOURCE_PATH)
  } catch {
    return { byRank, byName }
  }
  if (!Array.isArray(source)) return { byRank, byName }
  for (const entry of source) {
    const origin = isRussianCountry(entry?.country) ? 'ru' : 'intl'
    const rank = Number.parseInt(String(entry?.rank), 10)
    if (Number.isFinite(rank)) byRank.set(rank, origin)
    const names = [entry?.artist, ...(Array.isArray(entry?.alternative_names) ? entry.alternative_names : [])]
    for (const name of names) {
      const key = normalize(name)
      if (key && !byName.has(key)) byName.set(key, origin)
    }
  }
  return { byRank, byName }
}

const resolveMusicOrigin = (entry, resolvedCountry) => {
  const rank = Number.parseInt(String(entry?.input?.rank), 10)
  if (Number.isFinite(rank) && ORIGIN_LOOKUP.byRank.has(rank)) return ORIGIN_LOOKUP.byRank.get(rank)
  const nameKeys = [entry?.input?.artist, asString(getPrimary(entry, 'canonicalName')), asString(getPrimary(entry, 'displayNameEn'))]
  for (const name of nameKeys) {
    const key = normalize(name)
    if (key && ORIGIN_LOOKUP.byName.has(key)) return ORIGIN_LOOKUP.byName.get(key)
  }
  // Резервная эвристика по «шумной» стране из pipeline.
  return isRussianCountry(resolvedCountry) ? 'ru' : 'intl'
}

const uniqueStrings = (values) => {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (!text) continue
    const key = normalize(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

const toFiniteNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const toInteger = (value) => {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

const getPrimary = (entry, fieldName, fallback = null) => {
  const field = entry?.[fieldName]
  if (isObject(field) && Object.prototype.hasOwnProperty.call(field, 'primaryValue')) {
    return field.primaryValue
  }
  return fallback
}

const asString = (value) => {
  if (typeof value === 'string') {
    const text = value.trim()
    return text || null
  }
  return null
}

const asBoolean = (value) => {
  if (typeof value === 'boolean') return value
  return null
}

const flattenToStringArray = (value) => {
  if (!Array.isArray(value)) {
    const text = asString(value)
    return text ? [text] : []
  }
  const out = []
  for (const item of value) {
    if (Array.isArray(item)) {
      out.push(...flattenToStringArray(item))
      continue
    }
    const text = asString(item)
    if (text) out.push(text)
  }
  return uniqueStrings(out)
}

const firstString = (value) => {
  const list = flattenToStringArray(value)
  return list[0] ?? null
}

const toPerson = (name) => {
  const text = asString(name)
  if (!text) return null
  const hasCyrillic = /[А-Яа-яЁё]/.test(text)
  return {
    nameRu: hasCyrillic ? text : '',
    nameOriginal: hasCyrillic ? '' : text,
  }
}

const mapNamedPeople = (listValue, limit = 6) => {
  if (!Array.isArray(listValue)) return []
  const result = []
  const seen = new Set()
  for (const entry of listValue) {
    const text = asString(entry?.name)
    if (!text) continue
    const key = normalize(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const person = toPerson(text)
    if (person) result.push(person)
    if (result.length >= limit) break
  }
  return result
}

const mapTopTracks = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const title = asString(item?.title)
      if (!title) return null
      return {
        rank: toInteger(item?.rank) ?? index + 1,
        title,
        listeners: toFiniteNumber(item?.listeners),
        playcount: toFiniteNumber(item?.playcount),
        source: asString(item?.source),
      }
    })
    .filter(Boolean)
    .slice(0, 10)
}

const mapTopAlbums = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const title = asString(item?.title)
      if (!title) return null
      return {
        rank: toInteger(item?.rank) ?? index + 1,
        title,
        listeners: toFiniteNumber(item?.listeners),
        source: asString(item?.source),
      }
    })
    .filter(Boolean)
    .slice(0, 5)
}

const mapSimilarArtists = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const name = asString(item?.name)
      if (!name) return null
      return {
        rank: toInteger(item?.rank) ?? index + 1,
        name,
        match: toFiniteNumber(item?.match),
        source: asString(item?.source),
      }
    })
    .filter(Boolean)
    .slice(0, 3)
}

const mapLinks = (value) => {
  if (!Array.isArray(value)) return []
  return uniqueStrings(
    value
      .map((item) => asString(item?.url))
      .filter(Boolean),
  )
}

const isLastfmPlaceholderImage = (url) => /2a96cbd8b46e442fc41c2b86b821562f/i.test(String(url ?? ''))
const isSmallLastfmImage = (url) => /lastfm\.freetls\.fastly\.net\/i\/u\/(34s|64s|174s)\//i.test(String(url ?? ''))

const toImageCandidateList = (value, fallbackSource = 'unknown') => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const url = asString(item)
        return url ? { url, source: fallbackSource } : null
      }
      const url = asString(item?.url)
      if (!url) return null
      const source = asString(item?.source) ?? fallbackSource
      return { url, source }
    })
    .filter(Boolean)
}

const collectImageCandidates = (entry) => {
  const field = entry?.imageCandidates
  const collected = []

  if (isObject(field) && Array.isArray(field.sourceEvidence)) {
    for (const evidence of field.sourceEvidence) {
      const source = asString(evidence?.source) ?? 'unknown'
      collected.push(...toImageCandidateList(evidence?.value, source))
    }
  }

  if (!collected.length) {
    const primaryValue = getPrimary(entry, 'imageCandidates', [])
    collected.push(...toImageCandidateList(primaryValue, 'unknown'))
  }

  const deduped = []
  const seen = new Set()
  for (const item of collected) {
    const key = `${item.source}|${item.url}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  deduped.sort((a, b) => {
    const aPriority = IMAGE_SOURCE_PRIORITY.indexOf(a.source)
    const bPriority = IMAGE_SOURCE_PRIORITY.indexOf(b.source)
    const aRank = aPriority === -1 ? 99 : aPriority
    const bRank = bPriority === -1 ? 99 : bPriority
    if (aRank !== bRank) return aRank - bRank
    return a.url.localeCompare(b.url, 'ru-RU')
  })

  const withoutPlaceholders = deduped.filter((item) => !isLastfmPlaceholderImage(item.url))
  const source = withoutPlaceholders.length ? withoutPlaceholders : deduped
  const withoutTinyLastfm = source.filter((item) => !isSmallLastfmImage(item.url))
  const finalList = withoutTinyLastfm.length ? withoutTinyLastfm : source

  return uniqueStrings(finalList.map((item) => item.url))
}

const safeYear = (value) => {
  const parsed = toInteger(value)
  return parsed != null && parsed >= 1800 && parsed <= 2100 ? parsed : null
}

const derivePopularityScore = ({ listeners, playcount, rank }) => {
  if (listeners != null) return Math.max(0, Math.round(listeners))
  if (playcount != null) return Math.max(0, Math.round(playcount))
  if (rank != null) return Math.max(1, 20_000 - rank * 100)
  return 1
}

const flattenEvidenceSourceStatus = (entry) => {
  const sourceStatus = entry?.pipeline?.sourceStatus
  if (!isObject(sourceStatus)) return []
  return Object.entries(sourceStatus)
    .filter(([, status]) => status === 'ok')
    .map(([source]) => source)
}

const buildDescription = ({ canonicalName, country, genres, topTrack }) => {
  const parts = [
    canonicalName,
    country ? `страна: ${country}` : null,
    genres.length ? `жанры: ${genres.slice(0, 3).join(', ')}` : null,
    topTrack ? `топ-трек: ${topTrack}` : null,
  ].filter(Boolean)

  if (!parts.length) return null
  return `Музыкальный артист: ${parts.join(' · ')}`
}

const buildFacts = ({ topTracks, topAlbums, listeners, links }) => {
  const facts = []
  if (topTracks.length) {
    facts.push(`Топ треки: ${topTracks.slice(0, 3).map((track) => track.title).join(', ')}`)
  }
  if (topAlbums.length) {
    facts.push(`Топ альбомы: ${topAlbums.slice(0, 2).map((album) => album.title).join(', ')}`)
  }
  if (listeners != null) {
    facts.push(`Слушатели Last.fm: ${new Intl.NumberFormat('ru-RU').format(listeners)}`)
  }
  if (links.length) {
    facts.push(`Ссылки: ${links.slice(0, 2).join(', ')}`)
  }
  return facts
}

const mapNormalizedArtistToTitleItem = (entry, index) => {
  const artistKey = asString(entry?.artistKey) ?? `music-${String(index + 1).padStart(3, '0')}`
  const inputName = asString(entry?.input?.artist)
  const canonicalName = asString(getPrimary(entry, 'canonicalName'))
  const displayRu = asString(getPrimary(entry, 'displayNameRu'))
  const displayEn = asString(getPrimary(entry, 'displayNameEn'))
  const aliases = flattenToStringArray(getPrimary(entry, 'aliases', []))
  const typeRaw = getPrimary(entry, 'artistType')
  const musicType = firstString(typeRaw)
  const country = firstString(getPrimary(entry, 'country'))
  const area = firstString(getPrimary(entry, 'area'))
  const city = firstString(getPrimary(entry, 'city'))
  const beginYear = safeYear(getPrimary(entry, 'beginYear'))
  const endYear = safeYear(getPrimary(entry, 'endYear'))
  const isActive = asBoolean(getPrimary(entry, 'isActive'))

  const genres = uniqueStrings([
    ...flattenToStringArray(getPrimary(entry, 'genres', [])),
    ...flattenToStringArray(getPrimary(entry, 'styles', [])),
    ...flattenToStringArray(getPrimary(entry, 'moods', [])),
  ])

  const topTracks = mapTopTracks(getPrimary(entry, 'topTracks', []))
  const topAlbums = mapTopAlbums(getPrimary(entry, 'topAlbums', []))
  const similarArtists = mapSimilarArtists(getPrimary(entry, 'similarArtists', []))

  const members = mapNamedPeople(getPrimary(entry, 'members', []), 6)
  const associatedActs = mapNamedPeople(getPrimary(entry, 'associatedActs', []), 6)

  const officialLinks = mapLinks(getPrimary(entry, 'officialLinks', []))
  const socialLinks = mapLinks(getPrimary(entry, 'socialLinks', []))
  const musicLinks = uniqueStrings([...officialLinks, ...socialLinks])

  const imageCandidates = collectImageCandidates(entry)

  const listeners = toFiniteNumber(getPrimary(entry?.popularityMetrics, 'listeners'))
  const playcount = toFiniteNumber(getPrimary(entry?.popularityMetrics, 'playcount'))
  const topRank = toInteger(entry?.input?.rank)
  const popularityScore = derivePopularityScore({ listeners, playcount, rank: topRank })

  const titleRu = displayRu ?? canonicalName ?? inputName ?? artistKey
  const titleOriginal = displayEn ?? canonicalName ?? inputName ?? titleRu

  const alternativeTitles = uniqueStrings([
    ...aliases,
    ...(inputName ? [inputName] : []),
    ...(displayEn && displayEn !== titleOriginal ? [displayEn] : []),
    ...(canonicalName && canonicalName !== titleOriginal ? [canonicalName] : []),
  ]).filter((value) => normalize(value) !== normalize(titleRu) && normalize(value) !== normalize(titleOriginal))

  const topTrack = topTracks[0]?.title ?? null
  const topAlbum = topAlbums[0]?.title ?? null

  const description = buildDescription({
    canonicalName: canonicalName ?? titleOriginal,
    country,
    genres,
    topTrack,
  })

  const notes = Array.isArray(entry?.manualReviewReason)
    ? uniqueStrings(entry.manualReviewReason.map((item) => asString(item)).filter(Boolean))
    : []

  const generatedHint = asString(entry?.agentHint?.text)

  const item = {
    id: `music:${artistKey}`,
    mode: 'music',
    titleRu,
    titleOriginal,
    alternativeTitles,
    year: beginYear ?? undefined,
    endYear,
    countries: uniqueStrings([country, area, city].filter(Boolean)),
    genres,
    directors: associatedActs,
    cast: members,
    ratings: {},
    votes: {
      gamesPlayed: listeners,
      steamReviews: playcount,
    },
    popularityScore,
    posterUrl: imageCandidates[0] ?? null,
    headerUrl: imageCandidates[1] ?? null,
    backdropUrl: imageCandidates[2] ?? null,
    screenshots: imageCandidates.slice(0, 6),
    description,
    shortDescription: description,
    plotHint: generatedHint ?? description,
    slogan: topTrack,
    facts: buildFacts({ topTracks, topAlbums, listeners, links: musicLinks }),
    topRank,
    notes,
    musicType,
    musicIsActive: isActive,
    musicOrigin: resolveMusicOrigin(entry, country),
    topTracks,
    topAlbums,
    similarArtists,
    musicLinks,
    dataQuality: {
      source: flattenEvidenceSourceStatus(entry),
      verified: notes.length === 0,
      missingFields: [
        !topTracks.length ? 'topTracks' : null,
        !topAlbums.length ? 'topAlbums' : null,
        !genres.length ? 'genres' : null,
        listeners == null ? 'listeners' : null,
      ].filter(Boolean),
    },
  }

  return item
}

const sortItems = (items) => [...items].sort((a, b) => {
  const byTitle = a.titleRu.localeCompare(b.titleRu, 'ru-RU')
  if (byTitle !== 0) return byTitle
  return a.id.localeCompare(b.id, 'ru-RU')
})

const buildSearchIndex = (items) => {
  const tokenMap = new Map()

  const docs = items.map((item) => {
    const id = String(item.id)
    const names = [item.titleRu, item.titleOriginal, ...(item.alternativeTitles ?? [])].filter(Boolean)

    const seenTokens = new Set()
    for (const name of names) {
      for (const token of tokenize(name)) {
        if (!token || seenTokens.has(token)) continue
        seenTokens.add(token)
        const current = tokenMap.get(token)
        if (current) current.push(id)
        else tokenMap.set(token, [id])
      }
    }

    return {
      id,
      titleRu: item.titleRu ?? null,
      titleOriginal: item.titleOriginal ?? null,
      alternativeTitles: Array.isArray(item.alternativeTitles) ? item.alternativeTitles : [],
      year: Number.isFinite(item.year) ? item.year : null,
      topRank: Number.isFinite(item.topRank) ? item.topRank : null,
      steamAppId: null,
      icd10: [],
    }
  })

  const tokenEntries = [...tokenMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ru-RU'))
    .map(([token, ids]) => [token, [...new Set(ids)].sort((x, y) => x.localeCompare(y, 'ru-RU'))])

  return {
    version: 1,
    library: 'music',
    generatedAt: new Date().toISOString(),
    totalItems: docs.length,
    tokensCount: tokenEntries.length,
    docs,
    tokenToIds: Object.fromEntries(tokenEntries),
  }
}

const main = () => {
  const options = parseArgs()
  const sourcePath = path.isAbsolute(options.input) ? options.input : path.join(ROOT, options.input)

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${path.relative(ROOT, sourcePath)}`)
  }

  const payload = readJson(sourcePath)
  const sourceItems = Array.isArray(payload?.items) ? payload.items : []
  ORIGIN_LOOKUP = buildOriginLookup()
  const incomingItems = sortItems(sourceItems.map(mapNormalizedArtistToTitleItem))
  const existingItems = options.merge && fs.existsSync(TARGET_ITEMS_PATH)
    ? readJson(TARGET_ITEMS_PATH)
    : []
  const existingIds = new Set((Array.isArray(existingItems) ? existingItems : []).map((item) => item?.id))
  const mappedItems = options.merge
    ? sortItems([
      ...(Array.isArray(existingItems) ? existingItems : []),
      ...incomingItems.filter((item) => !existingIds.has(item.id)),
    ])
    : incomingItems
  const searchIndex = buildSearchIndex(mappedItems)

  writeJson(TARGET_GENERATED_PATH, mappedItems)
  writeJson(TARGET_ITEMS_PATH, mappedItems)
  writeJson(TARGET_SEARCH_INDEX_PATH, searchIndex)

  if (fs.existsSync(SOURCE_META_PATH)) {
    const sourceMeta = readJson(SOURCE_META_PATH)
    if (isObject(sourceMeta)) {
      sourceMeta.musicCount = mappedItems.length
      sourceMeta.musicSource = path.relative(ROOT, sourcePath).replace(/\\/g, '/')
      sourceMeta.musicGeneratedAt = new Date().toISOString()
      writeJson(SOURCE_META_PATH, sourceMeta)
    }
  }

  console.log(`Source: ${path.relative(ROOT, sourcePath).replace(/\\/g, '/')}`)
  console.log(`Music items: ${mappedItems.length}`)
  console.log(`Generated: ${path.relative(ROOT, TARGET_GENERATED_PATH).replace(/\\/g, '/')}`)
  console.log(`Library items: ${path.relative(ROOT, TARGET_ITEMS_PATH).replace(/\\/g, '/')}`)
  console.log(`Search index: ${path.relative(ROOT, TARGET_SEARCH_INDEX_PATH).replace(/\\/g, '/')}`)
}

main()
