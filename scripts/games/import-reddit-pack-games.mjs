import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildPlotHint } from '../shared/plot-hint.mjs'

const root = resolve(import.meta.dirname, '../..')
const packPath = resolve(root, 'data', 'promo', 'reddit-games-comments-25-v1.json')
const libraryPath = resolve(root, 'public', 'data', 'libraries', 'games', 'items.json')
const reportPath = resolve(root, 'data', 'games', 'logs', 'reddit-pack-games-import.json')

const cleanText = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const unique = (values) => [...new Set(values.map(cleanText).filter(Boolean))]
const normalize = (value) => cleanText(value)
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const fetchJson = async (url, optional = false) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'shoditsa-content-import/1.0' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      if (attempt === 3) {
        if (optional) return null
        throw error
      }
      await new Promise((resolveDone) => setTimeout(resolveDone, attempt * 750))
    }
  }
  return null
}

const appDetails = async (appId, language, country) => {
  const payload = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=${language}&cc=${country}`, true)
  const row = payload?.[String(appId)]
  return row?.success && row.data ? row.data : null
}

const steamReviews = async (appId) => {
  const payload = await fetchJson(`https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`, true)
  const summary = payload?.query_summary
  if (!summary) return { total: 0, positive: 0, negative: 0, percent: null }
  const total = Number(summary.total_reviews) || 0
  const positive = Number(summary.total_positive) || 0
  const negative = Number(summary.total_negative) || 0
  return { total, positive, negative, percent: total > 0 ? Math.round(positive / total * 100) : null }
}

const isoDate = (value) => {
  const timestamp = Date.parse(cleanText(value))
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null
}

const yearFrom = (date, fallback) => {
  const year = date ? Number(date.slice(0, 4)) : Number(fallback)
  return Number.isInteger(year) && year >= 1800 && year <= 2200 ? year : null
}

const price = (details) => ({
  isFree: Boolean(details?.is_free),
  currency: details?.price_overview?.currency ?? null,
  initial: Number.isFinite(Number(details?.price_overview?.initial)) ? Number(details.price_overview.initial) : null,
  final: Number.isFinite(Number(details?.price_overview?.final)) ? Number(details.price_overview.final) : null,
  discountPercent: Number.isFinite(Number(details?.price_overview?.discount_percent)) ? Number(details.price_overview.discount_percent) : 0,
})

const buildCanonicalGame = async (packItem) => {
  const appId = Number(packItem.answerRef.steamAppIds?.[0])
  if (!Number.isInteger(appId) || appId <= 0) throw new Error(`${packItem.gameId}: Steam App ID is required`)
  const [ru, en, reviews] = await Promise.all([
    appDetails(appId, 'russian', 'ru'),
    appDetails(appId, 'english', 'us'),
    steamReviews(appId),
  ])
  const details = en ?? ru
  const releaseDate = isoDate(details?.release_date?.date)
  const titleRu = cleanText(packItem.answerRef.titleRu)
  const titleOriginal = cleanText(en?.name || packItem.answerRef.titleOriginal || titleRu)
  const genres = unique((details?.genres ?? []).map((entry) => entry.description))
  const steamCategories = unique((details?.categories ?? []).map((entry) => entry.description))
  const supportedLanguages = unique(cleanText(details?.supported_languages).split(','))
  const screenshots = unique((details?.screenshots ?? []).map((entry) => entry.path_full || entry.path_thumbnail)).slice(0, 12)
  const description = cleanText(ru?.detailed_description || ru?.short_description || details?.detailed_description || details?.short_description)
  const shortDescription = cleanText(ru?.short_description || details?.short_description || description).slice(0, 1200)
  const posterUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`
  const headerUrl = cleanText(details?.header_image) || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`
  const backdropUrl = cleanText(details?.background_raw || details?.background) || headerUrl
  const metacritic = Number.isFinite(Number(details?.metacritic?.score)) ? Number(details.metacritic.score) : null
  const missingFields = []
  if (!details) missingFields.push('steamStoreDetails')
  if (!genres.length) missingFields.push('genres')
  if (!steamCategories.length) missingFields.push('steamCategories')
  if (!screenshots.length) missingFields.push('screenshots')

  return {
    id: `steam_${appId}`,
    mode: 'game',
    titleRu,
    titleOriginal,
    alternativeTitles: unique([
      ...(packItem.answerRef.aliases ?? []),
      packItem.answerRef.titleOriginal,
      ru?.name,
      en?.name,
    ]).filter((value) => normalize(value) !== normalize(titleRu)),
    year: yearFrom(releaseDate, packItem.answerRef.year),
    releaseDate,
    developers: unique(details?.developers ?? []),
    publishers: unique(details?.publishers ?? []),
    platforms: Object.entries(details?.platforms ?? {}).filter(([, enabled]) => Boolean(enabled)).map(([platform]) => platform),
    genres,
    steamCategories,
    steamTags: unique([...genres, ...steamCategories]).slice(0, 20),
    supportedLanguages,
    ageRating: Number(details?.required_age) > 0 ? `${Number(details.required_age)}+` : null,
    metacritic,
    ratings: { steamPositivePercent: reviews.percent, metacritic },
    votes: { steamReviews: reviews.total, steamPositive: reviews.positive, steamNegative: reviews.negative },
    price: price(details),
    steamAppId: appId,
    steamUrl: `https://store.steampowered.com/app/${appId}/`,
    posterUrl,
    headerUrl,
    backdropUrl,
    screenshots,
    description,
    shortDescription,
    topRank: null,
    popularityScore: reviews.total > 0 ? Math.min(100, Math.max(45, Math.round(35 + Math.log10(reviews.total + 1) * 11))) : 45,
    externalRanks: { steam: appId },
    plotHint: buildPlotHint({ title: titleOriginal || titleRu, text: shortDescription || description }),
    allowedInGame: true,
    notes: ['reddit_pack_catalog_import', details ? 'steam_store_enriched' : 'steam_delisted'],
    dataQuality: {
      source: details ? ['reddit_comment_pack_answer_ref', 'steam_store_appdetails', 'steam_reviews'] : ['reddit_comment_pack_answer_ref'],
      verified: Boolean(details),
      missingFields,
    },
  }
}

