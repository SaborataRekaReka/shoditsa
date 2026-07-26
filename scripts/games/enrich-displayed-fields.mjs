import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { answerVariants, normalizeTitle } from './enrichment-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const args = process.argv.slice(2)
const hasFlag = (name) => args.includes(`--${name}`)
const argValue = (name, fallback) => {
  const direct = args.find((entry) => entry.startsWith(`--${name}=`))
  if (direct) return direct.slice(name.length + 3)
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

const fetchSources = hasFlag('fetch')
const apply = hasFlag('apply')
const libraryPath = resolve(root, argValue('library', 'public/data/libraries/games/items.json'))
const searchIndexPath = resolve(root, argValue('search-index', 'public/data/libraries/games/search-index.json'))
const cachePath = resolve(root, argValue('cache', 'data/games/cache/game-displayed-fields-enrichment.json'))
const reportPath = resolve(root, argValue('report', 'data/games/logs/game-displayed-fields-enrichment.json'))
const steamStoreCachePath = resolve(root, 'data/games/cache/steam-store-enrichment.json')
const steamSpyCachePath = resolve(root, 'data/games/cache/steamspy-appdetails-enrichment.json')
const wikidataCachePath = resolve(root, 'data/games/cache/wikidata-game-enrichment.json')
const now = new Date().toISOString()
const userAgent = 'Shoditsa-Game-Displayed-Fields/1.0 (https://shoditsa.ru)'

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

const writeAtomic = async (path, value) => {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(tempPath, path)
      return
    } catch (error) {
      if (!['EPERM', 'EACCES'].includes(error?.code) || attempt === 4) break
      await sleep(80 * (attempt + 1))
    }
  }
  await copyFile(tempPath, path)
  await unlink(tempPath)
}

const text = (value) => typeof value === 'string' ? value.trim() : ''
const finite = (value) => (
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
)
const integer = (value) => (
  value == null || value === '' || !Number.isInteger(Number(value)) ? null : Number(value)
)
const uniqueStrings = (values) => [...new Set(values.flat(Infinity).map(text).filter(Boolean))]
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
const clone = (value) => structuredClone(value)

const fetchText = async (url, attempts = 4) => {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': userAgent,
          accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
          referer: url.startsWith('https://store.steampowered.com/')
            ? 'https://store.steampowered.com/'
            : 'https://www.wikidata.org/',
        },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      lastError = error
      if (attempt + 1 < attempts) await sleep(350 * (attempt + 1))
    }
  }
  throw lastError
}

const fetchJson = async (url, attempts = 4) => JSON.parse(await fetchText(url, attempts))

const romanNumerals = new Map([
  ['ii', '2'],
  ['iii', '3'],
  ['iv', '4'],
  ['v', '5'],
  ['vi', '6'],
  ['vii', '7'],
  ['viii', '8'],
  ['ix', '9'],
  ['x', '10'],
])

const normalizedName = (value) => normalizeTitle(String(value ?? '')
  .replace(/[™®©]/g, '')
  .replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/gi, (entry) => romanNumerals.get(entry.toLowerCase()) ?? entry))

const itemNames = (item) => new Set(answerVariants(
  item.titleRu,
  item.titleOriginal,
  item.localizedTitles?.ru,
  item.localizedTitles?.en,
  item.alternativeTitles,
  item.aliases,
  item.acceptedAnswers,
).map(normalizedName).filter(Boolean))

const namesIntersect = (item, values) => {
  const names = itemNames(item)
  return uniqueStrings(values).some((value) => names.has(normalizedName(value)))
}

const steamNameMatches = (item, values) => namesIntersect(item, uniqueStrings(values).flatMap((value) => [
  value,
  value.replace(/\s*\((?:19|20)\d{2}\)\s*$/i, ''),
]))

