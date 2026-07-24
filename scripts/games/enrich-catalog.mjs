#!/usr/bin/env node

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlotHint, isPlayablePlotHint } from '../shared/plot-hint.mjs'
import {
  ERA_QUOTAS,
  FORMULA_VERSION,
  SOURCE_VERSION,
  answerVariants,
  cleanText,
  editionType,
  eraKeyFor,
  franchiseKeyFor,
  isEngineComplete,
  normalizeTitle,
  scoreCatalog,
  selectDailyPool,
  thematicPoolsFor,
  technicalReason,
  uniqueStrings,
} from './enrichment-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const hasFlag = (name) => args.includes(`--${name}`)
const argValue = (name, fallback) => {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const fetchSources = hasFlag('fetch')
const publish = hasFlag('publish')
const verifyOnly = hasFlag('verify-only')
const pages = Math.max(1, Math.min(10, Number(argValue('pages', 3)) || 3))
const detailLimit = Math.max(100, Number(argValue('detail-limit', 3000)) || 3000)
const fallbackLimit = Math.max(50, Number(argValue('fallback-limit', 3000)) || 3000)
const wikidataIdLimit = Math.max(50, Number(argValue('wikidata-id-limit', 1500)) || 1500)
const concurrency = Math.max(1, Math.min(16, Number(argValue('concurrency', 8)) || 8))

const sourceLibraryPath = resolve(root, 'public/data/libraries/games/items.json')
const generatedPath = resolve(root, 'public/data/games.generated.json')
const libraryPath = resolve(root, 'public/data/libraries/games/items.json')
const searchIndexPath = resolve(root, 'public/data/libraries/games/search-index.json')
const packPath = resolve(root, 'data/promo/dtf-game-comments-25-v1.json')
const dtfCommentsPatchPath = resolve(root, 'data/games/enriched/dtf/games-dtf-catalog-patch.json')
const dtfCommentsReviewPath = resolve(root, 'data/games/enriched/dtf/games-dtf-review-required.json')
const outputDir = resolve(root, 'data/games/enriched')
const steamSpyCachePath = resolve(root, 'data/games/cache/steamspy-candidates.json')
const detailsCachePath = resolve(root, 'data/games/cache/steam-store-enrichment.json')
const reviewsCachePath = resolve(root, 'data/games/cache/steam-russian-reviews.json')
const steamSpyDetailsCachePath = resolve(root, 'data/games/cache/steamspy-appdetails-enrichment.json')
const wikidataCachePath = resolve(root, 'data/games/cache/wikidata-game-enrichment.json')
const enrichmentOverridesPath = resolve(root, 'data/games/manual/enrichment-overrides.json')

const paths = {
  backup: resolve(outputDir, 'games-source.backup.json'),
  catalog: resolve(outputDir, 'games-catalog.enriched.json'),
  daily: resolve(outputDir, 'games-daily-1000.json'),
  pools: resolve(outputDir, 'games-special-pools.json'),
  rejected: resolve(outputDir, 'games-rejected.json'),
  review: resolve(outputDir, 'games-review-required.json'),
  migration: resolve(outputDir, 'games-migration-map.json'),
  audit: resolve(outputDir, 'games-audit-before-after.csv'),
  report: resolve(outputDir, 'games-enrichment-report.md'),
  formula: resolve(outputDir, 'games-recognition-formula.json'),
}

const now = new Date().toISOString()
const today = now.slice(0, 10)
const userAgent = 'shoditsa-game-enrichment/1.0 (+https://shoditsa.ru/)'

const exists = async (path) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const readJson = async (path, fallback = null) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (fallback !== null && error?.code === 'ENOENT') return fallback
    throw error
  }
}

const writeAtomic = async (path, value) => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  const content = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}

const fetchJson = async (url, attempts = 3) => {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': userAgent },
        signal: AbortSignal.timeout(25_000),
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((done) => setTimeout(done, attempt * 350))
    }
  }
  throw lastError
}

const mapLimit = async (values, limit, worker) => {
  const result = new Array(values.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      result[index] = await worker(values[index], index)
    }
  })
  await Promise.all(runners)
  return result
}

const ownerMidpoint = (value) => {
  const numbers = String(value ?? '').match(/\d[\d,]*/g)?.map((entry) => Number(entry.replace(/,/g, ''))) ?? []
  return numbers.length >= 2 ? Math.round((numbers[0] + numbers[1]) / 2) : numbers[0] ?? null
}

const spyCandidateScore = (item) => (
  Math.log10(Number(item.positive || 0) + Number(item.negative || 0) + 1) * 20
  + Math.log10((ownerMidpoint(item.owners) ?? 0) + 1) * 12
  + Math.log10(Number(item.ccu || 0) + 1) * 5
)

const loadSteamSpy = async () => {
  if (!fetchSources || hasFlag('reuse-candidates')) {
    const cached = await readJson(steamSpyCachePath, null)
    if (!cached) throw new Error(`SteamSpy cache is absent. Run with --fetch: ${steamSpyCachePath}`)
    return cached
  }
  const pageRows = []
  for (let page = 0; page < pages; page += 1) {
    const payload = await fetchJson(`https://steamspy.com/api.php?request=all&page=${page}`)
    pageRows.push(...Object.values(payload).map((item, index) => ({
      ...item,
      steamSpyPage: page,
      steamSpyPageRank: index + 1,
    })))
    console.log(`SteamSpy page ${page + 1}/${pages}: ${Object.keys(payload).length}`)
  }
  const unique = [...new Map(pageRows.map((item) => [Number(item.appid), item])).values()]
    .filter((item) => Number.isInteger(Number(item.appid)) && cleanText(item.name))
    .sort((left, right) => spyCandidateScore(right) - spyCandidateScore(left))
    .map((item, index) => ({ ...item, steamSpyRank: index + 1 }))
  const document = {
    schemaVersion: 1,
    source: 'https://steamspy.com/api.php?request=all&page=N',
    fetchedAt: now,
    pages,
    count: unique.length,
    items: unique,
  }
  await writeAtomic(steamSpyCachePath, document)
  return document
}

const releaseDate = (value) => {
  const raw = cleanText(value)
  const year = Number(raw.match(/\b(19\d{2}|20\d{2})\b/)?.[1])
  if (!Number.isInteger(year)) return { year: null, iso: null }
  const timestamp = Date.parse(raw)
  return {
    year,
    iso: Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null,
  }
}

const platformsFrom = (platforms) => Object.entries(platforms ?? {})
  .filter(([, enabled]) => Boolean(enabled))
  .map(([platform]) => platform)

const languagesFrom = (value) => uniqueStrings(
  cleanText(value)
    .replace(/\*+/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;/|]/),
).slice(0, 25)

const compactDetails = (appid, payload) => {
  const row = payload?.[String(appid)]
  if (!row?.success || !row.data) return { status: 'unavailable', fetchedAt: now }
  const data = row.data
  const release = releaseDate(data.release_date?.date)
  return {
    status: 'ok',
    fetchedAt: now,
    sources: ['steam_store_appdetails'],
    type: data.type ?? null,
    name: cleanText(data.name),
    releaseDateRaw: cleanText(data.release_date?.date),
    releaseYear: release.year,
    releaseDate: release.iso,
    comingSoon: Boolean(data.release_date?.coming_soon),
    developers: uniqueStrings(data.developers),
    publishers: uniqueStrings(data.publishers),
    genres: uniqueStrings((data.genres ?? []).map((entry) => entry.description)),
    categories: uniqueStrings((data.categories ?? []).map((entry) => entry.description)),
    platforms: platformsFrom(data.platforms),
    supportedLanguages: languagesFrom(data.supported_languages),
    requiredAge: Number.isFinite(Number(data.required_age)) ? Number(data.required_age) : null,
    metacritic: Number.isFinite(Number(data.metacritic?.score)) ? Number(data.metacritic.score) : null,
    recommendations: Number.isFinite(Number(data.recommendations?.total)) ? Number(data.recommendations.total) : null,
    isFree: Boolean(data.is_free),
    price: data.price_overview ? {
      isFree: Boolean(data.is_free),
      currency: data.price_overview.currency ?? null,
      initial: Number.isFinite(Number(data.price_overview.initial)) ? Number(data.price_overview.initial) : null,
      final: Number.isFinite(Number(data.price_overview.final)) ? Number(data.price_overview.final) : null,
      discountPercent: Number.isFinite(Number(data.price_overview.discount_percent)) ? Number(data.price_overview.discount_percent) : 0,
    } : {
      isFree: Boolean(data.is_free),
      currency: null,
      initial: null,
      final: null,
      discountPercent: 0,
    },
    headerImage: cleanText(data.header_image),
    background: cleanText(data.background_raw || data.background),
    screenshots: uniqueStrings((data.screenshots ?? []).map((entry) => entry.path_full || entry.path_thumbnail)).slice(0, 12),
    shortDescription: cleanText(data.short_description),
    description: cleanText(data.detailed_description || data.about_the_game),
  }
}

