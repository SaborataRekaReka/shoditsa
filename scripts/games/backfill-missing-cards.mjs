import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildPlotHint } from '../shared/plot-hint.mjs'

const root = resolve(import.meta.dirname, '../..')

const SEED_PATH = resolve(root, 'data', 'games', 'raw', 'playthatgame-mainlist.json')
const GAMES_OUTPUT_PATH = resolve(root, 'public', 'data', 'games.generated.json')
const INDEX_OUTPUT_PATH = resolve(root, 'public', 'data', 'game-search-index.json')
const CACHE_PATH = resolve(root, 'data', 'games', 'cache', 'thegamesdb-cache.json')
const REPORT_PATH = resolve(root, 'data', 'games', 'logs', 'import-report.thegamesdb.backfill.json')

const EDITION_WORDS = ['edition', 'collection', 'remaster', 'remastered', 'remake', 'definitive', 'goty', 'beta', 'demo', 'pack']
const WIKI_LANGS = ['ru', 'en']

const counters = {
  tgdbApiCalls: 0,
  wikiApiCalls: 0,
  tgdbCacheHits: 0,
  tgdbCacheMisses: 0,
  wikiCacheHits: 0,
  wikiCacheMisses: 0,
}

const ensureDirForFile = async (filePath) => {
  await mkdir(resolve(filePath, '..'), { recursive: true })
}

const readEnvFileIfExists = async (filePath) => {
  if (!existsSync(filePath)) return
  const content = await readFile(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [key, ...rest] = line.split('=')
    if (!key || !rest.length) continue
    const envKey = key.trim()
    if (!envKey || process.env[envKey]) continue
    process.env[envKey] = rest.join('=').trim()
  }
}

const readJsonIfExists = async (filePath, fallback) => {
  if (!existsSync(filePath)) return fallback
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

const uniq = (items) => [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))]

const normalize = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9а-яё\s]/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const parseYear = (value) => {
  const text = String(value || '').trim()
  const year = Number(text.slice(0, 4))
  return Number.isFinite(year) && year >= 1950 && year <= 2100 ? year : null
}

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const mapIdsToNames = (ids, dictionary) => {
  return uniq((ids || []).map((id) => dictionary[String(id)]?.name || ''))
}

const compactSearchPayload = (payload) => {
  const games = Array.isArray(payload?.data?.games) ? payload.data.games : []
  const compactGames = games.map((game) => ({
    id: game.id,
    game_title: game.game_title,
    release_date: game.release_date,
    platform: game.platform,
    overview: game.overview,
    players: game.players,
    rating: game.rating,
    developers: Array.isArray(game.developers) ? game.developers : [],
    genres: Array.isArray(game.genres) ? game.genres : [],
    publishers: Array.isArray(game.publishers) ? game.publishers : [],
  }))

  return {
    games: compactGames,
    platformData: payload?.include?.platform?.data || {},
  }
}