const htmlDecode = (value) => String(value ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&#x27;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .trim()

const claimValues = (entity, property) => (entity?.claims?.[property] ?? [])
  .filter((statement) => statement.rank !== 'deprecated' && statement.mainsnak?.snaktype === 'value')
  .map((statement) => statement.mainsnak.datavalue?.value)
  .filter((value) => value != null)

const claimItemIds = (entity, property) => claimValues(entity, property)
  .map((value) => value?.id)
  .filter(Boolean)

const releaseYears = (entity) => claimValues(entity, 'P577')
  .map((value) => Number(String(value?.time ?? '').slice(1, 5)))
  .filter(Number.isInteger)

const entityNames = (entity) => uniqueStrings([
  ...Object.values(object(entity?.labels)).map((entry) => entry?.value),
  ...Object.values(object(entity?.aliases)).flatMap((entries) => (
    Array.isArray(entries) ? entries.map((entry) => entry?.value) : []
  )),
])

const entityDescriptions = (entity) => uniqueStrings(
  Object.values(object(entity?.descriptions)).map((entry) => entry?.value),
)

const entityMatch = (item, entity) => {
  const nameMatch = namesIntersect(item, entityNames(entity))
  const years = releaseYears(entity)
  const year = integer(item.year)
  const yearDistance = year != null && years.length
    ? Math.min(...years.map((entry) => Math.abs(entry - year)))
    : null
  const instanceIds = claimItemIds(entity, 'P31')
  const describedAsGame = entityDescriptions(entity).some((entry) => (
    /video game|computer game|видеоигр|компьютерн\w* игр/i.test(entry)
  ))
  const isGame = instanceIds.includes('Q7889') || describedAsGame
  const yearMatch = yearDistance != null && yearDistance <= 1
  const score = (nameMatch ? 50 : 0) + (yearMatch ? 35 : 0) + (isGame ? 10 : 0)
    + (claimValues(entity, 'P1733').length ? 3 : 0)
    + (claimValues(entity, 'P852').length || claimValues(entity, 'P908').length ? 2 : 0)
  return { nameMatch, years, yearDistance, isGame, yearMatch, score }
}

const parseSteamSuggestions = (html) => {
  const result = []
  for (const fragment of String(html ?? '').split(/<a\b/i).slice(1)) {
    const appid = integer(fragment.match(/data-ds-appid="(\d+)"/i)?.[1])
    const name = htmlDecode(fragment.match(/<div class="match_name">([\s\S]*?)<\/div>/i)?.[1])
    if (appid && name) result.push({ appid, name })
  }
  return result
}

const releaseYearFromSteam = (data) => {
  const raw = text(data?.release_date?.date)
  const matches = raw.match(/\b(19|20)\d{2}\b/g)
  return matches?.length ? Number(matches.at(-1)) : null
}

const languagesFromSteam = (value) => uniqueStrings(htmlDecode(value)
  .replace(/\*/g, '')
  .split(/,\s*|<br\s*\/?>/i)
  .map((entry) => entry.replace(/озвучивание доступно.*$/i, '').trim()))

const steamDetailsFromPayload = (appid, data) => {
  const price = data.is_free
    ? { isFree: true, currency: data.price_overview?.currency ?? null, initial: 0, final: 0, discountPercent: 0 }
    : data.price_overview
      ? {
          isFree: false,
          currency: data.price_overview.currency ?? null,
          initial: finite(data.price_overview.initial),
          final: finite(data.price_overview.final),
          discountPercent: finite(data.price_overview.discount_percent) ?? 0,
        }
      : null
  return {
    appid,
    type: text(data.type),
    name: text(data.name),
    releaseYear: releaseYearFromSteam(data),
    requiredAge: integer(data.required_age) ?? 0,
    developers: uniqueStrings(data.developers ?? []),
    publishers: uniqueStrings(data.publishers ?? []),
    categories: uniqueStrings((data.categories ?? []).map((entry) => entry?.description)),
    genres: uniqueStrings((data.genres ?? []).map((entry) => entry?.description)),
    platforms: Object.entries(object(data.platforms)).filter(([, enabled]) => enabled).map(([platform]) => platform),
    supportedLanguages: languagesFromSteam(data.supported_languages),
    metacritic: finite(data.metacritic?.score),
    recommendations: finite(data.recommendations?.total),
    isFree: Boolean(data.is_free),
    price,
    headerImage: text(data.header_image) || null,
    background: text(data.background_raw || data.background) || null,
    screenshots: uniqueStrings((data.screenshots ?? []).map((entry) => entry?.path_full)),
    fetchedAt: now,
    sourceUrl: `https://store.steampowered.com/app/${appid}/`,
  }
}

const steamReviewSummary = (appid, payload) => {
  const summary = object(payload?.query_summary)
  const positive = finite(summary.total_positive) ?? 0
  const negative = finite(summary.total_negative) ?? 0
  const total = finite(summary.total_reviews) ?? positive + negative
  return {
    appid,
    totalPositive: positive,
    totalNegative: negative,
    totalReviews: total,
    positivePercent: total > 0 ? Math.round((positive / total) * 10_000) / 100 : null,
    reviewScore: finite(summary.review_score),
    reviewScoreDescription: text(summary.review_score_desc) || null,
    fetchedAt: now,
    sourceUrl: `https://store.steampowered.com/appreviews/${appid}?json=1&language=all`,
  }
}

const ageFromWikidataLabels = (pegiLabels, esrbLabels) => {
  for (const label of pegiLabels) {
    const match = label.match(/\b(3|7|12|16|18)\b/)
    if (match) return `${match[1]}+`
  }
  const joined = esrbLabels.join(' ').toLowerCase()
  if (/adults only|\bao\b/.test(joined)) return '18+'
  if (/mature|\bm\b/.test(joined)) return '17+'
  if (/teen|\bt\b/.test(joined)) return '13+'
  if (/everyone 10|\be10\b/.test(joined)) return '10+'
  if (/everyone|early childhood|\bec\b|\be\b/.test(joined)) return '0+'
  return null
}

const buildStoreNameIndex = (storeCache, spyCache) => {
  const result = new Map()
  for (const [appid, details] of Object.entries(object(storeCache.byAppId))) {
    if (details.status !== 'ok' || details.type !== 'game') continue
    for (const name of uniqueStrings([details.name, spyCache.byAppId?.[appid]?.name])) {
      const key = normalizedName(name)
      const entries = result.get(key) ?? []
      entries.push({ appid: Number(appid), name })
      result.set(key, entries)
    }
  }
  return result
}

const cacheDocument = await readJson(cachePath, {
  schemaVersion: 1,
  updatedAt: null,
  policy: {
    kinopoiskRequests: 0,
    numericValuesRequireVerifiedSources: true,
    unresolvedValuesRemainExplicitlyUnavailable: true,
  },
  wikidataSearches: {},
  wikidataEntities: {},
  wikidataLabels: {},
  steamSearches: {},
  steamDetails: {},
  steamReviews: {},
  byItemId: {},
})
cacheDocument.wikidataSearches ??= {}
cacheDocument.wikidataEntities ??= {}
cacheDocument.wikidataLabels ??= {}
cacheDocument.steamSearches ??= {}
cacheDocument.steamDetails ??= {}
cacheDocument.steamReviews ??= {}
cacheDocument.byItemId ??= {}

const [library, searchIndex, storeCache, spyCache, legacyWikidataCache] = await Promise.all([
  readJson(libraryPath, []),
  readJson(searchIndexPath, null),
  readJson(steamStoreCachePath, { byAppId: {} }),
  readJson(steamSpyCachePath, { byAppId: {} }),
  readJson(wikidataCachePath, { byName: {} }),
])

if (!Array.isArray(library)) throw new Error('Game library must be an array')
const playable = library.filter((item) => item.mode === 'game' && item.allowedInGame === true)
if (playable.length !== 1000) throw new Error(`Expected exactly 1000 playable games, found ${playable.length}`)
const storeNameIndex = buildStoreNameIndex(storeCache, spyCache)

const cachedEntity = async (qid) => {
  if (cacheDocument.wikidataEntities[qid]) return cacheDocument.wikidataEntities[qid]
  if (!fetchSources) return null
  const payload = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)
  const entity = payload?.entities?.[qid] ?? null
  if (entity) cacheDocument.wikidataEntities[qid] = entity
  await sleep(80)
  return entity
}