const fetchSteamSpyDetails = async (appid) => {
  try {
    const data = await fetchJson(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`, 2)
    if (!Number.isInteger(Number(data?.appid)) || !cleanText(data?.name)) return { status: 'unavailable', fetchedAt: now }
    return {
      status: 'ok',
      fetchedAt: now,
      appid: Number(data.appid),
      name: cleanText(data.name),
      developer: cleanText(data.developer),
      publisher: cleanText(data.publisher),
      genres: uniqueStrings(cleanText(data.genre).split(',')),
      tags: uniqueStrings(Object.keys(data.tags ?? {})),
      languages: uniqueStrings(cleanText(data.languages).split(',')),
      positive: Number(data.positive || 0),
      negative: Number(data.negative || 0),
      owners: cleanText(data.owners),
      ccu: Number(data.ccu || 0),
    }
  } catch (error) {
    return { status: 'error', fetchedAt: now, error: cleanText(error?.message || error) }
  }
}

const fetchWikidataGame = async (name) => {
  const searchName = cleanText(name)
    .replace(/\b(?:definitive|complete|ultimate|deluxe|gold|game of the year|goty) edition\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const query = new URLSearchParams({
    action: 'wbsearchentities',
    search: searchName,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: '8',
    format: 'json',
    origin: '*',
  })
  try {
    const search = await fetchJson(`https://www.wikidata.org/w/api.php?${query}`)
    const acceptedNames = new Set(answerVariants(name, searchName).map(normalizeTitle))
    const result = (search.search ?? [])
      .filter((item) => /video game|computer game/i.test(cleanText(item.description)))
      .map((item) => {
        const normalizedLabel = normalizeTitle(item.label)
        const exact = acceptedNames.has(normalizedLabel)
        const contains = [...acceptedNames].some((accepted) => normalizedLabel.includes(accepted) || accepted.includes(normalizedLabel))
        return { ...item, identityScore: exact ? 1 : contains ? 0.78 : 0 }
      })
      .sort((left, right) => right.identityScore - left.identityScore)[0]
    if (!result || result.identityScore < 0.78) return { status: 'unavailable', fetchedAt: now, reason: 'no_safe_title_match' }
    const entityPayload = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${result.id}.json`)
    const entity = entityPayload?.entities?.[result.id]
    const time = entity?.claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time
      ?? entity?.claims?.P571?.[0]?.mainsnak?.datavalue?.value?.time
      ?? null
    const year = Number(String(time ?? '').match(/[+-](\d{4})-/)?.[1])
    if (!Number.isInteger(year) || year < 1950 || year > new Date().getUTCFullYear()) {
      return { status: 'unavailable', fetchedAt: now, wikidataId: result.id, reason: 'release_date_absent' }
    }
    const iso = String(time).match(/[+-](\d{4})-(\d{2})-(\d{2})T/)?.slice(1, 4)
    return {
      status: 'ok',
      fetchedAt: now,
      wikidataId: result.id,
      matchConfidence: result.identityScore,
      label: cleanText(result.label),
      releaseYear: year,
      releaseDate: iso ? iso.join('-') : null,
      sourceUrl: `https://www.wikidata.org/wiki/${result.id}`,
    }
  } catch (error) {
    return { status: 'error', fetchedAt: now, error: cleanText(error?.message || error) }
  }
}

const fetchWikidataIdBySteamAppId = async (appid) => {
  const query = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `haswbstatement:P1733=${appid}`,
    srprop: '',
    srlimit: '2',
    format: 'json',
    origin: '*',
  })
  try {
    const payload = await fetchJson(`https://www.wikidata.org/w/api.php?${query}`)
    const ids = uniqueStrings((payload?.query?.search ?? []).map((row) => row.title))
      .filter((id) => /^Q\d+$/.test(id))
    return ids.length === 1
      ? { status: 'resolved', fetchedAt: now, wikidataId: ids[0] }
      : { status: 'unavailable', fetchedAt: now, reason: ids.length ? 'ambiguous_steam_id' : 'steam_id_not_found' }
  } catch (error) {
    return { status: 'error', fetchedAt: now, error: cleanText(error?.message || error) }
  }
}

const fetchWikidataEntityBatch = async (ids) => {
  const query = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'claims|labels',
    languages: 'en|ru',
    format: 'json',
    origin: '*',
  })
  let lastError = null
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await fetchJson(`https://www.wikidata.org/w/api.php?${query}`, 1)
    } catch (error) {
      lastError = error
      if (attempt < 5) await new Promise((done) => setTimeout(done, attempt * 5_000))
    }
  }
  throw lastError
}

const releaseFromWikidataEntity = (entity, id) => {
  const time = entity?.claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time
    ?? entity?.claims?.P571?.[0]?.mainsnak?.datavalue?.value?.time
    ?? null
  const year = Number(String(time ?? '').match(/[+-](\d{4})-/)?.[1])
  if (!Number.isInteger(year) || year < 1950 || year > new Date().getUTCFullYear()) {
    return { status: 'unavailable', fetchedAt: now, wikidataId: id, reason: 'release_date_absent' }
  }
  const iso = String(time).match(/[+-](\d{4})-(\d{2})-(\d{2})T/)?.slice(1, 4)
  return {
    status: 'ok',
    fetchedAt: now,
    wikidataId: id,
    matchConfidence: 1,
    label: cleanText(entity?.labels?.en?.value || entity?.labels?.ru?.value),
    releaseYear: year,
    releaseDate: iso ? iso.join('-') : null,
    sourceUrl: `https://www.wikidata.org/wiki/${id}`,
  }
}

const fallbackDetails = (spy, wiki) => ({
  status: 'ok',
  fetchedAt: now,
  sources: ['steamspy_appdetails', 'steamspy_tags', 'wikidata_release_date'],
  type: 'game',
  name: spy.name,
  releaseDateRaw: wiki.releaseDate,
  releaseYear: wiki.releaseYear,
  releaseDate: wiki.releaseDate,
  comingSoon: false,
  developers: uniqueStrings([spy.developer]),
  publishers: uniqueStrings([spy.publisher]),
  genres: uniqueStrings(spy.genres),
  categories: [],
  steamTags: uniqueStrings(spy.tags),
  platforms: ['PC'],
  supportedLanguages: uniqueStrings(spy.languages),
  requiredAge: null,
  metacritic: null,
  recommendations: null,
  isFree: false,
  price: null,
  headerImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${spy.appid}/header.jpg`,
  background: null,
  screenshots: [],
  shortDescription: '',
  description: '',
  wikidataId: wiki.wikidataId,
  wikidataUrl: wiki.sourceUrl,
})

const fetchStoreDetails = async (appid) => {
  try {
    const payload = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=russian&cc=ru`, 2)
    return compactDetails(appid, payload)
  } catch (error) {
    return { status: 'error', fetchedAt: now, error: cleanText(error?.message || error) }
  }
}

const fetchRussianReviews = async (appid) => {
  try {
    const payload = await fetchJson(`https://store.steampowered.com/appreviews/${appid}?json=1&language=russian&purchase_type=all&num_per_page=0&filter=summary`, 2)
    const summary = payload?.query_summary
    return {
      status: summary ? 'ok' : 'unavailable',
      fetchedAt: now,
      total: summary ? Number(summary.total_reviews || 0) : null,
      positive: summary ? Number(summary.total_positive || 0) : null,
      negative: summary ? Number(summary.total_negative || 0) : null,
    }
  } catch (error) {
    return { status: 'error', fetchedAt: now, total: null, error: cleanText(error?.message || error) }
  }
}

