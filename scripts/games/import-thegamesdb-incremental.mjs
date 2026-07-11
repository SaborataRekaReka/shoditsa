import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildPlotHint } from '../shared/plot-hint.mjs'

const root = resolve(import.meta.dirname, '../..')

const SEED_PATH = resolve(root, 'data', 'games', 'raw', 'playthatgame-mainlist.json')
const GAMES_OUTPUT_PATH = resolve(root, 'public', 'data', 'games.generated.json')
const INDEX_OUTPUT_PATH = resolve(root, 'public', 'data', 'game-search-index.json')
const CACHE_PATH = resolve(root, 'data', 'games', 'cache', 'thegamesdb-cache.json')
const STATE_PATH = resolve(root, 'data', 'games', 'logs', 'thegamesdb-progress.json')
const REPORT_PATH = resolve(root, 'data', 'games', 'logs', 'import-report.thegamesdb.incremental.json')

const EDITION_WORDS = ['edition', 'collection', 'remaster', 'remastered', 'remake', 'definitive', 'goty', 'beta', 'demo', 'pack']

const counters = {
  apiCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
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

const chunk = (items, size) => {
  const output = []
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size))
  return output
}

const fetchJson = async (url) => {
  counters.apiCalls += 1
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Seans-TheGamesDB-Incremental/1.0',
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

const buildGame = ({ seed, candidate, cache, order }) => {
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

  const missingFields = []
  if (!overview) missingFields.push('description')
  if (!genres.length) missingFields.push('genres')
  if (!(developers.length || publishers.length)) missingFields.push('developers_or_publishers')
  if (!(poster && backdrop)) missingFields.push('poster_or_backdrop')

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
    topRank: order,
    popularityScore: Math.max(1, 100 - (order - 1) * 4),
    externalRanks: {
      playThatGame: seed.rank,
      thegamesdb: candidate.id,
    },
    plotHint,
    notes: ['seed_incremental', 'thegamesdb_enriched'],
    dataQuality: {
      source: ['play_that_game_seed_list', 'thegamesdb_bygamename', 'thegamesdb_images'],
      verified: missingFields.length === 0,
      missingFields,
    },
  }
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

const saveCache = async (cache) => {
  await ensureDirForFile(CACHE_PATH)
  await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
}

const main = async () => {
  await readEnvFileIfExists(resolve(root, '.env'))
  await readEnvFileIfExists(resolve(root, '.env.local'))

  const apiKey = (process.env.THEGAMESDB_API_KEY || process.env.TGDB_API_KEY || '').trim()
  if (!apiKey) throw new Error('Set THEGAMESDB_API_KEY (or TGDB_API_KEY) before running this script')

  const args = process.argv.slice(2)
  const batchArg = args.find((arg) => arg.startsWith('--batch='))
  const batchFromPair = args.includes('--batch') ? Number(args[args.indexOf('--batch') + 1]) : NaN
  const batchSize = Math.max(1, Number(batchArg?.split('=')[1] || batchFromPair || 20))
  const maxScansArg = args.find((arg) => arg.startsWith('--max-scans='))
  const maxScansFromPair = args.includes('--max-scans') ? Number(args[args.indexOf('--max-scans') + 1]) : NaN
  const maxScans = Math.max(batchSize * 2, Number(maxScansArg?.split('=')[1] || maxScansFromPair || batchSize * 12))
  const resetState = args.includes('--reset-state')

  const seedRaw = JSON.parse(await readFile(SEED_PATH, 'utf8'))
  const seeds = Array.isArray(seedRaw?.items) ? [...seedRaw.items].sort((a, b) => a.rank - b.rank) : []
  if (!seeds.length) throw new Error('Seed list is empty')

  const existingGames = await readJsonIfExists(GAMES_OUTPUT_PATH, [])
  const existing = Array.isArray(existingGames) ? existingGames : []

  const cache = await readJsonIfExists(CACHE_PATH, {
    dictionaries: { genres: {}, developers: {}, publishers: {} },
    platforms: {},
    searchByQuery: {},
    imagesByGameId: {},
    updatedAt: null,
  })

  const state = resetState
    ? { cursor: 0, completed: false }
    : await readJsonIfExists(STATE_PATH, { cursor: 0, completed: false })

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

  let cursor = Number.isFinite(Number(state.cursor)) ? Number(state.cursor) : 0
  cursor = Math.max(0, Math.min(cursor, seeds.length))

  let scanned = 0
  let added = 0
  const pending = []
  const skipped = []

  const flushPending = async () => {
    if (!pending.length) return

    const idsToFetch = pending
      .map((item) => String(item.candidate.id))
      .filter((id) => !cache.imagesByGameId?.[id])

    const chunks = chunk(uniq(idsToFetch), 40)
    for (const ids of chunks) {
      if (!ids.length) continue
      const payload = await fetchJson(`https://api.thegamesdb.net/v1/Games/Images?apikey=${apiKey}&games_id=${ids.join(',')}`)
      const baseUrl = payload?.data?.base_url?.original || ''
      const imagesMap = payload?.data?.images || {}
      for (const id of ids) {
        cache.imagesByGameId[id] = {
          baseUrl,
          rows: Array.isArray(imagesMap[id]) ? imagesMap[id] : [],
        }
      }
    }

    for (const item of pending) {
      if (added >= batchSize) break
      const game = buildGame({
        seed: item.seed,
        candidate: item.candidate,
        cache,
        order: 0,
      })

      if (!game.dataQuality.verified) {
        skipped.push({ rank: item.seed.rank, name: item.seed.name, reason: 'not_full_data', missing: game.dataQuality.missingFields })
        continue
      }

      if (existingById.has(game.id)) {
        const previous = existingById.get(game.id)
        const rank = Number(previous?.externalRanks?.playThatGame)
        if (Number.isFinite(rank)) existingBySeedRank.set(rank, previous)
        continue
      }

      existingById.set(game.id, game)
      existingBySeedRank.set(item.seed.rank, game)
      added += 1
    }

    pending.length = 0
  }

  while (cursor < seeds.length && added < batchSize && scanned < maxScans) {
    const seed = seeds[cursor]
    cursor += 1
    scanned += 1

    if (existingBySeedRank.has(seed.rank)) continue

    const queryKey = String(seed.name || '').trim()
    let search = cache.searchByQuery?.[queryKey]
    if (search) {
      counters.cacheHits += 1
    } else {
      counters.cacheMisses += 1
      const query = encodeURIComponent(seed.name)
      try {
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
    if (!candidates.length) {
      skipped.push({ rank: seed.rank, name: seed.name, reason: 'no_candidates' })
      if (pending.length >= 10) await flushPending()
      continue
    }

    const best = pickBestCandidate(seed, candidates)
    if (!best) {
      skipped.push({ rank: seed.rank, name: seed.name, reason: 'no_best_candidate' })
      if (pending.length >= 10) await flushPending()
      continue
    }

    pending.push({ seed, candidate: best })

    if (pending.length >= 10) await flushPending()
  }

  await flushPending()

  const merged = updateTopRanks([...existingById.values()])

  const index = merged.map((game) => ({
    id: game.id,
    steamAppId: game.steamAppId,
    titleRu: game.titleRu,
    titleOriginal: game.titleOriginal,
    alternativeTitles: game.alternativeTitles,
    year: game.year,
  }))

  const completed = cursor >= seeds.length

  const nextState = {
    cursor,
    completed,
    updatedAt: new Date().toISOString(),
    lastRun: {
      batchRequested: batchSize,
      batchAdded: added,
      scanned,
      maxScans,
      apiCalls: counters.apiCalls,
      cacheHits: counters.cacheHits,
      cacheMisses: counters.cacheMisses,
      totalGames: merged.length,
    },
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'thegamesdb_incremental',
    state: nextState,
    counts: {
      totalGames: merged.length,
      addedThisRun: added,
      scannedThisRun: scanned,
      skippedThisRun: skipped.length,
      apiCalls: counters.apiCalls,
      cacheHits: counters.cacheHits,
      cacheMisses: counters.cacheMisses,
    },
    skippedTop50: skipped.slice(0, 50),
    top25: merged.slice(0, 25).map((game) => ({
      topRank: game.topRank,
      titleRu: game.titleRu,
      seedRank: game.externalRanks?.playThatGame,
      thegamesdbId: game.externalRanks?.thegamesdb,
      verified: game.dataQuality?.verified,
    })),
  }

  cache.updatedAt = new Date().toISOString()

  await Promise.all([
    ensureDirForFile(GAMES_OUTPUT_PATH),
    ensureDirForFile(INDEX_OUTPUT_PATH),
    ensureDirForFile(CACHE_PATH),
    ensureDirForFile(STATE_PATH),
    ensureDirForFile(REPORT_PATH),
  ])

  await Promise.all([
    writeFile(GAMES_OUTPUT_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8'),
    writeFile(INDEX_OUTPUT_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8'),
    writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8'),
    writeFile(STATE_PATH, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8'),
    writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  ])

  console.log(`Incremental import done. Added: ${added}. Total games: ${merged.length}. API calls: ${counters.apiCalls}.`) 
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