const wikidataSearch = async (query) => {
  const key = normalizedName(query)
  if (cacheDocument.wikidataSearches[key]) return cacheDocument.wikidataSearches[key]
  if (!fetchSources) return []
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: query,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: '6',
    format: 'json',
    origin: '*',
  })
  const payload = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`)
  const result = (payload.search ?? []).map((entry) => ({
    id: entry.id,
    label: entry.label ?? null,
    description: entry.description ?? null,
  }))
  cacheDocument.wikidataSearches[key] = result
  await sleep(80)
  return result
}

const labelsForIds = async (ids) => {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  const missing = uniqueIds.filter((id) => !cacheDocument.wikidataLabels[id])
  if (missing.length && fetchSources) {
    for (let index = 0; index < missing.length; index += 40) {
      const chunk = missing.slice(index, index + 40)
      const params = new URLSearchParams({
        action: 'wbgetentities',
        ids: chunk.join('|'),
        props: 'labels',
        languages: 'en|ru',
        format: 'json',
      })
      const payload = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`)
      for (const [id, entity] of Object.entries(object(payload.entities))) {
        cacheDocument.wikidataLabels[id] = uniqueStrings([
          entity.labels?.en?.value,
          entity.labels?.ru?.value,
        ])
      }
      await sleep(80)
    }
  }
  return uniqueIds.flatMap((id) => cacheDocument.wikidataLabels[id] ?? [])
}