const loadExternalEnrichment = async (candidates, priorityAppIds) => {
  const detailsDocument = await readJson(detailsCachePath, { schemaVersion: 1, updatedAt: null, byAppId: {} })
  const reviewsDocument = await readJson(reviewsCachePath, { schemaVersion: 1, updatedAt: null, byAppId: {} })
  const spyDetailsDocument = await readJson(steamSpyDetailsCachePath, { schemaVersion: 1, updatedAt: null, byAppId: {} })
  const wikidataDocument = await readJson(wikidataCachePath, { schemaVersion: 1, updatedAt: null, byName: {} })
  const byAppId = detailsDocument.byAppId ?? {}
  const reviewsByAppId = reviewsDocument.byAppId ?? {}
  const spyDetailsByAppId = spyDetailsDocument.byAppId ?? {}
  const wikidataByName = wikidataDocument.byName ?? {}
  const wikidataBySteamAppId = wikidataDocument.bySteamAppId ?? {}
  const prioritized = [
    ...priorityAppIds.map((appid) => candidates.find((item) => Number(item.appid) === Number(appid))
      ?? { appid, name: `Steam ${appid}`, positive: 0, negative: 0, owners: '', ccu: 0, steamSpyRank: null }),
    ...candidates,
  ]
  const detailTargets = [...new Map(prioritized.map((item) => [Number(item.appid), item])).values()]
    .slice(0, detailLimit)

  if (fetchSources) {
    const missingDetails = hasFlag('skip-steam-store')
      ? []
      : detailTargets.filter((item) => !byAppId[String(item.appid)] || hasFlag('refresh'))
    await mapLimit(missingDetails, concurrency, async (item, index) => {
      byAppId[String(item.appid)] = await fetchStoreDetails(Number(item.appid))
      if ((index + 1) % 100 === 0 || index + 1 === missingDetails.length) {
        console.log(`Steam Store details: ${index + 1}/${missingDetails.length}`)
        await writeAtomic(detailsCachePath, { schemaVersion: 1, updatedAt: now, byAppId })
      }
    })
    await writeAtomic(detailsCachePath, { schemaVersion: 1, updatedAt: now, byAppId })

    const fallbackTargets = detailTargets
      .filter((item) => byAppId[String(item.appid)]?.status !== 'ok')
      .slice(0, fallbackLimit)
    const missingSpyDetails = fallbackTargets.filter((item) => !spyDetailsByAppId[String(item.appid)] || hasFlag('refresh'))
    await mapLimit(missingSpyDetails, Math.min(6, concurrency), async (item, index) => {
      spyDetailsByAppId[String(item.appid)] = await fetchSteamSpyDetails(Number(item.appid))
      if ((index + 1) % 100 === 0 || index + 1 === missingSpyDetails.length) {
        console.log(`SteamSpy app details: ${index + 1}/${missingSpyDetails.length}`)
        await writeAtomic(steamSpyDetailsCachePath, { schemaVersion: 1, updatedAt: now, byAppId: spyDetailsByAppId })
      }
    })
    await writeAtomic(steamSpyDetailsCachePath, { schemaVersion: 1, updatedAt: now, byAppId: spyDetailsByAppId })

    const wikiTargets = fallbackTargets.filter((item) => spyDetailsByAppId[String(item.appid)]?.status === 'ok')
    const missingWiki = wikiTargets.filter((item) => {
      const cached = wikidataByName[normalizeTitle(spyDetailsByAppId[String(item.appid)].name)]
      return !cached
        || hasFlag('refresh')
        || (hasFlag('retry-unavailable-wikidata') && cached.status === 'unavailable')
    })
    await mapLimit(missingWiki, Math.min(6, concurrency), async (item, index) => {
      const spy = spyDetailsByAppId[String(item.appid)]
      wikidataByName[normalizeTitle(spy.name)] = await fetchWikidataGame(spy.name)
      if ((index + 1) % 100 === 0 || index + 1 === missingWiki.length) {
        console.log(`Wikidata release identities: ${index + 1}/${missingWiki.length}`)
        await writeAtomic(wikidataCachePath, { schemaVersion: 1, updatedAt: now, byName: wikidataByName, bySteamAppId: wikidataBySteamAppId })
      }
    })
    await writeAtomic(wikidataCachePath, { schemaVersion: 1, updatedAt: now, byName: wikidataByName, bySteamAppId: wikidataBySteamAppId })

    if (hasFlag('wikidata-by-steam-id')) {
      const idTargets = wikiTargets
        .filter((item) => wikidataByName[normalizeTitle(spyDetailsByAppId[String(item.appid)]?.name)]?.status !== 'ok')
        .sort((left, right) => hasFlag('prefer-recent-appids') ? Number(right.appid) - Number(left.appid) : 0)
        .slice(0, wikidataIdLimit)
      const missingIds = hasFlag('skip-wikidata-id-lookups') ? [] : idTargets.filter((item) => {
        const cached = wikidataBySteamAppId[String(item.appid)]
        return !cached || cached.status === 'error' || hasFlag('refresh-wikidata-ids')
      })
      await mapLimit(missingIds, Math.min(6, concurrency), async (item, index) => {
        wikidataBySteamAppId[String(item.appid)] = await fetchWikidataIdBySteamAppId(Number(item.appid))
        if ((index + 1) % 100 === 0 || index + 1 === missingIds.length) {
          console.log(`Wikidata Steam identities: ${index + 1}/${missingIds.length}`)
          await writeAtomic(wikidataCachePath, { schemaVersion: 1, updatedAt: now, byName: wikidataByName, bySteamAppId: wikidataBySteamAppId })
        }
      })

      const resolvedIds = uniqueStrings(idTargets
        .map((item) => wikidataBySteamAppId[String(item.appid)]?.wikidataId)
        .filter(Boolean))
      for (let index = 0; index < resolvedIds.length; index += 40) {
        const batch = resolvedIds.slice(index, index + 40)
        const payload = await fetchWikidataEntityBatch(batch)
        for (const id of batch) {
          const release = releaseFromWikidataEntity(payload?.entities?.[id], id)
          for (const item of idTargets) {
            if (wikidataBySteamAppId[String(item.appid)]?.wikidataId === id) {
              wikidataBySteamAppId[String(item.appid)] = release
            }
          }
        }
        console.log(`Wikidata entity batches: ${Math.min(index + batch.length, resolvedIds.length)}/${resolvedIds.length}`)
        await new Promise((done) => setTimeout(done, 1_200))
      }
      await writeAtomic(wikidataCachePath, { schemaVersion: 1, updatedAt: now, byName: wikidataByName, bySteamAppId: wikidataBySteamAppId })
    }

    for (const item of fallbackTargets) {
      const spy = spyDetailsByAppId[String(item.appid)]
      const wiki = wikidataByName[normalizeTitle(spy?.name)]?.status === 'ok'
        ? wikidataByName[normalizeTitle(spy?.name)]
        : wikidataBySteamAppId[String(item.appid)]
      if (spy?.status === 'ok' && wiki?.status === 'ok') byAppId[String(item.appid)] = fallbackDetails(spy, wiki)
    }
    await writeAtomic(detailsCachePath, { schemaVersion: 1, updatedAt: now, byAppId })

    const reviewTargets = detailTargets.filter((item) =>
      byAppId[String(item.appid)]?.status === 'ok'
      && byAppId[String(item.appid)]?.sources?.includes('steam_store_appdetails'))
    const missingReviews = reviewTargets.filter((item) => !reviewsByAppId[String(item.appid)] || hasFlag('refresh'))
    await mapLimit(missingReviews, concurrency, async (item, index) => {
      reviewsByAppId[String(item.appid)] = await fetchRussianReviews(Number(item.appid))
      if ((index + 1) % 150 === 0 || index + 1 === missingReviews.length) {
        console.log(`Russian Steam reviews: ${index + 1}/${missingReviews.length}`)
        await writeAtomic(reviewsCachePath, { schemaVersion: 1, updatedAt: now, byAppId: reviewsByAppId })
      }
    })
    await writeAtomic(reviewsCachePath, { schemaVersion: 1, updatedAt: now, byAppId: reviewsByAppId })
  }

  return { detailTargets, byAppId, reviewsByAppId }
}