const main = async () => {
  const [pack, library] = await Promise.all([
    readFile(packPath, 'utf8').then(JSON.parse),
    readFile(libraryPath, 'utf8').then(JSON.parse),
  ])
  if (!Array.isArray(library) || !Array.isArray(pack.items)) throw new Error('Invalid game library or Reddit pack')

  const steamIds = new Set(library.map((item) => Number(item.steamAppId)).filter(Number.isInteger))
  const missing = pack.items.filter((item) => {
    const ids = item.answerRef.steamAppIds ?? []
    if (ids.some((id) => steamIds.has(Number(id)))) return false
    const candidates = new Set([item.answerRef.titleRu, item.answerRef.titleOriginal, ...(item.answerRef.aliases ?? [])].map(normalize).filter(Boolean))
    const allowedYears = new Set([item.answerRef.year, ...(item.answerRef.legacyReleaseYears ?? [])].map(Number).filter(Number.isInteger))
    return !library.some((game) => {
      if (allowedYears.size > 0 && Number.isInteger(Number(game.year)) && !allowedYears.has(Number(game.year))) return false
      return [game.titleRu, game.titleOriginal, ...(game.alternativeTitles ?? [])].some((title) => candidates.has(normalize(title)))
    })
  })

  const imported = []
  for (const item of missing) {
    const game = await buildCanonicalGame(item)
    imported.push(game)
    console.log(`Prepared ${game.titleRu} (${game.steamAppId})`)
  }

  const nextLibrary = [...library, ...imported].sort((left, right) => left.titleRu.localeCompare(right.titleRu, 'ru-RU'))
  const targetSteamIds = new Set(pack.items.flatMap((item) => item.answerRef.steamAppIds ?? []).map(Number))
  const catalogGames = nextLibrary
    .filter((game) => targetSteamIds.has(Number(game.steamAppId)))
    .map((game) => ({
      id: game.id,
      titleRu: game.titleRu,
      steamAppId: game.steamAppId,
      verified: Boolean(game.dataQuality?.verified),
      missingFields: game.dataQuality?.missingFields ?? [],
    }))
  await writeFile(libraryPath, `${JSON.stringify(nextLibrary, null, 2)}\n`, 'utf8')
  await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), requested: pack.items.length, presentWithSteamIdentity: catalogGames.length, importedThisRun: imported.map((game) => game.id), catalogGames }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ imported: imported.length, totalGames: nextLibrary.length, reportPath }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