const resolveWikidata = async (item) => {
  const candidateIds = new Set()
  if (/^Q\d+$/.test(text(item.wikidataId))) candidateIds.add(item.wikidataId)
  for (const name of [item.titleOriginal, item.titleRu]) {
    const legacy = legacyWikidataCache.byName?.[normalizeTitle(name)]
    if (/^Q\d+$/.test(text(legacy?.wikidataId))) candidateIds.add(legacy.wikidataId)
  }
  for (const query of uniqueStrings([item.titleOriginal, item.titleRu]).slice(0, 2)) {
    for (const result of await wikidataSearch(query)) candidateIds.add(result.id)
  }

  const candidates = []
  for (const qid of candidateIds) {
    const entity = await cachedEntity(qid)
    if (!entity || entity.missing) continue
    candidates.push({ qid, entity, match: entityMatch(item, entity) })
  }
  candidates.sort((left, right) => right.match.score - left.match.score)
  const best = candidates[0]
  if (!best || !best.match.nameMatch || !best.match.isGame || !best.match.yearMatch) {
    return {
      status: 'unresolved',
      candidates: candidates.slice(0, 5).map(({ qid, match }) => ({ qid, ...match })),
    }
  }

  const pegiIds = claimItemIds(best.entity, 'P908')
  const esrbIds = claimItemIds(best.entity, 'P852')
  const [pegiLabels, esrbLabels] = await Promise.all([
    labelsForIds(pegiIds),
    labelsForIds(esrbIds),
  ])
  return {
    status: 'resolved',
    qid: best.qid,
    sourceUrl: `https://www.wikidata.org/wiki/${best.qid}`,
    match: best.match,
    steamAppIds: uniqueStrings(claimValues(best.entity, 'P1733')).map(Number).filter(Number.isInteger),
    metacriticIds: uniqueStrings(claimValues(best.entity, 'P1712')),
    pegiLabels,
    esrbLabels,
    ageRating: ageFromWikidataLabels(pegiLabels, esrbLabels),
  }
}

const steamSearch = async (item) => {
  const query = text(item.titleOriginal || item.titleRu)
  const key = normalizedName(query)
  if (cacheDocument.steamSearches[key]) return cacheDocument.steamSearches[key]
  if (!fetchSources) return []
  const params = new URLSearchParams({
    term: query,
    f: 'games',
    cc: 'US',
    l: 'english',
    v: '1',
  })
  const result = parseSteamSuggestions(await fetchText(`https://store.steampowered.com/search/suggest?${params}`))
  cacheDocument.steamSearches[key] = result
  await sleep(120)
  return result
}