const buildSearchIndex = (items) => {
  const tokenMap = new Map()
  const docs = [...items]
    .sort((left, right) => left.titleRu.localeCompare(right.titleRu, 'ru-RU') || left.id.localeCompare(right.id, 'en-US'))
    .map((item) => {
      const tokens = new Set(answerVariants(item.titleRu, item.titleOriginal, item.alternativeTitles, item.aliases)
        .flatMap((value) => normalizeTitle(value).split(' '))
        .filter((value) => value.length >= 2))
      for (const token of tokens) {
        const ids = tokenMap.get(token) ?? []
        ids.push(item.id)
        tokenMap.set(token, ids)
      }
      return {
        id: item.id,
        titleRu: item.titleRu,
        titleOriginal: item.titleOriginal,
        alternativeTitles: item.alternativeTitles,
        year: item.year ?? null,
        topRank: item.topRank ?? null,
        steamAppId: item.steamAppId ?? null,
        icd10: [],
      }
    })
  return {
    version: 2,
    library: 'games',
    generatedAt: now,
    totalItems: docs.length,
    tokensCount: tokenMap.size,
    docs,
    tokenToIds: Object.fromEntries([...tokenMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru-RU'))),
  }
}

const identitySources = (item) => uniqueStrings([
  ...(item.dataQuality?.source ?? []),
  ...(item.sourceFlags ?? []),
])

const commonCanonicalFields = (item, sourceFlags, matchConfidence) => {
  const titles = answerVariants(item.titleRu, item.titleOriginal, item.alternativeTitles, item.aliases)
  const reason = technicalReason(item.titleOriginal || item.titleRu)
  const complete = isEngineComplete(item)
  const reviewStatus = reason
    ? 'rejected'
    : complete && matchConfidence >= 0.85
      ? 'machine_verified'
      : 'review_required'
  const existingTags = uniqueStrings(item.steamTags)
  const hasVerifiedSteamTags = sourceFlags.some((source) => /steamspy_tags|steam_tags_verified/i.test(source))
  return {
    canonicalGameId: item.id,
    legacyIds: uniqueStrings(item.legacyIds),
    title: cleanText(item.titleOriginal || item.titleRu),
    localizedTitles: {
      ru: cleanText(item.titleRu),
      en: cleanText(item.titleOriginal || item.titleRu),
    },
    acceptedAnswers: titles,
    normalizedAnswers: [...new Set(titles.map(normalizeTitle).filter(Boolean))],
    releaseYear: Number.isInteger(Number(item.year)) ? Number(item.year) : null,
    franchiseKey: franchiseKeyFor(item.titleOriginal || item.titleRu),
    editionType: editionType(item.titleOriginal || item.titleRu),
    parentCanonicalGameId: item.parentCanonicalGameId ?? null,
    relatedVersions: Array.isArray(item.relatedVersions) ? item.relatedVersions : [],
    igdbId: Number.isInteger(Number(item.igdbId)) && Number(item.igdbId) > 0 ? Number(item.igdbId) : null,
    sourceFlags,
    poolIds: [],
    dailyEligible: !reason && complete && isPlayablePlotHint({
      title: item.titleOriginal || item.titleRu,
      titles: [item.titleRu, item.titleOriginal],
      text: item.plotHint,
    }),
    reviewStatus,
    matchConfidence,
    verifiedAt: matchConfidence >= 0.85 ? today : null,
    legacyPopularityScore: Number.isFinite(Number(item.legacyPopularityScore))
      ? Number(item.legacyPopularityScore)
      : Number(item.popularityScore || 0),
    legacySteamTags: hasVerifiedSteamTags ? uniqueStrings(item.legacySteamTags) : uniqueStrings([...(item.legacySteamTags ?? []), ...existingTags]),
    steamTags: hasVerifiedSteamTags ? existingTags : [],
    calibration: {
      knownRate: item.calibration?.knownRate ?? null,
      knownResponses: Number(item.calibration?.knownResponses || 0),
      guessRate: item.calibration?.guessRate ?? null,
      medianAttemptsToGuess: item.calibration?.medianAttemptsToGuess ?? null,
      skipRate: item.calibration?.skipRate ?? null,
      lastGameplayCalibrationAt: item.calibration?.lastGameplayCalibrationAt ?? null,
      minimumResponsesForBlend: 75,
    },
  }
}

const canonicalizeLegacy = (item, dtfSteamIds) => {
  const sourceFlags = identitySources(item)
  if (item.externalRanks?.playThatGame && !sourceFlags.includes('legacy_ptg')) sourceFlags.push('legacy_ptg')
  if (dtfSteamIds.has(Number(item.steamAppId))) sourceFlags.push('dtf_special_selected')
  const matchConfidence = item.dataQuality?.verified ? 0.9 : 0.55
  const canonical = commonCanonicalFields(item, uniqueStrings(sourceFlags), matchConfidence)
  const totalReviews = item.steamAppId && Number(item.votes?.steamReviews) > 0 ? Number(item.votes.steamReviews) : null
  return {
    ...item,
    ...canonical,
    id: cleanText(item.id),
    mode: 'game',
    titleRu: cleanText(item.titleRu),
    titleOriginal: cleanText(item.titleOriginal || item.titleRu),
    alternativeTitles: uniqueStrings(item.alternativeTitles),
    year: canonical.releaseYear,
    releaseDate: item.releaseDate ?? null,
    developers: uniqueStrings(item.developers),
    publishers: uniqueStrings(item.publishers),
    platforms: uniqueStrings(item.platforms),
    genres: uniqueStrings(item.genres),
    steamCategories: uniqueStrings(item.steamCategories),
    supportedLanguages: uniqueStrings(item.supportedLanguages),
    steamAppId: Number.isInteger(Number(item.steamAppId)) && Number(item.steamAppId) > 0 ? Number(item.steamAppId) : null,
    steamUrl: Number.isInteger(Number(item.steamAppId)) && Number(item.steamAppId) > 0 ? `https://store.steampowered.com/app/${Number(item.steamAppId)}/` : null,
    recognitionSignals: {
      ...(item.recognitionSignals ?? {}),
      steamTotalReviews: totalReviews,
      steamRussianReviews: item.recognitionSignals?.steamRussianReviews ?? null,
      legacyPtgRank: item.externalRanks?.playThatGame ?? null,
      observedAt: item.recognitionSignals?.observedAt ?? null,
    },
    dataQuality: {
      source: uniqueStrings(sourceFlags),
      verified: matchConfidence >= 0.85,
      missingFields: uniqueStrings(item.dataQuality?.missingFields),
    },
  }
}

const buildSteamGame = (candidate, details, russianReviews, dtfSteamIds, override = null) => {
  const appid = Number(candidate.appid)
  const sourceFlags = uniqueStrings([
    'steamspy_candidate_pool',
    ...(details.sources ?? ['steam_store_appdetails']),
    russianReviews?.status === 'ok' ? 'steam_reviews_russian' : null,
    dtfSteamIds.has(appid) ? 'dtf_special_selected' : null,
  ])
  const steamTitle = cleanText(candidate.name || details.name)
  const titleOriginal = cleanText(override?.titleOriginal || steamTitle)
  const titleRu = cleanText(override?.titleRu || details.name || titleOriginal)
  const releaseYear = Number.isInteger(Number(override?.releaseYear))
    ? Number(override.releaseYear)
    : details.releaseYear
  const canonicalReleaseDate = cleanText(override?.releaseDate) || details.releaseDate
  const totalReviews = Number(candidate.positive || 0) + Number(candidate.negative || 0)
  const positivePercent = totalReviews > 0 ? Math.round(Number(candidate.positive || 0) / totalReviews * 1000) / 10 : null
  const item = {
    id: `steam_${appid}`,
    mode: 'game',
    titleRu,
    titleOriginal,
    alternativeTitles: uniqueStrings([
      ...(titleRu !== titleOriginal ? [titleOriginal] : []),
      ...(steamTitle !== titleOriginal ? [steamTitle] : []),
    ]),
    aliases: uniqueStrings(override?.aliases),
    year: releaseYear,
    releaseDate: canonicalReleaseDate,
    developers: uniqueStrings(details.developers?.length ? details.developers : [candidate.developer]),
    publishers: uniqueStrings(details.publishers?.length ? details.publishers : [candidate.publisher]),
    platforms: uniqueStrings(details.platforms),
    genres: uniqueStrings(details.genres),
    steamCategories: uniqueStrings(details.categories),
    steamTags: uniqueStrings(details.steamTags),
    supportedLanguages: uniqueStrings(details.supportedLanguages),
    ageRating: details.requiredAge > 0 ? `${details.requiredAge}+` : null,
    metacritic: details.metacritic,
    ratings: { steamPositivePercent: positivePercent, metacritic: details.metacritic },
    votes: {
      steamReviews: totalReviews || null,
      steamPositive: Number(candidate.positive || 0) || null,
      steamNegative: Number(candidate.negative || 0) || null,
    },
    price: details.price,
    priceSnapshotAt: details.fetchedAt,
    steamAppId: appid,
    steamUrl: `https://store.steampowered.com/app/${appid}/`,
    posterUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    headerUrl: details.headerImage || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
    backdropUrl: details.background || details.headerImage || null,
    screenshots: uniqueStrings(details.screenshots),
    description: details.description || details.shortDescription || null,
    shortDescription: details.shortDescription || null,
    plotHint: buildPlotHint({ title: titleOriginal || titleRu, text: details.shortDescription || details.description || '' }),
    topRank: null,
    popularityScore: 0,
    externalRanks: { steamSpy: candidate.steamSpyRank },
    igdbId: null,
    wikidataId: details.wikidataId ?? null,
    wikidataUrl: details.wikidataUrl ?? null,
    notes: ['steamspy_wide_candidate', 'steam_store_enriched'],
    sourceFlags,
    recognitionSignals: {
      steamTotalReviews: totalReviews || null,
      steamRussianReviews: russianReviews?.status === 'ok' ? Number(russianReviews.total || 0) : null,
      steamOwnersMidpoint: ownerMidpoint(candidate.owners),
      steamCcu: Number(candidate.ccu || 0),
      steamSpyRank: candidate.steamSpyRank,
      igdbPlayed: null,
      igdbVisits: null,
      currentInterest: null,
      chartsCount: candidate.steamSpyPage === 0 ? 1 : 0,
      majorAwardsCount: 0,
      legacyPtgRank: null,
      manualCisAdjustment: Number(override?.manualCisAdjustment || 0),
      manualCisAdjustmentReason: override?.reason ?? null,
      observedAt: details.fetchedAt,
    },
    dataQuality: {
      source: sourceFlags,
      verified: true,
      missingFields: [],
    },
  }
  return {
    ...item,
    ...commonCanonicalFields(item, sourceFlags, 0.97),
  }
}

const arrayScore = (item) => [
  isEngineComplete(item) ? 1 : 0,
  item.steamAppId ? 1 : 0,
  identitySources(item).length,
  cleanText(item.description).length,
].reduce((total, value, index) => total + value * (10 ** (3 - index)), 0)

const mergeGames = (preferred, secondary) => {
  const first = arrayScore(preferred) >= arrayScore(secondary) ? preferred : secondary
  const second = first === preferred ? secondary : preferred
  const next = { ...second, ...first }
  for (const field of [
    'alternativeTitles', 'aliases', 'acceptedAnswers', 'normalizedAnswers', 'developers', 'publishers',
    'platforms', 'genres', 'steamCategories', 'steamTags', 'legacySteamTags', 'supportedLanguages',
    'screenshots', 'notes', 'sourceFlags', 'legacyIds',
  ]) next[field] = uniqueStrings([...(first[field] ?? []), ...(second[field] ?? [])])
  next.dataQuality = {
    source: uniqueStrings([...(first.dataQuality?.source ?? []), ...(second.dataQuality?.source ?? [])]),
    verified: Boolean(first.dataQuality?.verified || second.dataQuality?.verified),
    missingFields: uniqueStrings([...(first.dataQuality?.missingFields ?? []), ...(second.dataQuality?.missingFields ?? [])]),
  }
  next.recognitionSignals = { ...(second.recognitionSignals ?? {}), ...(first.recognitionSignals ?? {}) }
  next.id = preferred.id
  next.canonicalGameId = preferred.id
  next.legacyIds = uniqueStrings([
    ...(next.legacyIds ?? []),
    ...(secondary.id !== preferred.id ? [secondary.id] : []),
  ])
  next.matchConfidence = Math.max(Number(preferred.matchConfidence || 0), Number(secondary.matchConfidence || 0))
  return next
}

const developerIdentity = (item) => normalizeTitle(item.developers?.[0] ?? '')
const probableDuplicateKey = (item) => {
  const title = normalizeTitle(item.titleOriginal || item.titleRu)
  const year = Number(item.year)
  const developer = developerIdentity(item)
  return title && Number.isInteger(year) && developer ? `${title}|${year}|${developer}` : null
}

const deduplicate = (legacy, additions) => {
  const catalog = []
  const byId = new Map()
  const bySteam = new Map()
  const byIdentity = new Map()
  const migration = []
  const audit = []
  const rejected = []

  const add = (item, origin) => {
    const technical = technicalReason(item.titleOriginal || item.titleRu)
    if (technical) {
      rejected.push({
        canonicalGameId: item.id,
        legacyId: origin === 'legacy' ? item.id : null,
        title: item.titleOriginal || item.titleRu,
        reason: technical,
        source: origin,
      })
      audit.push({ source: origin, oldId: origin === 'legacy' ? item.id : '', canonicalGameId: '', action: 'reject', reason: technical, title: item.titleRu, year: item.year, steamAppId: item.steamAppId })
      return
    }

    const steamId = Number.isInteger(Number(item.steamAppId)) ? Number(item.steamAppId) : null
    const identityKey = probableDuplicateKey(item)
    const existing = byId.get(item.id)
      ?? (steamId ? bySteam.get(steamId) : null)
      ?? (identityKey ? byIdentity.get(identityKey) : null)
    if (existing) {
      const merged = mergeGames(existing, item)
      const index = catalog.indexOf(existing)
      catalog[index] = merged
      byId.set(merged.id, merged)
      if (steamId) bySteam.set(steamId, merged)
      if (identityKey) byIdentity.set(identityKey, merged)
      const oldId = item.id
      const newId = merged.id
      migration.push({ oldId, newId, action: oldId === newId ? 'merge_fields' : 'redirect', reason: steamId ? 'same_steam_app_id' : 'same_title_year_developer' })
      audit.push({ source: origin, oldId, canonicalGameId: newId, action: 'merge', reason: steamId ? 'same_steam_app_id' : 'same_title_year_developer', title: item.titleRu, year: item.year, steamAppId: item.steamAppId })
      return
    }
    catalog.push(item)
    byId.set(item.id, item)
    if (steamId) bySteam.set(steamId, item)
    if (identityKey) byIdentity.set(identityKey, item)
    if (origin === 'legacy') migration.push({ oldId: item.id, newId: item.id, action: 'preserve', reason: 'stable_project_id' })
    audit.push({ source: origin, oldId: origin === 'legacy' ? item.id : '', canonicalGameId: item.id, action: origin === 'legacy' ? 'keep' : 'add', reason: origin === 'legacy' ? 'canonicalized_legacy_record' : 'public_api_candidate', title: item.titleRu, year: item.year, steamAppId: item.steamAppId })
  }

  for (const item of legacy) add(item, 'legacy')
  for (const item of additions) add(item, 'steamspy')
  return { catalog, migration, audit, rejected }
}

const fieldStats = (items) => {
  const stats = new Map()
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      const row = stats.get(key) ?? { field: key, present: 0, types: new Set() }
      if (value != null && (!Array.isArray(value) || value.length)) row.present += 1
      row.types.add(Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value)
      stats.set(key, row)
    }
  }
  return [...stats.values()]
    .map((row) => ({ field: row.field, present: row.present, percent: Math.round(row.present / Math.max(1, items.length) * 1000) / 10, types: [...row.types].sort().join(', ') }))
    .sort((left, right) => left.field.localeCompare(right.field, 'en-US'))
}