const pickBestCandidate = (seed, candidates) => {
  const seedName = normalize(seed.name)

  const scored = candidates.map((candidate) => {
    const title = String(candidate.game_title || '')
    const titleNormalized = normalize(title)
    const year = parseYear(candidate.release_date)

    let score = 0
    if (titleNormalized === seedName) score += 100
    else if (titleNormalized.startsWith(seedName) || seedName.startsWith(titleNormalized)) score += 80
    else if (titleNormalized.includes(seedName) || seedName.includes(titleNormalized)) score += 60

    if (year != null) {
      const diff = Math.abs(seed.year - year)
      if (diff === 0) score += 22
      else if (diff <= 2) score += 12
      else if (diff <= 5) score += 5
      else score -= 10
    }

    const hasEditionWord = EDITION_WORDS.some((word) => titleNormalized.includes(word))
    const seedHasEditionWord = EDITION_WORDS.some((word) => seedName.includes(word))
    if (hasEditionWord && !seedHasEditionWord) score -= 10

    if (year === 1970) score -= 50

    return { candidate, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.candidate ?? null
}

const fetchJson = async (url, kind = 'tgdb') => {
  if (kind === 'wiki') counters.wikiApiCalls += 1
  else counters.tgdbApiCalls += 1

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Seans-TheGamesDB-Backfill/1.0',
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 220)}`)
  }
  return response.json()
}

const extractImageSet = (cache, gameId) => {
  const imageEntry = cache.imagesByGameId?.[String(gameId)]
  const rows = imageEntry?.rows || []
  const base = imageEntry?.baseUrl || ''

  const firstBy = (type, side = null) => {
    const hit = rows.find((row) => row.type === type && (side == null || row.side === side))
    return hit ? `${base}${hit.filename}` : ''
  }

  const poster = firstBy('boxart', 'front') || firstBy('boxart')
  const backdrop = firstBy('fanart') || firstBy('screenshot') || firstBy('titlescreen') || poster
  const screenshots = uniq(rows
    .filter((row) => row.type === 'screenshot' || row.type === 'fanart')
    .map((row) => `${base}${row.filename}`)
  ).slice(0, 8)

  return { poster, backdrop, screenshots }
}

const buildGameFromCandidate = ({ seed, candidate, cache }) => {
  const platformName = cache.platforms[String(candidate.platform)]?.name || ''
  const genres = mapIdsToNames(candidate.genres, cache.dictionaries.genres)
  const developers = mapIdsToNames(candidate.developers, cache.dictionaries.developers)
  const publishers = mapIdsToNames(candidate.publishers, cache.dictionaries.publishers)
  const { poster, backdrop, screenshots } = extractImageSet(cache, candidate.id)

  const overview = cleanText(candidate.overview)
  const shortDescription = overview.length > 240 ? `${overview.slice(0, 240).trimEnd()}...` : overview
  const plotHint = buildPlotHint({ title: candidate.game_title, text: overview })
  const releaseYear = parseYear(candidate.release_date) ?? seed.year

  const categories = []
  if (Number.isFinite(Number(candidate.players)) && Number(candidate.players) > 0) {
    categories.push(`${Number(candidate.players)} игроков`)
    if (Number(candidate.players) > 1) categories.push('Мультиплеер')
    else categories.push('Одиночная игра')
  }

  const steamCategories = uniq(categories)
  const steamTags = uniq([...genres, ...steamCategories, ...[platformName].filter(Boolean)]).slice(0, 20)

  return {
    id: `tgdb_${candidate.id}`,
    mode: 'game',
    titleRu: candidate.game_title,
    titleOriginal: candidate.game_title,
    alternativeTitles: [],
    year: releaseYear,
    releaseDate: candidate.release_date || null,
    developers,
    publishers,
    platforms: uniq([platformName]),
    genres,
    steamCategories,
    steamTags,
    supportedLanguages: [],
    ageRating: cleanText(candidate.rating) || null,
    metacritic: null,
    ratings: {
      steamPositivePercent: null,
      metacritic: null,
    },
    votes: {
      steamReviews: 0,
      steamPositive: 0,
      steamNegative: 0,
    },
    price: {
      isFree: false,
      currency: null,
      initial: null,
      final: null,
      discountPercent: 0,
    },
    steamAppId: null,
    steamUrl: null,
    posterUrl: poster,
    headerUrl: poster,
    backdropUrl: backdrop,
    screenshots,
    description: overview,
    shortDescription,
    topRank: null,
    popularityScore: 0,
    externalRanks: {
      playThatGame: seed.rank,
      thegamesdb: candidate.id,
    },
    plotHint,
    notes: ['seed_backfill', 'thegamesdb_enriched'],
    dataQuality: {
      source: ['play_that_game_seed_list', 'thegamesdb_bygamename', 'thegamesdb_images'],
      verified: false,
      missingFields: [],
    },
  }
}

const buildWikiOnlyGame = (seed) => {
  return {
    id: `fallback_seed_${seed.rank}`,
    mode: 'game',
    titleRu: seed.name,
    titleOriginal: seed.name,
    alternativeTitles: [],
    year: seed.year,
    releaseDate: null,
    developers: [],
    publishers: [],
    platforms: [],
    genres: [],
    steamCategories: [],
    steamTags: [],
    supportedLanguages: [],
    ageRating: null,
    metacritic: null,
    ratings: {
      steamPositivePercent: null,
      metacritic: null,
    },
    votes: {
      steamReviews: 0,
      steamPositive: 0,
      steamNegative: 0,
    },
    price: {
      isFree: false,
      currency: null,
      initial: null,
      final: null,
      discountPercent: 0,
    },
    steamAppId: null,
    steamUrl: null,
    posterUrl: '',
    headerUrl: '',
    backdropUrl: '',
    screenshots: [],
    description: '',
    shortDescription: '',
    topRank: null,
    popularityScore: 0,
    externalRanks: {
      playThatGame: seed.rank,
    },
    plotHint: '',
    notes: ['seed_backfill', 'wiki_fallback_only'],
    dataQuality: {
      source: ['play_that_game_seed_list'],
      verified: false,
      missingFields: [],
    },
  }
}

const updateQuality = (game) => {
  const missing = []
  if (!cleanText(game.description) && !cleanText(game.shortDescription)) missing.push('description')
  if (!Array.isArray(game.genres) || !game.genres.length) missing.push('genres')
  if (!(Array.isArray(game.developers) && game.developers.length) && !(Array.isArray(game.publishers) && game.publishers.length)) {
    missing.push('developers_or_publishers')
  }
  if (!(cleanText(game.posterUrl) && cleanText(game.backdropUrl))) missing.push('poster_or_backdrop')

  game.dataQuality = game.dataQuality || { source: [], verified: false, missingFields: [] }
  game.dataQuality.missingFields = missing
  game.dataQuality.verified = missing.length === 0
}

const fetchWikipediaCandidate = async (cache, query) => {
  const key = cleanText(query)
  if (!key) return null

  cache.wikiByQuery = cache.wikiByQuery || {}
  if (cache.wikiByQuery[key] !== undefined) {
    counters.wikiCacheHits += 1
    return cache.wikiByQuery[key]
  }

  counters.wikiCacheMisses += 1

  for (const lang of WIKI_LANGS) {
    try {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        list: 'search',
        srlimit: '1',
        srsearch: key,
        origin: '*',
      })
      const searchPayload = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`, 'wiki')
      const first = searchPayload?.query?.search?.[0]
      if (!first?.title) continue

      const summaryPayload = await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(first.title)}`, 'wiki')
      const candidate = {
        lang,
        title: first.title,
        extract: cleanText(summaryPayload?.extract || ''),
        thumbnail: cleanText(summaryPayload?.thumbnail?.source || ''),
      }

      cache.wikiByQuery[key] = candidate
      return candidate
    } catch {
      continue
    }
  }

  cache.wikiByQuery[key] = null
  return null
}

const applyFallbacks = async (game, seed, cache) => {
  const wiki = await fetchWikipediaCandidate(cache, game.titleOriginal || game.titleRu || seed.name)
    || await fetchWikipediaCandidate(cache, seed.name)

  const textFallback = wiki?.extract || `Game from PlayThatGame list: ${seed.name}.`
  if (!cleanText(game.description)) game.description = textFallback
  if (!cleanText(game.shortDescription)) game.shortDescription = game.description.slice(0, 240)
  if (!cleanText(game.plotHint)) game.plotHint = buildPlotHint({ title: game.titleOriginal || game.titleRu, text: game.shortDescription || game.description || '' })

  const imageFallback = wiki?.thumbnail || '/images/logo.svg'
  if (!cleanText(game.posterUrl)) game.posterUrl = imageFallback
  if (!cleanText(game.headerUrl)) game.headerUrl = game.posterUrl
  if (!cleanText(game.backdropUrl)) game.backdropUrl = imageFallback

  if (!Array.isArray(game.genres) || !game.genres.length) game.genres = ['Unknown']
  if (!Array.isArray(game.platforms) || !game.platforms.length) game.platforms = ['Unknown']

  const hasDev = Array.isArray(game.developers) && game.developers.length
  const hasPub = Array.isArray(game.publishers) && game.publishers.length
  if (!hasDev && !hasPub) game.developers = ['Unknown']

  game.notes = uniq([...(game.notes || []), 'fallback_filled'])
  game.dataQuality = game.dataQuality || { source: [], verified: false, missingFields: [] }
  game.dataQuality.source = uniq([...(game.dataQuality.source || []), 'wikipedia_fallback'])

  updateQuality(game)
}

const updateTopRanks = (games) => {
  const sorted = [...games].sort((a, b) => {
    const rankA = Number(a?.externalRanks?.playThatGame ?? 999999)
    const rankB = Number(b?.externalRanks?.playThatGame ?? 999999)
    return rankA - rankB
  })

  const total = sorted.length
  return sorted.map((game, index) => {
    const popularity = total > 1
      ? Math.max(1, Math.round((1 - index / (total - 1)) * 100))
      : 100

    return {
      ...game,
      topRank: index + 1,
      popularityScore: popularity,
    }
  })
}

const main = async () => {
  await readEnvFileIfExists(resolve(root, '.env'))
  await readEnvFileIfExists(resolve(root, '.env.local'))

  const apiKey = (process.env.THEGAMESDB_API_KEY || process.env.TGDB_API_KEY || '').trim()
  if (!apiKey) throw new Error('Set THEGAMESDB_API_KEY (or TGDB_API_KEY) before running this script')

  const args = process.argv.slice(2)
  const batchArg = args.find((arg) => arg.startsWith('--batch='))
  const batchFromPair = args.includes('--batch') ? Number(args[args.indexOf('--batch') + 1]) : NaN
  const batchSize = Math.max(1, Number(batchArg?.split('=')[1] || batchFromPair || 300))

  const seedRaw = JSON.parse(await readFile(SEED_PATH, 'utf8'))
  const seeds = Array.isArray(seedRaw?.items) ? [...seedRaw.items].sort((a, b) => a.rank - b.rank) : []

  const existingGames = await readJsonIfExists(GAMES_OUTPUT_PATH, [])
  const existing = Array.isArray(existingGames) ? existingGames : []

  const cache = await readJsonIfExists(CACHE_PATH, {
    dictionaries: { genres: {}, developers: {}, publishers: {} },
    platforms: {},
    searchByQuery: {},
    imagesByGameId: {},
    wikiByQuery: {},
    updatedAt: null,
  })
  cache.wikiByQuery = cache.wikiByQuery || {}

  const existingBySeedRank = new Map()
  const existingById = new Map()
  for (const game of existing) {
    if (game?.id) existingById.set(String(game.id), game)
    const seedRank = Number(game?.externalRanks?.playThatGame)
    if (Number.isFinite(seedRank)) existingBySeedRank.set(seedRank, game)
  }

  if (!Object.keys(cache.dictionaries.genres || {}).length) {
    cache.dictionaries.genres = (await fetchJson(`https://api.thegamesdb.net/v1/Genres?apikey=${apiKey}`))?.data?.genres || {}
  }
  if (!Object.keys(cache.dictionaries.developers || {}).length) {
    cache.dictionaries.developers = (await fetchJson(`https://api.thegamesdb.net/v1/Developers?apikey=${apiKey}`))?.data?.developers || {}
  }
  if (!Object.keys(cache.dictionaries.publishers || {}).length) {
    cache.dictionaries.publishers = (await fetchJson(`https://api.thegamesdb.net/v1/Publishers?apikey=${apiKey}`))?.data?.publishers || {}
  }

  const missingSeeds = seeds.filter((seed) => !existingBySeedRank.has(seed.rank))
  const toProcess = missingSeeds.slice(0, batchSize)

  let added = 0
  const unresolved = []

  for (const seed of toProcess) {
    const queryKey = cleanText(seed.name)
    let search = cache.searchByQuery?.[queryKey]
    if (search) counters.tgdbCacheHits += 1
    else {
      counters.tgdbCacheMisses += 1
      try {
        const query = encodeURIComponent(seed.name)
        const payload = await fetchJson(`https://api.thegamesdb.net/v1.1/Games/ByGameName?apikey=${apiKey}&name=${query}&fields=overview,genres,publishers,players,platform,alternates,rating&include=platform`)
        search = compactSearchPayload(payload)
      } catch {
        search = { games: [], platformData: {} }
      }
      cache.searchByQuery[queryKey] = search
    }

    if (search?.platformData && typeof search.platformData === 'object') {
      cache.platforms = { ...cache.platforms, ...search.platformData }
    }

    const candidates = Array.isArray(search?.games) ? search.games : []
    const best = candidates.length ? pickBestCandidate(seed, candidates) : null

    let game
    if (best) {
      const gameId = String(best.id)
      if (!cache.imagesByGameId?.[gameId]) {
        try {
          const payload = await fetchJson(`https://api.thegamesdb.net/v1/Games/Images?apikey=${apiKey}&games_id=${gameId}`)
          const baseUrl = payload?.data?.base_url?.original || ''
          const rows = payload?.data?.images?.[gameId]
          cache.imagesByGameId[gameId] = {
            baseUrl,
            rows: Array.isArray(rows) ? rows : [],
          }
        } catch {
          cache.imagesByGameId[gameId] = { baseUrl: '', rows: [] }
        }
      }

      game = buildGameFromCandidate({ seed, candidate: best, cache })
    } else {
      game = buildWikiOnlyGame(seed)
    }

    await applyFallbacks(game, seed, cache)

    if (!game.dataQuality.verified) {
      unresolved.push({
        rank: seed.rank,
        name: seed.name,
        reason: 'still_incomplete',
        missing: game.dataQuality.missingFields,
      })
      continue
    }

    if (existingById.has(game.id)) {
      let suffix = 1
      while (existingById.has(`${game.id}_${suffix}`)) suffix += 1
      game.id = `${game.id}_${suffix}`
    }

    existingById.set(game.id, game)
    existingBySeedRank.set(seed.rank, game)
    added += 1
  }

  const merged = updateTopRanks([...existingById.values()])

  const index = merged.map((game) => ({
    id: game.id,
    steamAppId: game.steamAppId,
    titleRu: game.titleRu,
    titleOriginal: game.titleOriginal,
    alternativeTitles: game.alternativeTitles,
    year: game.year,
  }))

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'thegamesdb_backfill',
    counts: {
      totalGames: merged.length,
      addedThisRun: added,
      requestedBackfill: toProcess.length,
      unresolvedThisRun: unresolved.length,
      tgdbApiCalls: counters.tgdbApiCalls,
      wikiApiCalls: counters.wikiApiCalls,
      tgdbCacheHits: counters.tgdbCacheHits,
      tgdbCacheMisses: counters.tgdbCacheMisses,
      wikiCacheHits: counters.wikiCacheHits,
      wikiCacheMisses: counters.wikiCacheMisses,
      remainingMissingAfterRun: seeds.length - merged.length,
    },
    unresolvedTop50: unresolved.slice(0, 50),
  }

  cache.updatedAt = new Date().toISOString()

  await Promise.all([
    ensureDirForFile(GAMES_OUTPUT_PATH),
    ensureDirForFile(INDEX_OUTPUT_PATH),
    ensureDirForFile(CACHE_PATH),
    ensureDirForFile(REPORT_PATH),
  ])

  await Promise.all([
    writeFile(GAMES_OUTPUT_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8'),
    writeFile(INDEX_OUTPUT_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8'),
    writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8'),
    writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  ])

  console.log(`Backfill done. Added: ${added}. Total games: ${merged.length}.`) 
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