const steamDetails = async (appid) => {
  const key = String(appid)
  if (cacheDocument.steamDetails[key]?.status === 'ok') return cacheDocument.steamDetails[key].data
  if (!fetchSources) return null
  try {
    const params = new URLSearchParams({ appids: key, l: 'russian', cc: 'US' })
    const payload = await fetchJson(`https://store.steampowered.com/api/appdetails?${params}`)
    const data = payload?.[key]
    if (!data?.success || !data.data) throw new Error('Steam returned no application data')
    const normalized = steamDetailsFromPayload(appid, data.data)
    cacheDocument.steamDetails[key] = { status: 'ok', fetchedAt: now, data: normalized }
    await sleep(120)
    return normalized
  } catch (error) {
    cacheDocument.steamDetails[key] = { status: 'error', fetchedAt: now, error: String(error?.message ?? error) }
    return null
  }
}

const steamReviews = async (appid) => {
  const key = String(appid)
  if (cacheDocument.steamReviews[key]?.status === 'ok') return cacheDocument.steamReviews[key].data
  if (!fetchSources) return null
  try {
    const params = new URLSearchParams({
      json: '1',
      language: 'all',
      purchase_type: 'all',
      num_per_page: '0',
      filter: 'summary',
    })
    const payload = await fetchJson(`https://store.steampowered.com/appreviews/${appid}?${params}`)
    if (payload?.success !== 1) throw new Error('Steam returned no review summary')
    const normalized = steamReviewSummary(appid, payload)
    cacheDocument.steamReviews[key] = { status: 'ok', fetchedAt: now, data: normalized }
    await sleep(120)
    return normalized
  } catch (error) {
    cacheDocument.steamReviews[key] = { status: 'error', fetchedAt: now, error: String(error?.message ?? error) }
    return null
  }
}

const resolveSteam = async (item, wikidata) => {
  const candidates = new Map()
  const addCandidate = (appid, source, name = null) => {
    const id = integer(appid)
    if (!id) return
    const current = candidates.get(id) ?? { appid: id, sources: [], names: [] }
    current.sources = uniqueStrings([...current.sources, source])
    current.names = uniqueStrings([...current.names, name])
    candidates.set(id, current)
  }
  addCandidate(item.steamAppId, 'existing_card')
  for (const appid of wikidata?.steamAppIds ?? []) addCandidate(appid, 'wikidata')
  for (const name of itemNames(item)) {
    for (const candidate of storeNameIndex.get(name) ?? []) addCandidate(candidate.appid, 'local_store_cache', candidate.name)
  }
  for (const suggestion of await steamSearch(item)) {
    if (namesIntersect(item, [suggestion.name])) addCandidate(suggestion.appid, 'steam_search', suggestion.name)
  }

  const evaluated = []
  for (const candidate of candidates.values()) {
    const details = await steamDetails(candidate.appid)
    if (!details || details.type !== 'game') continue
    const nameMatch = steamNameMatches(item, [details.name, ...candidate.names])
    const year = integer(item.year)
    const yearDistance = year != null && details.releaseYear != null
      ? Math.abs(details.releaseYear - year)
      : null
    const trustedIdentity = candidate.sources.includes('existing_card') || candidate.sources.includes('wikidata')
    const accepted = nameMatch && (trustedIdentity || (yearDistance != null && yearDistance <= 1))
    evaluated.push({ ...candidate, details, nameMatch, yearDistance, trustedIdentity, accepted })
  }
  evaluated.sort((left, right) => (
    Number(right.accepted) - Number(left.accepted)
    || Number(right.sources.includes('existing_card')) - Number(left.sources.includes('existing_card'))
    || Number(right.sources.includes('wikidata')) - Number(left.sources.includes('wikidata'))
    || (left.yearDistance ?? 999) - (right.yearDistance ?? 999)
  ))
  const best = evaluated.find((entry) => entry.accepted)
  if (!best) {
    return {
      status: 'unresolved',
      candidates: evaluated.slice(0, 8).map((entry) => ({
        appid: entry.appid,
        name: entry.details.name,
        releaseYear: entry.details.releaseYear,
        sources: entry.sources,
        nameMatch: entry.nameMatch,
        yearDistance: entry.yearDistance,
      })),
    }
  }
  return {
    status: 'resolved',
    appid: best.appid,
    sources: best.sources,
    details: best.details,
    reviews: await steamReviews(best.appid),
  }
}