const distribution = (items, selector) => Object.fromEntries(
  [...items.reduce((map, item) => {
    const key = selector(item)
    map.set(key, (map.get(key) ?? 0) + 1)
    return map
  }, new Map()).entries()].sort((left, right) => String(left[0]).localeCompare(String(right[0]), 'en-US')),
)

const missingCount = (items, predicate) => items.filter(predicate).length
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
const correlation = (pairs) => {
  if (pairs.length < 2) return null
  const xs = pairs.map(([x]) => x)
  const ys = pairs.map(([, y]) => y)
  const xMean = average(xs)
  const yMean = average(ys)
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - xMean) * (y - yMean), 0)
  const denominator = Math.sqrt(
    xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0)
    * ys.reduce((sum, y) => sum + (y - yMean) ** 2, 0),
  )
  return denominator ? Math.round(numerator / denominator * 10000) / 10000 : null
}

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
const toAuditCsv = (rows, dailyIds) => {
  const columns = ['source', 'oldId', 'canonicalGameId', 'action', 'reason', 'title', 'year', 'steamAppId', 'dailyGeneral']
  return [
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(column === 'dailyGeneral' ? dailyIds.has(row.canonicalGameId) : row[column])).join(',')),
  ].join('\n') + '\n'
}

const markdownTable = (headers, rows) => [
  `| ${headers.join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
].join('\n')

const validate = ({ catalog, daily, pools, rejected, review, migration }) => {
  const errors = []
  const dailyIds = daily.map((item) => item.canonicalGameId)
  if (dailyIds.length !== 1000) errors.push(`daily-general contains ${dailyIds.length}, expected 1000`)
  if (new Set(dailyIds).size !== dailyIds.length) errors.push('daily-general has duplicate canonicalGameId')
  const steamIds = new Map()
  for (const item of catalog) {
    if (!item.id || item.canonicalGameId !== item.id) errors.push(`${item.id}: unstable canonicalGameId`)
    if (!Number.isFinite(item.recognitionScore) || item.recognitionScore < 0 || item.recognitionScore > 100) errors.push(`${item.id}: recognitionScore out of range`)
    if (!Number.isFinite(item.scoreConfidence) || item.scoreConfidence < 0 || item.scoreConfidence > 1) errors.push(`${item.id}: scoreConfidence out of range`)
    if (!item.sourceFlags?.length) errors.push(`${item.id}: sourceFlags missing`)
    if (item.reviewStatus === 'review_required' && !review.some((entry) => entry.canonicalGameId === item.id)) errors.push(`${item.id}: absent from review queue`)
    if (item.steamAppId) {
      const existing = steamIds.get(item.steamAppId)
      if (existing) errors.push(`${existing} and ${item.id}: conflicting Steam App ID ${item.steamAppId}`)
      steamIds.set(item.steamAppId, item.id)
    }
  }
  const byId = new Map(catalog.map((item) => [item.id, item]))
  for (const ref of daily) {
    const item = byId.get(ref.canonicalGameId)
    if (!item) errors.push(`${ref.canonicalGameId}: daily reference is absent from catalog`)
    else {
      if (!isEngineComplete(item)) errors.push(`${item.id}: daily item is incomplete`)
      if (technicalReason(item.titleOriginal || item.titleRu)) errors.push(`${item.id}: technical item in daily pool`)
      if (!item.acceptedAnswers?.length) errors.push(`${item.id}: daily item has no accepted answer`)
      if (!isPlayablePlotHint({
        title: item.titleOriginal || item.titleRu,
        titles: [item.titleRu, item.titleOriginal],
        text: item.plotHint,
      })) errors.push(`${item.id}: daily item has an invalid plot hint`)
    }
  }
  for (const [franchise, count] of Object.entries(pools.stats.franchises)) {
    const limit = ['assassins-creed', 'call-of-duty', 'final-fantasy', 'grand-theft-auto', 'mario', 'pokemon', 'star-wars', 'the-elder-scrolls', 'the-legend-of-zelda'].includes(franchise) ? 5 : 3
    if (count > limit && !pools.stats.diversityFallbackCount) errors.push(`${franchise}: daily franchise limit exceeded (${count}/${limit})`)
  }
  for (const [era, quota] of Object.entries(ERA_QUOTAS)) {
    const actual = Number(pools.stats.eras[era] || 0)
    if (Math.abs(actual - quota) > 15 && !pools.stats.diversityFallbackCount) {
      errors.push(`${era}: daily era deviation is too large (${actual}/${quota})`)
    }
  }
  if (migration.some((row) => !row.oldId || !row.newId)) errors.push('migration map contains an empty ID')
  if (!Array.isArray(rejected)) errors.push('rejected output must be an array')
  return errors
}

const main = async () => {
  const baselinePath = !hasFlag('use-current-source') && await exists(paths.backup) ? paths.backup : sourceLibraryPath
  const sourceItems = await readJson(baselinePath)
  if (!Array.isArray(sourceItems)) throw new Error('Game source root must be an array')
  const [dtfPack, overrides, dtfCommentsPatch, dtfCommentsReview] = await Promise.all([
    readJson(packPath),
    readJson(enrichmentOverridesPath, { schemaVersion: 1, bySteamAppId: {} }),
    readJson(dtfCommentsPatchPath, { schemaVersion: 1, items: [] }),
    readJson(dtfCommentsReviewPath, { schemaVersion: 1, items: [] }),
  ])
  const dtfSteamIds = new Set(dtfPack.items.flatMap((item) => item.answerRef?.steamAppIds ?? []).map(Number))
  const dtfCommentsByGameId = new Map(
    (dtfCommentsPatch.items ?? [])
      .filter((item) => item?.canonicalGameId && Array.isArray(item.comments))
      .map((item) => [item.canonicalGameId, item.comments.map((comment) => {
        const {
          sourceExcerpt: _editorialSourceExcerpt,
          contentHash: _editorialContentHash,
          ...runtimeComment
        } = comment
        return runtimeComment
      })]),
  )
  const legacyDtfCommentsByGameId = new Map(
    dtfPack.items
      .filter((item) => item?.gameId && Array.isArray(item.progressiveHints))
      .map((item) => [item.gameId, item.progressiveHints]),
  )
  const reviewDtfCommentsByGameId = new Map(
    (dtfCommentsReview.items ?? [])
      .filter((item) => item?.canonicalGameId)
      .map((item) => [item.canonicalGameId, legacyDtfCommentsByGameId.get(item.gameId) ?? []]),
  )
  const dtfTargetGameIds = new Set([
    ...dtfCommentsByGameId.keys(),
    ...reviewDtfCommentsByGameId.keys(),
  ])
  const overrideBySteamAppId = overrides.bySteamAppId ?? {}
  const mustIncludeSteamIds = Object.entries(overrideBySteamAppId)
    .filter(([, override]) => override.mustIncludeDaily)
    .map(([appid]) => Number(appid))
  const priorityAppIds = [...new Set([...mustIncludeSteamIds, ...dtfSteamIds])]

  if (!(await exists(paths.backup))) await writeAtomic(paths.backup, sourceItems)
  const steamSpy = await loadSteamSpy()
  const candidates = steamSpy.items ?? []
  const { detailTargets, byAppId, reviewsByAppId } = await loadExternalEnrichment(candidates, priorityAppIds)
  const legacy = sourceItems.map((item) => canonicalizeLegacy(item, dtfSteamIds))
  const detailedCandidates = detailTargets
    .map((candidate) => ({ candidate, details: byAppId[String(candidate.appid)] }))
    .filter(({ details }) => details?.status === 'ok')

  const additions = []
  const candidateReview = []
  const candidateRejected = []
  for (const { candidate, details } of detailedCandidates) {
    const reason = technicalReason(details.name || candidate.name, details.type, details.comingSoon)
    if (reason) {
      candidateRejected.push({
        canonicalGameId: `steam_${candidate.appid}`,
        title: details.name || candidate.name,
        steamAppId: Number(candidate.appid),
        reason,
        source: 'steamspy_candidate_pool',
      })
      continue
    }
    const game = buildSteamGame(
      candidate,
      details,
      reviewsByAppId[String(candidate.appid)],
      dtfSteamIds,
      overrideBySteamAppId[String(candidate.appid)] ?? null,
    )
    if (!isEngineComplete(game)) {
      game.reviewStatus = 'review_required'
      game.dailyEligible = false
      game.matchConfidence = 0.75
      candidateReview.push({
        canonicalGameId: game.id,
        title: game.titleRu,
        reason: 'missing_required_engine_fields',
        missingFields: [
          !game.year ? 'year' : null,
          !game.genres.length ? 'genres' : null,
          !game.developers.length ? 'developers' : null,
          !game.publishers.length ? 'publishers' : null,
          !game.platforms.length ? 'platforms' : null,
        ].filter(Boolean),
      })
    }
    additions.push(game)
  }

  const unavailableCandidates = detailTargets
    .filter((candidate) => byAppId[String(candidate.appid)]?.status !== 'ok')
    .map((candidate) => ({
      canonicalGameId: `steam_${candidate.appid}`,
      title: candidate.name,
      steamAppId: Number(candidate.appid),
      reason: 'steam_store_details_unavailable',
      sourceStatus: byAppId[String(candidate.appid)]?.status ?? 'not_fetched',
    }))

  const deduped = deduplicate(legacy, additions)
  let scored = scoreCatalog(deduped.catalog)
  scored = scored.map((item) => ({
    ...item,
    dailyEligible: Boolean(
      item.dailyEligible
      && isEngineComplete(item)
      && item.reviewStatus !== 'review_required'
      && isPlayablePlotHint({
        title: item.titleOriginal || item.titleRu,
        titles: [item.titleRu, item.titleOriginal],
        text: item.plotHint,
      }),
    ),
  }))
  const selection = selectDailyPool(scored, mustIncludeSteamIds)
  if (selection.selected.length !== 1000) {
    throw new Error(`Only ${selection.selected.length} eligible canonical games are available; 1000 are required`)
  }
  const dailyIds = new Set(selection.selected.map((item) => item.id))
  const rankById = new Map(selection.selected.map((item, index) => [item.id, index + 1]))
  const catalog = scored
    .map((item) => {
      const thematic = thematicPoolsFor(item)
      if (dtfSteamIds.has(Number(item.steamAppId))) thematic.push('dtf-comments')
      const poolIds = uniqueStrings([...(dailyIds.has(item.id) ? ['daily-general'] : []), ...thematic])
      const verifiedDtfComments = dtfCommentsByGameId.get(item.id)
      const reviewDtfComments = reviewDtfCommentsByGameId.get(item.id)
      const hasLegacyDtfComments = Array.isArray(item.comments)
        && item.comments.some((comment) => comment?.sourcePackId === dtfPack.pack.id)
      const comments = verifiedDtfComments
        ?? reviewDtfComments
        ?? (hasLegacyDtfComments && !dtfTargetGameIds.has(item.id) ? undefined : item.comments)
      const sourcedComments = Array.isArray(comments)
        ? comments.filter((comment) => (
          comment?.type !== 'player_comment'
          || Boolean(cleanText(comment?.sourceId) && cleanText(comment?.sourceUrl))
        ))
        : comments
      return {
        ...item,
        comments: sourcedComments,
        poolIds,
        allowedInGame: dailyIds.has(item.id),
        contentStatus: dailyIds.has(item.id) ? 'ready' : 'limited',
        topRank: rankById.get(item.id) ?? null,
        popularityScore: item.recognitionScore,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id, 'en-US'))
  const byId = new Map(catalog.map((item) => [item.id, item]))
  const daily = [...selection.selected]
    .map((item, index) => {
      const final = byId.get(item.id)
      return {
        canonicalGameId: final.id,
        topRank: index + 1,
        recognitionScore: final.recognitionScore,
        recognitionLevel: final.recognitionLevel,
        year: final.year,
        franchiseKey: final.franchiseKey,
      }
    })
  const specialPoolNames = [
    'legacy-ptg', 'retro', 'nintendo', 'console-classics', 'rpg', 'strategy', 'indie', 'co-op',
    'survival', 'cis-classics', 'modern-hits', 'cult', 'dtf-comments', 'review-required',
  ]
  const poolMap = Object.fromEntries(specialPoolNames.map((pool) => [
    pool,
    catalog.filter((item) => item.poolIds.includes(pool) && !dailyIds.has(item.id)).map((item) => item.id),
  ]))
  const dailyCatalog = daily.map((ref) => byId.get(ref.canonicalGameId))
  const poolStats = {
    eras: distribution(dailyCatalog, (item) => eraKeyFor(item.year)),
    levels: distribution(dailyCatalog, (item) => item.recognitionLevel),
    franchises: Object.fromEntries(Object.entries(selection.franchiseCounts).filter(([key]) => key !== 'null')),
    genres: [...dailyCatalog.reduce((map, item) => {
      for (const genre of item.genres ?? []) map.set(genre, (map.get(genre) ?? 0) + 1)
      return map
    }, new Map()).entries()].sort((left, right) => right[1] - left[1]).slice(0, 30),
    nintendo: dailyCatalog.filter((item) => item.poolIds.includes('nintendo')).length,
    consoleOnly: dailyCatalog.filter((item) => !item.steamAppId).length,
    diversityFallbackCount: selection.franchiseFallbackIds.length,
  }
  const pools = {
    schemaVersion: 1,
    generatedAt: now,
    dailyGeneral: daily.map((item) => item.canonicalGameId),
    specialPools: poolMap,
    stats: poolStats,
  }

  const review = [
    ...catalog.filter((item) => item.reviewStatus === 'review_required').map((item) => ({
      canonicalGameId: item.id,
      title: item.titleRu,
      reason: 'identity_or_required_fields_need_review',
      missingFields: item.dataQuality?.missingFields ?? [],
      matchConfidence: item.matchConfidence,
    })),
    ...candidateReview,
    ...unavailableCandidates,
  ]
  const rejected = [...deduped.rejected, ...candidateRejected]
  const migration = [...new Map(deduped.migration.map((row) => [`${row.oldId}|${row.newId}`, row])).values()]
  const validationErrors = validate({ catalog, daily, pools, rejected, review, migration })
  if (validationErrors.length) throw new Error(`Enrichment validation failed:\n- ${validationErrors.join('\n- ')}`)

  const fields = fieldStats(sourceItems)
  const legacyPtgPairs = sourceItems
    .map((item) => [Number(item.externalRanks?.playThatGame), Number(item.popularityScore)])
    .filter(([rank, score]) => Number.isFinite(rank) && Number.isFinite(score))
  const beforeStats = {
    total: sourceItems.length,
    uniqueIds: new Set(sourceItems.map((item) => item.id)).size,
    eras: distribution(sourceItems, (item) => eraKeyFor(item.year)),
    steamIds: sourceItems.filter((item) => item.steamAppId).length,
    igdbIds: sourceItems.filter((item) => item.igdbId).length,
    aliases: sourceItems.filter((item) => (item.alternativeTitles?.length ?? 0) > 0).length,
    missingYear: missingCount(sourceItems, (item) => !Number.isInteger(Number(item.year))),
    missingGenres: missingCount(sourceItems, (item) => !(item.genres?.length)),
    missingDevelopers: missingCount(sourceItems, (item) => !(item.developers?.length)),
    missingPublishers: missingCount(sourceItems, (item) => !(item.publishers?.length)),
    missingImage: missingCount(sourceItems, (item) => !cleanText(item.posterUrl)),
    suspiciousTitles: missingCount(sourceItems, (item) => Boolean(technicalReason(item.titleOriginal || item.titleRu))),
    ptgPopularityCorrelation: correlation(legacyPtgPairs),
  }
  const expected = ['Divinity: Original Sin 2', 'Valheim', 'Palworld', 'Lethal Company'].map((title) => {
    const normalized = normalizeTitle(title)
    const item = catalog.find((candidate) => candidate.normalizedAnswers.includes(normalized))
    return { title, canonicalGameId: item?.id ?? null, daily: item ? dailyIds.has(item.id) : false }
  })
  const formula = {
    formulaVersion: FORMULA_VERSION,
    sourceVersion: SOURCE_VERSION,
    generatedAt: now,
    formula: {
      globalAccumulatedReach: 0.30,
      cisRecognition: 0.25,
      igdbPlayedAndVisits: 0.15,
      chartsAwardsAndLegacy: 0.10,
      currentAgeAdjustedInterest: 0.10,
      guessabilityScore: 0.10,
    },
    missingSignalRule: 'Renormalize over available independent components and reduce scoreConfidence.',
    transforms: [
      'log10 for review, owner, audience and concurrent-user counters',
      'percentiles within release-era cohorts',
      'review velocity adjusted by square root of release age',
    ],
    sources: [
      { id: 'legacy_ptg', url: 'https://playthatgame.co.uk/', role: 'low-weight historical signal' },
      { id: 'thegamesdb', url: 'https://thegamesdb.net/', role: 'legacy identity and metadata' },
      { id: 'steam_store', url: 'https://store.steampowered.com/api/appdetails', role: 'identity and current metadata' },
      { id: 'steam_reviews', url: 'https://store.steampowered.com/appreviews/', role: 'Russian review count' },
      { id: 'steamspy', url: 'https://steamspy.com/api.php', role: 'wide candidate pool and aggregate audience signals' },
    ],
    unavailableSources: [
      { id: 'igdb', reason: 'No IGDB/Twitch API credential was available; fields remain null.' },
      { id: 'steam_community_tags', reason: 'SteamSpy appdetails tags were used only when fetched for a confirmed App ID; legacy mixed values were moved to legacySteamTags.' },
    ],
  }

  const fieldRows = fields.map((row) => [row.field, row.types, `${row.present}/${sourceItems.length}`, `${row.percent}%`])
  const report = `# Отчёт об обогащении базы игр

Дата: ${now}

## Результат

- Исходных объектов: **${beforeStats.total}**
- Широкий пул SteamSpy: **${candidates.length}**
- Получено карточек Steam Store: **${detailedCandidates.length}**
- Канонический каталог: **${catalog.length}**
- Daily-general: **${daily.length}**
- Добавлено из публичных Steam-источников: **${deduped.audit.filter((row) => row.action === 'add').length}**
- Объединено/перенаправлено: **${migration.filter((row) => row.action === 'redirect' || row.action === 'merge_fields').length}**
- Отклонено: **${rejected.length}**
- В очереди ручной проверки: **${review.length}**

## До и после

${markdownTable(
  ['Метрика', 'До', 'После'],
  [
    ['Всего объектов', beforeStats.total, catalog.length],
    ['Steam App ID', beforeStats.steamIds, catalog.filter((item) => item.steamAppId).length],
    ['IGDB ID', beforeStats.igdbIds, catalog.filter((item) => item.igdbId).length],
    ['Карточки с алиасами', beforeStats.aliases, catalog.filter((item) => item.acceptedAnswers.length > 1).length],
    ['2022+', beforeStats.eras['2022_current'] ?? 0, poolStats.eras['2022_current'] ?? 0],
    ['Nintendo в daily', 'не ограничено', poolStats.nintendo],
    ['Console-only в daily', 'не ограничено', poolStats.consoleOnly],
  ],
)}

## Распределение daily-general

Эпохи:

${markdownTable(['Эпоха', 'Цель', 'Факт'], Object.entries(ERA_QUOTAS).map(([era, quota]) => [era, quota, poolStats.eras[era] ?? 0]))}

Уровни узнаваемости:

${markdownTable(['Уровень', 'Количество'], Object.entries(poolStats.levels).map(([level, count]) => [level, count]))}

Крупнейшие франшизы:

${markdownTable(['Франшиза', 'Количество'], Object.entries(poolStats.franchises).slice(0, 25).map(([franchise, count]) => [franchise, count]))}

## Ожидаемые современные игры

${markdownTable(['Игра', 'Canonical ID', 'В daily'], expected.map((item) => [item.title, item.canonicalGameId ?? 'не найдена', item.daily ? 'да' : 'нет']))}

## Аудит исходной схемы

- Корень JSON: массив.
- Стабильный публичный идентификатор: \`id\`; он сохранён как \`canonicalGameId\`.
- Принимаемые ответы: \`titleRu\`, \`titleOriginal\`, \`alternativeTitles\`, \`aliases\`.
- Сравнительные подсказки: год, topRank, жанры, Steam-категории, платформы, разработчики, издатели, Steam-рейтинг/отзывы, Metacritic, цена и возрастной рейтинг.
- \`steamAppId\` не обязателен: игровой движок имеет полноценный fallback по остальным полям.
- \`allowedInGame\` теперь является совместимым флагом daily-general; специальные карточки остаются в каталоге с \`allowedInGame: false\`.
- Корреляция старого \`popularityScore\` с рангом PlayThatGame: **${beforeStats.ptgPopularityCorrelation ?? 'н/д'}**.

${markdownTable(['Поле', 'Типы', 'Заполнено', 'Доля'], fieldRows)}

## Карта совместимости

${markdownTable(
  ['Текущее поле', 'Фактический смысл', 'Проблема', 'Новое правило', 'Миграция'],
  [
    ['id', 'публичный ID карточки', 'стабилен', 'canonicalGameId = id', 'нет'],
    ['dataQuality.verified', 'старый pipeline прошёл', 'не гарантирует идентичность', 'reviewStatus + matchConfidence + verifiedAt', 'совместимое расширение'],
    ['popularityScore', 'часто линейный PTG rank', 'не узнаваемость', 'legacyPopularityScore + recognitionScore', 'popularityScore зеркалит recognitionScore'],
    ['steamTags', 'смесь жанров/режимов/платформ', 'не реальные теги Steam', 'неподтверждённые значения → legacySteamTags', 'совместимое расширение'],
    ['topRank', 'позиция в старом списке', 'ретро-перекос', 'позиция в новом daily-general', 'пересчитано'],
    ['allowedInGame', 'допуск в общий режим', 'раньше почти всегда true/undefined', 'true только для daily-general', 'пересчитано'],
  ],
)}

## Ограничения источников

- IGDB не запрашивался без API-ключа; \`igdbPlayed\`, \`igdbVisits\` и \`igdbId\` не выдумывались.
- Steam community tags не подменялись жанрами и категориями.
- SteamSpy используется как внешний наблюдаемый сигнал, а не как единственная мера узнаваемости.
- Цена сохранена только как snapshot с датой и не входит в recognitionScore.
- Реальная игровая калибровка подготовлена, но не смешивается со score до 75 ответов на карточку.

## Проверки

- JSON валиден.
- Daily-general содержит ровно 1000 уникальных canonicalGameId.
- Конфликтов Steam App ID нет.
- Технические приложения и невышедшие игры исключены из daily.
- ${poolStats.diversityFallbackCount
    ? `Для ${poolStats.diversityFallbackCount} карточек мягкие лимиты эпох и франшиз ослаблены, чтобы в daily оставались только игры с валидной подсказкой.`
    : 'Лимиты эпох и франшиз соблюдены.'}
- Все daily-карточки имеют обязательные поля движка и принимаемый ответ.
- Все score и confidence находятся в допустимом диапазоне.
- Все старые ID сохранены либо перечислены в migration map.

## Повторный запуск

\`\`\`powershell
npm run data:enrich:games -- --fetch --publish
\`\`\`

Офлайн по сохранённым cache-файлам:

\`\`\`powershell
npm run data:enrich:games -- --publish
\`\`\`
`

  await Promise.all([
    writeAtomic(paths.catalog, catalog),
    writeAtomic(paths.daily, daily),
    writeAtomic(paths.pools, pools),
    writeAtomic(paths.rejected, rejected),
    writeAtomic(paths.review, review),
    writeAtomic(paths.migration, migration),
    writeAtomic(paths.audit, toAuditCsv(deduped.audit, dailyIds)),
    writeAtomic(paths.report, report),
    writeAtomic(paths.formula, formula),
  ])

  if (publish && !verifyOnly) {
    await Promise.all([
      writeAtomic(generatedPath, catalog),
      writeAtomic(libraryPath, [...catalog].sort((left, right) => left.titleRu.localeCompare(right.titleRu, 'ru-RU') || left.id.localeCompare(right.id, 'en-US'))),
      writeAtomic(searchIndexPath, buildSearchIndex(catalog)),
    ])
  }

  console.log(JSON.stringify({
    mode: verifyOnly ? 'verify-only' : publish ? 'publish' : 'artifacts-only',
    sourceItems: sourceItems.length,
    candidatePool: candidates.length,
    detailedCandidates: detailedCandidates.length,
    catalog: catalog.length,
    daily: daily.length,
    reviewRequired: review.length,
    rejected: rejected.length,
    eraCounts: poolStats.eras,
    expected,
    outputDir,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
