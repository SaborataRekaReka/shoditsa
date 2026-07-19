import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildPlotHint } from '../shared/plot-hint.mjs'
import { pickBestGameCandidate } from '../shared/game-candidate-match.mjs'

const root = resolve(import.meta.dirname, '../..')

const SEED_PATH = resolve(root, 'data', 'games', 'raw', 'playthatgame-mainlist.json')
const GAMES_OUTPUT_PATH = resolve(root, 'public', 'data', 'games.generated.json')
const INDEX_OUTPUT_PATH = resolve(root, 'public', 'data', 'game-search-index.json')
const REPORT_PATH = resolve(root, 'data', 'games', 'logs', 'import-report.json')

const TARGET_COUNT = 10

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

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Seans-TheGamesDB-Top10/1.0',
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 220)}`)
  }
  return response.json()
}

const parseYear = (value) => {
  const text = String(value || '').trim()
  const year = Number(text.slice(0, 4))
  return Number.isFinite(year) && year >= 1950 && year <= 2100 ? year : null
}

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const uniq = (items) => [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))]

const mapIdsToNames = (ids, dictionary) => {
  return uniq((ids || []).map((id) => dictionary[String(id)]?.name || ''))
}

const extractImageSet = (imagesResponse, gameId) => {
  const rows = imagesResponse?.data?.images?.[String(gameId)] || []
  const base = imagesResponse?.data?.base_url?.original || ''

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

const buildGame = ({ seed, candidate, dictionaries, imagesResponse, order }) => {
  const platformMap = dictionaries.platforms
  const platformName = platformMap[String(candidate.platform)]?.name || ''
  const genres = mapIdsToNames(candidate.genres, dictionaries.genres)
  const developers = mapIdsToNames(candidate.developers, dictionaries.developers)
  const publishers = mapIdsToNames(candidate.publishers, dictionaries.publishers)
  const { poster, backdrop, screenshots } = extractImageSet(imagesResponse, candidate.id)

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
    notes: ['seed_top10', 'thegamesdb_enriched'],
    dataQuality: {
      source: ['play_that_game_seed_list', 'thegamesdb_bygamename', 'thegamesdb_images'],
      verified: missingFields.length === 0,
      missingFields,
    },
  }
}

const main = async () => {
  await readEnvFileIfExists(resolve(root, '.env'))
  await readEnvFileIfExists(resolve(root, '.env.local'))

  const apiKey = (process.env.THEGAMESDB_API_KEY || process.env.TGDB_API_KEY || '').trim()
  if (!apiKey) throw new Error('Set THEGAMESDB_API_KEY (or TGDB_API_KEY) before running this script')

  const seedRaw = JSON.parse(await readFile(SEED_PATH, 'utf8'))
  const seedItems = (seedRaw.items || []).slice(0, 150)

  const [genresPayload, developersPayload, publishersPayload] = await Promise.all([
    fetchJson(`https://api.thegamesdb.net/v1/Genres?apikey=${apiKey}`),
    fetchJson(`https://api.thegamesdb.net/v1/Developers?apikey=${apiKey}`),
    fetchJson(`https://api.thegamesdb.net/v1/Publishers?apikey=${apiKey}`),
  ])

  const dictionaries = {
    genres: genresPayload?.data?.genres || {},
    developers: developersPayload?.data?.developers || {},
    publishers: publishersPayload?.data?.publishers || {},
    platforms: {},
  }

  const selected = []

  for (const seed of seedItems) {
    if (selected.length >= TARGET_COUNT) break

    const query = encodeURIComponent(seed.name)
    const searchUrl = `https://api.thegamesdb.net/v1.1/Games/ByGameName?apikey=${apiKey}&name=${query}&fields=overview,genres,publishers,players,platform,alternates,rating&include=platform`
    let search
    try {
      search = await fetchJson(searchUrl)
    } catch {
      continue
    }

    const candidates = search?.data?.games || []
    if (!candidates.length) continue

    const best = pickBestGameCandidate(seed, candidates)
    if (!best) continue

    const platformData = search?.include?.platform?.data || {}
    dictionaries.platforms = { ...dictionaries.platforms, ...platformData }

    const imagesUrl = `https://api.thegamesdb.net/v1/Games/Images?apikey=${apiKey}&games_id=${best.id}`
    let imagesResponse
    try {
      imagesResponse = await fetchJson(imagesUrl)
    } catch {
      imagesResponse = null
    }

    const game = buildGame({
      seed,
      candidate: best,
      dictionaries,
      imagesResponse,
      order: selected.length + 1,
    })

    if (!game.dataQuality.verified) continue

    selected.push(game)
  }

  if (selected.length < TARGET_COUNT) {
    throw new Error(`Could only build ${selected.length}/${TARGET_COUNT} full game records`)
  }

  const index = selected.map((game) => ({
    id: game.id,
    steamAppId: game.steamAppId,
    titleRu: game.titleRu,
    titleOriginal: game.titleOriginal,
    alternativeTitles: game.alternativeTitles,
    year: game.year,
  }))

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'thegamesdb_top10',
    targetCount: TARGET_COUNT,
    selectedCount: selected.length,
    items: selected.map((game) => ({
      topRank: game.topRank,
      title: game.titleRu,
      seedRank: game.externalRanks.playThatGame,
      thegamesdbId: game.externalRanks.thegamesdb,
      verified: game.dataQuality.verified,
    })),
  }

  await Promise.all([
    ensureDirForFile(GAMES_OUTPUT_PATH),
    ensureDirForFile(INDEX_OUTPUT_PATH),
    ensureDirForFile(REPORT_PATH),
  ])

  await writeFile(GAMES_OUTPUT_PATH, `${JSON.stringify(selected, null, 2)}\n`, 'utf8')
  await writeFile(INDEX_OUTPUT_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`Wrote ${selected.length} full records to ${GAMES_OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