const needsWikidata = (item, steamCandidateRows) => (
  !text(item.ageRating)
  || !(item.publishers ?? []).length
  || steamCandidateRows.some((entry) => entry.yearDistance != null && entry.yearDistance > 1)
)

const processItem = async (item) => {
  const existing = cacheDocument.byItemId[item.id]
  if (!fetchSources && existing) return existing

  let wikidata = existing?.wikidata ?? null
  const initialSteam = await resolveSteam(item, wikidata)
  if (!wikidata && needsWikidata(item, initialSteam.candidates ?? [])) {
    wikidata = await resolveWikidata(item)
  }
  const steam = wikidata?.status === 'resolved'
    ? await resolveSteam(item, wikidata)
    : initialSteam
  const result = {
    itemId: item.id,
    titleRu: item.titleRu,
    titleOriginal: item.titleOriginal,
    year: item.year ?? null,
    resolvedAt: now,
    wikidata: wikidata ?? { status: 'not_requested' },
    steam,
    kinopoiskRequests: 0,
  }
  cacheDocument.byItemId[item.id] = result
  return result
}

if (fetchSources) {
  let processed = 0
  for (const item of playable) {
    await processItem(item)
    processed += 1
    if (processed % 10 === 0 || processed === playable.length) {
      cacheDocument.updatedAt = now
      await writeAtomic(cachePath, cacheDocument)
      console.log(`Displayed-field enrichment: ${processed}/${playable.length}`)
    }
  }
}

const availabilityLabel = {
  not_available: 'Нет данных',
  not_applicable: 'Не применимо',
  not_on_steam: 'Нет в Steam',
  not_rated: 'Без оценки',
  unrated: 'Без рейтинга',
}

const applyEnrichment = (item, result) => {
  const next = clone(item)
  const dataQuality = object(next.dataQuality)
  const availability = { ...object(dataQuality.fieldAvailability) }
  const fieldSources = { ...object(dataQuality.fieldSources) }
  const missingFields = new Set(Array.isArray(dataQuality.missingFields) ? dataQuality.missingFields : [])
  const sources = new Set(Array.isArray(dataQuality.source) ? dataQuality.source : [])
  const setSource = (field, values) => {
    fieldSources[field] = uniqueStrings([...(fieldSources[field] ?? []), ...values])
  }

  const wiki = result?.wikidata?.status === 'resolved' ? result.wikidata : null
  const steam = result?.steam?.status === 'resolved' ? result.steam : null
  if (wiki) {
    next.wikidataId = wiki.qid
    next.wikidataUrl = wiki.sourceUrl
    sources.add('wikidata_displayed_fields_verified')
    if (!text(next.ageRating) && wiki.ageRating) {
      next.ageRating = wiki.ageRating
      availability.ageRating = 'available'
      missingFields.delete('ageRating')
      setSource('ageRating', [wiki.sourceUrl])
    }
  }

  if (steam) {
    const details = steam.details
    const reviews = steam.reviews
    next.steamAppId = steam.appid
    next.steamUrl = details.sourceUrl
    next.steamCategories = details.categories.length ? details.categories : next.steamCategories ?? []
    next.supportedLanguages = details.supportedLanguages.length ? details.supportedLanguages : next.supportedLanguages ?? []
    next.platforms = uniqueStrings([...(next.platforms ?? []), ...details.platforms])
    next.developers = next.developers?.length ? next.developers : details.developers
    next.publishers = next.publishers?.length ? next.publishers : details.publishers
    next.price = details.price
    next.priceSnapshotAt = details.fetchedAt
    next.ratings = {
      ...object(next.ratings),
      steamPositivePercent: reviews?.positivePercent ?? next.ratings?.steamPositivePercent ?? null,
      metacritic: details.metacritic ?? next.ratings?.metacritic ?? next.metacritic ?? null,
    }
    next.metacritic = details.metacritic ?? next.metacritic ?? null
    next.votes = {
      ...object(next.votes),
      steamReviews: reviews?.totalReviews ?? next.votes?.steamReviews ?? null,
      steamPositive: reviews?.totalPositive ?? next.votes?.steamPositive ?? null,
      steamNegative: reviews?.totalNegative ?? next.votes?.steamNegative ?? null,
    }
    next.screenshots = next.screenshots?.length ? next.screenshots : details.screenshots
    next.headerUrl ||= details.headerImage
    next.backdropUrl ||= details.background

    availability.steam = 'available'
    availability.steamCategories = next.steamCategories?.length ? 'available' : 'not_available'
    availability.steamRating = reviews?.positivePercent != null ? 'available' : 'not_rated'
    availability.steamReviews = reviews?.totalReviews > 0 ? 'available' : 'not_rated'
    availability.metacritic = finite(next.ratings?.metacritic ?? next.metacritic) != null ? 'available' : 'not_rated'
    availability.price = next.price ? 'available' : 'not_available'
    for (const field of ['steamAppId', 'supportedLanguages', 'ratings.steamPositivePercent', 'votes.steamReviews', 'price']) {
      if (
        field === 'steamAppId'
        || (field === 'supportedLanguages' && next.supportedLanguages?.length)
        || (field === 'ratings.steamPositivePercent' && finite(next.ratings?.steamPositivePercent) != null)
        || (field === 'votes.steamReviews' && finite(next.votes?.steamReviews) != null)
        || (field === 'price' && next.price)
      ) missingFields.delete(field)
    }
    sources.add('steam_store_displayed_fields_verified')
    if (reviews) sources.add('steam_reviews_displayed_fields_verified')
    setSource('steam', [details.sourceUrl])
    if (reviews) {
      setSource('steamRating', [reviews.sourceUrl])
      setSource('steamReviews', [reviews.sourceUrl])
    }
    if (details.metacritic != null) setSource('metacritic', [details.sourceUrl])
  } else {
    availability.steam = 'not_available'
    availability.steamRating = 'not_available'
    availability.steamReviews = 'not_available'
    availability.metacritic = finite(next.ratings?.metacritic ?? next.metacritic) != null ? 'available' : 'not_rated'
    availability.price = 'not_available'
    next.price = null
  }

  if (!next.steamCategories?.length) {
    next.steamCategories = [availabilityLabel.not_available]
    availability.steamCategories = 'not_available'
  } else {
    availability.steamCategories ??= 'available'
  }
  if (!text(next.ageRating)) {
    next.ageRating = availabilityLabel.not_available
    availability.ageRating = 'not_available'
    sources.add('explicit_age_unavailable_display_value')
  } else {
    availability.ageRating ??= next.ageRating === availabilityLabel.not_available ? 'not_available' : 'available'
  }
  if (!next.publishers?.length) {
    next.publishers = [availabilityLabel.not_available]
    availability.publisher = 'not_available'
    sources.add('explicit_publisher_unavailable_display_value')
  } else {
    availability.publisher ??= 'available'
  }
  availability.metacritic ??= finite(next.ratings?.metacritic ?? next.metacritic) != null ? 'available' : 'not_rated'

  next.dataQuality = {
    ...dataQuality,
    source: [...sources],
    verified: Boolean(dataQuality.verified),
    missingFields: [...missingFields],
    fieldAvailability: availability,
    fieldSources,
    displayedFieldsAuditedAt: now,
    kinopoiskRequests: 0,
  }
  return next
}

const output = library.map((item) => (
  item.mode === 'game' && item.allowedInGame === true
    ? applyEnrichment(item, cacheDocument.byItemId[item.id])
    : item
))

const outputPlayable = output.filter((item) => item.mode === 'game' && item.allowedInGame === true)
const count = (predicate) => outputPlayable.filter(predicate).length
const summary = {
  total: outputPlayable.length,
  steamResolved: count((item) => integer(item.steamAppId) != null),
  steamCategoriesResolved: count((item) => item.dataQuality?.fieldAvailability?.steamCategories === 'available'),
  steamCategoriesExplicitUnavailable: count((item) => item.dataQuality?.fieldAvailability?.steamCategories === 'not_available'),
  steamRatingResolved: count((item) => finite(item.ratings?.steamPositivePercent) != null),
  steamReviewsResolved: count((item) => (finite(item.votes?.steamReviews) ?? 0) > 0),
  metacriticResolved: count((item) => finite(item.ratings?.metacritic ?? item.metacritic) != null),
  priceResolved: count((item) => item.dataQuality?.fieldAvailability?.price === 'available'),
  ageRatingResolved: count((item) => text(item.ageRating) && item.ageRating !== availabilityLabel.not_available),
  explicitAgeUnavailable: count((item) => item.dataQuality?.fieldAvailability?.ageRating === 'not_available'),
  publishersResolved: count((item) => item.dataQuality?.fieldAvailability?.publisher === 'available'),
  explicitPublisherUnavailable: count((item) => item.dataQuality?.fieldAvailability?.publisher === 'not_available'),
  displayedValuesFilled: count((item) => (
    item.steamCategories?.length > 0
    && text(item.ageRating)
    && item.publishers?.length > 0
  )),
  displayAvailabilityComplete: count((item) => [
    'steam', 'steamCategories', 'steamRating', 'steamReviews', 'metacritic', 'price', 'ageRating', 'publisher',
  ].every((field) => text(item.dataQuality?.fieldAvailability?.[field]))),
  kinopoiskRequests: 0,
}

const unresolved = outputPlayable.filter((item) => (
  item.dataQuality?.fieldAvailability?.steam !== 'available'
  || item.dataQuality?.fieldAvailability?.metacritic !== 'available'
  || item.dataQuality?.fieldAvailability?.ageRating !== 'available'
)).map((item) => ({
  id: item.id,
  titleRu: item.titleRu,
  year: item.year,
  fieldAvailability: item.dataQuality?.fieldAvailability,
  steamCandidates: cacheDocument.byItemId[item.id]?.steam?.candidates ?? [],
  wikidataCandidates: cacheDocument.byItemId[item.id]?.wikidata?.candidates ?? [],
}))

const report = {
  schemaVersion: 1,
  generatedAt: now,
  fetchSources,
  apply,
  sourcePolicy: cacheDocument.policy,
  summary,
  unresolved,
}

if (summary.displayAvailabilityComplete !== 1000) {
  throw new Error(`Displayed field availability is incomplete for ${1000 - summary.displayAvailabilityComplete} cards`)
}

if (apply) {
  if (searchIndex?.docs && Array.isArray(searchIndex.docs)) {
    const byId = new Map(outputPlayable.map((item) => [item.id, item]))
    for (const doc of searchIndex.docs) {
      const item = byId.get(doc.id)
      if (item) doc.steamAppId = item.steamAppId ?? null
    }
    searchIndex.generatedAt = now
    searchIndex.sourceChecksum = createHash('sha256').update(JSON.stringify(output)).digest('hex')
  }
  await Promise.all([
    writeAtomic(libraryPath, output),
    searchIndex ? writeAtomic(searchIndexPath, searchIndex) : Promise.resolve(),
    writeAtomic(reportPath, report),
  ])
} else {
  await writeAtomic(reportPath, report)
}

console.log(JSON.stringify({
  libraryPath,
  cachePath,
  reportPath,
  fetchSources,
  apply,
  summary,
}, null, 2))
