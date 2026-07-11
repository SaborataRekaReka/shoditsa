import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildPlotHint } from '../shared/plot-hint.mjs'

const root = resolve(import.meta.dirname, '../..')
const PLAY_THAT_GAME_URL = 'http://playthatgame.co.uk/?action=mainlist'
const BASE_TARGET_COUNT = 500
const HIGH_RANK_REVIEW_EXCEPTION = 120
const FRANCHISE_LIMIT = 6

const args = process.argv.slice(2)
const includeAllFromSeed = args.includes('--all') || process.env.GAMES_INCLUDE_ALL === '1'

const SEED_RAW_PATH = resolve(root, 'data', 'games', 'raw', 'playthatgame-mainlist.json')
const SEED_MANUAL_HTML_PATH = resolve(root, 'data', 'games', 'manual', 'playthatgame-mainlist.html')
const MANUAL_OVERRIDES_PATH = resolve(root, 'data', 'games', 'manual', 'overrides.json')
const GAMES_OUTPUT_PATH = resolve(root, 'public', 'data', 'games.generated.json')
const INDEX_OUTPUT_PATH = resolve(root, 'public', 'data', 'game-search-index.json')
const REPORT_OUTPUT_PATH = resolve(root, 'data', 'games', 'logs', 'import-report.json')
const UNRESOLVED_OUTPUT_PATH = resolve(root, 'data', 'games', 'logs', 'unresolved-games.json')

const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php'
const WIKIDATA_ENTITY_URL = 'https://www.wikidata.org/wiki/Special:EntityData'
const WIKIPEDIA_LANGS = ['ru', 'en']

const EDITION_WORDS = [
  'goty',
  'game of the year',
  'definitive',
  'director',
  'director\'s cut',
  'complete',
  'anniversary',
  'ultimate',
  'remastered',
  'remaster',
  'remake',
  'enhanced',
  'redux',
  'hd',
  'collection',
  'trilogy',
  'legacy',
]

const STOPWORDS = new Set([
  'the',
  'and',
  'of',
  'for',
  'to',
  'a',
  'an',
  'in',
  'on',
  'at',
  'is',
  'it',
  'by',
  'from',
  'edition',
  'game',
  'games',
  'part',
])

const EXCLUDE_KEYWORDS = [
  'dlc',
  'demo',
  'soundtrack',
  'playtest',
  'dedicated server',
  'server',
  'sdk',
  'benchmark',
  'prologue',
  'artbook',
  'ost',
  'test server',
]

const REMASTER_KEYWORDS = ['remaster', 'remastered', 'remake', 'definitive', 'redux', 'enhanced', 'anniversary']

const FRANCHISE_PATTERNS = [
  { key: 'gta', regex: /(grand theft auto|\bgta\b)/i },
  { key: 'call_of_duty', regex: /(call of duty|\bcod\b)/i },
  { key: 'final_fantasy', regex: /final fantasy/i },
  { key: 'resident_evil', regex: /resident evil/i },
  { key: 'assassins_creed', regex: /assassin'?s creed/i },
  { key: 'yakuza_like_a_dragon', regex: /(yakuza|like a dragon)/i },
  { key: 'total_war', regex: /total war/i },
  { key: 'civilization', regex: /(sid meier'?s civilization|\bcivilization\b)/i },
  { key: 'fallout', regex: /\bfallout\b/i },
  { key: 'elder_scrolls', regex: /(elder scrolls|\btes\b)/i },
  { key: 'dark_souls', regex: /(dark souls|demon'?s souls)/i },
  { key: 'doom', regex: /^doom\b|\bdoom\b/i },
  { key: 'street_fighter', regex: /street fighter/i },
  { key: 'tekken', regex: /\btekken\b/i },
  { key: 'tomb_raider', regex: /tomb raider/i },
  { key: 'sonic', regex: /\bsonic\b/i },
  { key: 'lego', regex: /\blego\b/i },
  { key: 'warhammer', regex: /\bwarhammer\b/i },
]

const wait = (ms) => new Promise((resolveDone) => setTimeout(resolveDone, ms))

const ensureDirForFile = async (filePath) => {
  await mkdir(resolve(filePath, '..'), { recursive: true })
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

const htmlEntityMap = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
}

const decodeHtml = (value) => {
  if (!value) return ''
  let text = String(value)
  for (const [entity, replacement] of Object.entries(htmlEntityMap)) {
    text = text.replaceAll(entity, replacement)
  }
  text = text.replace(/&#(\d+);/g, (_, code) => {
    const n = Number(code)
    if (!Number.isFinite(n)) return ''
    try {
      return String.fromCodePoint(n)
    } catch {
      return ''
    }
  })
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    const n = Number.parseInt(code, 16)
    if (!Number.isFinite(n)) return ''
    try {
      return String.fromCodePoint(n)
    } catch {
      return ''
    }
  })
  return text
}

const stripHtml = (value) => decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())

const normalizeName = (value) => {
  const lowered = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9а-яё\s:.-]/gi, ' ')
    .replace(/[.:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return lowered
}

const stripEditionSuffixes = (value) => {
  let current = value
  for (const word of EDITION_WORDS) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'gi')
    current = current.replace(regex, ' ')
  }
  return current.replace(/\s+/g, ' ').trim()
}

const tokenize = (normalizedName) => {
  return normalizedName
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !STOPWORDS.has(token))
}

const buildBigrams = (text) => {
  const compact = text.replace(/\s+/g, ' ').trim()
  const grams = []
  for (let i = 0; i < compact.length - 1; i += 1) grams.push(compact.slice(i, i + 2))
  return grams
}

const diceSimilarity = (a, b) => {
  if (!a || !b) return 0
  if (a === b) return 1
  const gramsA = buildBigrams(a)
  const gramsB = buildBigrams(b)
  if (!gramsA.length || !gramsB.length) return 0
  const counts = new Map()
  for (const gram of gramsA) counts.set(gram, (counts.get(gram) ?? 0) + 1)
  let overlap = 0
  for (const gram of gramsB) {
    const left = counts.get(gram) ?? 0
    if (left > 0) {
      overlap += 1
      counts.set(gram, left - 1)
    }
  }
  return (2 * overlap) / (gramsA.length + gramsB.length)
}

const levenshteinDistance = (a, b) => {
  const al = a.length
  const bl = b.length
  if (!al) return bl
  if (!bl) return al

  const prev = new Array(bl + 1)
  const curr = new Array(bl + 1)
  for (let j = 0; j <= bl; j += 1) prev[j] = j

  for (let i = 1; i <= al; i += 1) {
    curr[0] = i
    for (let j = 1; j <= bl; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= bl; j += 1) prev[j] = curr[j]
  }

  return prev[bl]
}

const levenshteinSimilarity = (a, b) => {
  if (!a || !b) return 0
  const maxLen = Math.max(a.length, b.length)
  if (!maxLen) return 1
  const dist = levenshteinDistance(a, b)
  return Math.max(0, 1 - dist / maxLen)
}

const tokenJaccard = (leftTokens, rightTokens) => {
  if (!leftTokens.length || !rightTokens.length) return 0
  const left = new Set(leftTokens)
  const right = new Set(rightTokens)
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  const union = new Set([...left, ...right]).size
  return union ? intersection / union : 0
}

const nameSimilarity = (seedNorm, seedCanon, seedTokens, candidateNorm, candidateCanon, candidateTokens) => {
  const lev = levenshteinSimilarity(seedCanon, candidateCanon)
  const dice = diceSimilarity(seedCanon, candidateCanon)
  const jaccard = tokenJaccard(seedTokens, candidateTokens)
  const containsBonus = candidateCanon.includes(seedCanon) || seedCanon.includes(candidateCanon) ? 0.05 : 0
  return Math.min(1, lev * 0.45 + dice * 0.35 + jaccard * 0.2 + containsBonus)
}

const parseYear = (value) => {
  const year = Number(value)
  if (!Number.isFinite(year)) return null
  if (year < 1950 || year > 2100) return null
  return year
}

const parsePlayThatGameRows = (html) => {
  const rows = []
  const regex = /<tr>\s*<td>\s*(\d{1,4})\s*<\/td>\s*<td>\s*([\s\S]*?)\s*<\/td>\s*<td>\s*(\d{4})\s*<\/td>\s*<\/tr>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    const rank = Number(match[1])
    const name = stripHtml(match[2])
    const year = parseYear(match[3])
    if (!Number.isFinite(rank) || !name || !year) continue
    rows.push({ rank, name, year })
  }
  return rows.sort((a, b) => a.rank - b.rank)
}

const fetchTextWithRetry = async (url, retries = 4) => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Shoditsa-Steam-Importer/1.0',
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        },
      })
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) throw new Error(`HTTP ${response.status}`)
        return null
      }
      return response.text()
    } catch (error) {
      if (attempt >= retries) break
      await wait(400 * (attempt + 1))
    }
  }
  return null
}

const loadSeedList = async () => {
  let html = await fetchTextWithRetry(PLAY_THAT_GAME_URL)
  let source = 'remote'

  if (!html && existsSync(SEED_MANUAL_HTML_PATH)) {
    html = await readFile(SEED_MANUAL_HTML_PATH, 'utf8')
    source = 'manual_html'
  }

  if (!html) {
    throw new Error(`Could not fetch ${PLAY_THAT_GAME_URL} and fallback file is missing: ${SEED_MANUAL_HTML_PATH}`)
  }

  const rows = parsePlayThatGameRows(html)
  if (!rows.length) throw new Error('Play That Game parser returned 0 rows')

  await ensureDirForFile(SEED_RAW_PATH)
  await writeFile(SEED_RAW_PATH, `${JSON.stringify({ source, fetchedAt: new Date().toISOString(), total: rows.length, items: rows }, null, 2)}\n`, 'utf8')

  return rows
}

const getSteamKey = () => {
  return (
    process.env.STEAM_WEB_API_KEY
    || process.env.STEAM_API_KEY
    || process.env.STEAM_KEY
    || ''
  ).trim()
}

const fetchJsonWithRetry = async (url, retries = 5, pauseMs = 200) => {
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Shoditsa-Steam-Importer/1.0',
          Accept: 'application/json,text/plain,*/*',
        },
      })
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`)
        const body = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status} ${body.slice(0, 220)}`)
      }
      return response.json()
    } catch (error) {
      lastError = error
      if (attempt >= retries) break
      await wait(pauseMs * (attempt + 1))
    }
  }
  throw lastError
}

const buildSteamAppListUrl = (baseUrl, key, lastAppId) => {
  const params = new URLSearchParams()
  params.set('key', key)
  params.set('include_games', 'true')
  params.set('include_dlc', 'false')
  params.set('include_software', 'false')
  params.set('include_videos', 'false')
  params.set('include_hardware', 'false')
  params.set('max_results', '50000')
  if (lastAppId) params.set('last_appid', String(lastAppId))
  return `${baseUrl}?${params.toString()}`
}

const fetchSteamAppListPublic = async () => {
  const url = 'https://api.steampowered.com/ISteamApps/GetAppList/v2/'
  const payload = await fetchJsonWithRetry(url, 3, 220)
  const apps = payload?.applist?.apps
  return Array.isArray(apps) ? apps : []
}

const fetchSteamAppList = async (key) => {
  if (!key) {
    console.warn('Steam key is missing. Using public ISteamApps/GetAppList fallback.')
    try {
      return await fetchSteamAppListPublic()
    } catch {
      console.warn('Public Steam app list is unavailable. Continue with non-Steam enrichment only.')
      return []
    }
  }

  const endpoints = [
    'https://partner.steam-api.com/IStoreService/GetAppList/v1/',
    'https://api.steampowered.com/IStoreService/GetAppList/v1/',
  ]

  let selectedEndpoint = null
  for (const endpoint of endpoints) {
    const testUrl = buildSteamAppListUrl(endpoint, key, 0)
    try {
      const payload = await fetchJsonWithRetry(testUrl, 1, 120)
      if (Array.isArray(payload?.response?.apps)) {
        selectedEndpoint = endpoint
        break
      }
    } catch {
      continue
    }
  }

  if (!selectedEndpoint) {
    console.warn('Could not access Steam IStoreService endpoint. Trying public ISteamApps/GetAppList fallback.')
    try {
      return await fetchSteamAppListPublic()
    } catch {
      console.warn('Public Steam app list is unavailable. Continue with non-Steam enrichment only.')
      return []
    }
  }

  const apps = []
  let lastAppId = 0
  let loops = 0

  while (loops < 30) {
    loops += 1
    const url = buildSteamAppListUrl(selectedEndpoint, key, lastAppId)
    const payload = await fetchJsonWithRetry(url, 4, 200)
    const chunk = payload?.response?.apps ?? []
    if (!Array.isArray(chunk) || !chunk.length) break

    apps.push(...chunk)
    const haveMore = Boolean(payload?.response?.have_more_results)
    const nextLast = Number(payload?.response?.last_appid ?? 0)

    if (!haveMore || !nextLast || nextLast === lastAppId) break
    lastAppId = nextLast
    await wait(120)
  }

  return apps
}

const toSteamRecord = (entry, idx) => {
  const appid = Number(entry?.appid)
  const name = stripHtml(entry?.name || '')
  if (!Number.isInteger(appid) || appid <= 0 || !name) return null

  const normalized = normalizeName(name)
  const canonical = stripEditionSuffixes(normalized)
  const tokens = tokenize(canonical)

  return {
    idx,
    appid,
    name,
    normalized,
    canonical,
    tokens,
  }
}

const mapWithConcurrency = async (items, limit, worker) => {
  if (!items.length) return []
  const results = new Array(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const current = cursor
      cursor += 1
      if (current >= items.length) break
      results[current] = await worker(items[current], current)
    }
  })

  await Promise.all(runners)
  return results
}

const loadManualOverrides = async () => {
  const fallback = { byId: {}, byRank: {} }
  const parsed = await readJsonIfExists(MANUAL_OVERRIDES_PATH, fallback)
  if (!parsed || typeof parsed !== 'object') return fallback
  const byId = parsed.byId && typeof parsed.byId === 'object' ? parsed.byId : {}
  const byRank = parsed.byRank && typeof parsed.byRank === 'object' ? parsed.byRank : {}
  return { byId, byRank }
}

const getManualOverride = (overrides, game) => {
  const fromId = overrides.byId?.[game.id]
  if (fromId && typeof fromId === 'object') return fromId
  const rank = game.externalRanks?.playThatGame
  if (Number.isFinite(rank)) {
    const fromRank = overrides.byRank?.[String(rank)]
    if (fromRank && typeof fromRank === 'object') return fromRank
  }
  return null
}

const uniqueStrings = (items) => [...new Set((items ?? []).map((item) => String(item || '').trim()).filter(Boolean))]
const appendUnique = (left, right) => uniqueStrings([...(left ?? []), ...(right ?? [])])

const normalizeOverrideArray = (value) => {
  if (Array.isArray(value)) return uniqueStrings(value)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

const applyManualOverride = (game, override) => {
  if (!override || typeof override !== 'object') return false
  let changed = false

  const setScalar = (key) => {
    if (override[key] === undefined || override[key] === null) return
    if (game[key] === override[key]) return
    game[key] = override[key]
    changed = true
  }

  const setList = (key) => {
    const values = normalizeOverrideArray(override[key])
    if (!values.length) return
    const merged = appendUnique(game[key], values)
    if (JSON.stringify(merged) === JSON.stringify(game[key] ?? [])) return
    game[key] = merged
    changed = true
  }

  setScalar('titleRu')
  setScalar('titleOriginal')
  setScalar('year')
  setScalar('releaseDate')
  setScalar('ageRating')
  setScalar('metacritic')
  setScalar('description')
  setScalar('shortDescription')
  setScalar('plotHint')
  setScalar('posterUrl')
  setScalar('backdropUrl')

  setList('alternativeTitles')
  setList('developers')
  setList('publishers')
  setList('platforms')
  setList('genres')
  setList('steamCategories')
  setList('steamTags')
  setList('supportedLanguages')
  setList('screenshots')

  if (Array.isArray(override.notes) && override.notes.length) {
    game.notes = appendUnique(game.notes, override.notes)
    changed = true
  }

  if (changed) {
    game.notes = appendUnique(game.notes, ['manual_override'])
  }

  return changed
}

const wikidataSearchCache = new Map()
const wikidataEntityCache = new Map()
const wikidataLabelCache = new Map()
const wikipediaSearchCache = new Map()
const wikipediaSummaryCache = new Map()

const parseWikidataYear = (time) => {
  const value = String(time || '')
  const match = value.match(/([+-]\d{4})-/)
  if (!match) return null
  const year = Number(match[1])
  return Number.isFinite(year) ? Math.abs(year) : null
}

const parseWikidataIsoDate = (time) => {
  const match = String(time || '').match(/^([+-]\d{4})-(\d{2})-(\d{2})T/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(year) || !month || !day) return null
  return `${String(Math.abs(year)).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const getWikidataClaimValues = (entity, property) => {
  const claims = entity?.claims?.[property]
  if (!Array.isArray(claims)) return []
  return claims
    .map((claim) => claim?.mainsnak?.datavalue?.value)
    .filter(Boolean)
}

const toWikidataEntityId = (value) => {
  if (!value || typeof value !== 'object') return null
  const id = value.id
  if (typeof id === 'string' && /^Q\d+$/.test(id)) return id
  const numeric = Number(value['numeric-id'])
  if (Number.isInteger(numeric) && numeric > 0) return `Q${numeric}`
  return null
}

const wikidataImageUrl = (fileName) => {
  const cleaned = String(fileName || '').trim()
  if (!cleaned) return ''
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(cleaned.replace(/\s+/g, '_'))}`
}

const fetchWikidataSearch = async (query) => {
  const key = String(query || '').trim()
  if (!key) return []
  if (wikidataSearchCache.has(key)) return wikidataSearchCache.get(key)

  const params = new URLSearchParams({
    action: 'wbsearchentities',
    format: 'json',
    language: 'en',
    uselang: 'ru',
    type: 'item',
    limit: '8',
    origin: '*',
    search: key,
  })
  const url = `${WIKIDATA_API_URL}?${params.toString()}`
  try {
    const payload = await fetchJsonWithRetry(url, 2, 140)
    const list = Array.isArray(payload?.search) ? payload.search : []
    wikidataSearchCache.set(key, list)
    return list
  } catch {
    wikidataSearchCache.set(key, [])
    return []
  }
}

const fetchWikidataEntity = async (entityId) => {
  const id = String(entityId || '').trim()
  if (!/^Q\d+$/.test(id)) return null
  if (wikidataEntityCache.has(id)) return wikidataEntityCache.get(id)

  const url = `${WIKIDATA_ENTITY_URL}/${id}.json`
  try {
    const payload = await fetchJsonWithRetry(url, 2, 180)
    const entity = payload?.entities?.[id] ?? null
    wikidataEntityCache.set(id, entity)
    return entity
  } catch {
    wikidataEntityCache.set(id, null)
    return null
  }
}

const fetchWikidataLabels = async (ids) => {
  const result = {}
  const queue = uniqueStrings(ids).filter((id) => /^Q\d+$/.test(id))
  const missing = []

  for (const id of queue) {
    if (wikidataLabelCache.has(id)) {
      result[id] = wikidataLabelCache.get(id)
    } else {
      missing.push(id)
    }
  }

  for (let i = 0; i < missing.length; i += 45) {
    const chunk = missing.slice(i, i + 45)
    const params = new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: chunk.join('|'),
      props: 'labels',
      languages: 'ru|en',
      languagefallback: '1',
      origin: '*',
    })
    const url = `${WIKIDATA_API_URL}?${params.toString()}`
    try {
      const payload = await fetchJsonWithRetry(url, 2, 140)
      const entities = payload?.entities ?? {}
      for (const id of chunk) {
        const labels = entities?.[id]?.labels
        const value = labels?.ru?.value || labels?.en?.value || ''
        wikidataLabelCache.set(id, value)
        result[id] = value
      }
    } catch {
      for (const id of chunk) {
        wikidataLabelCache.set(id, '')
        result[id] = ''
      }
    }
  }

  return result
}

const mapWikidataEntity = async (entity) => {
  if (!entity) return null
  const labelRu = entity?.labels?.ru?.value || ''
  const labelEn = entity?.labels?.en?.value || ''
  const aliasesRu = Array.isArray(entity?.aliases?.ru) ? entity.aliases.ru.map((item) => item?.value).filter(Boolean) : []
  const aliasesEn = Array.isArray(entity?.aliases?.en) ? entity.aliases.en.map((item) => item?.value).filter(Boolean) : []
  const releaseRaw = getWikidataClaimValues(entity, 'P577')
  const years = uniqueStrings(releaseRaw.map((item) => parseWikidataYear(item?.time))).map((value) => Number(value)).filter(Number.isFinite)
  const isoDate = releaseRaw.map((item) => parseWikidataIsoDate(item?.time)).find(Boolean) || null

  const genres = getWikidataClaimValues(entity, 'P136').map(toWikidataEntityId).filter(Boolean)
  const platforms = getWikidataClaimValues(entity, 'P400').map(toWikidataEntityId).filter(Boolean)
  const developers = getWikidataClaimValues(entity, 'P178').map(toWikidataEntityId).filter(Boolean)
  const publishers = getWikidataClaimValues(entity, 'P123').map(toWikidataEntityId).filter(Boolean)

  const labels = await fetchWikidataLabels([...genres, ...platforms, ...developers, ...publishers])
  const description = entity?.descriptions?.ru?.value || entity?.descriptions?.en?.value || ''
  const imageName = getWikidataClaimValues(entity, 'P18').map((item) => String(item || '').trim()).find(Boolean) || ''

  return {
    id: entity.id,
    source: 'wikidata',
    labelRu,
    labelEn,
    aliases: appendUnique(aliasesRu, aliasesEn),
    description,
    year: years.length ? years[0] : null,
    releaseDate: isoDate,
    genres: uniqueStrings(genres.map((id) => labels[id] || '')).slice(0, 10),
    platforms: uniqueStrings(platforms.map((id) => labels[id] || '')).slice(0, 10),
    developers: uniqueStrings(developers.map((id) => labels[id] || '')).slice(0, 8),
    publishers: uniqueStrings(publishers.map((id) => labels[id] || '')).slice(0, 8),
    posterUrl: wikidataImageUrl(imageName),
  }
}

const fetchWikipediaSearch = async (lang, query) => {
  const key = `${lang}:${String(query || '').trim()}`
  if (!query) return []
  if (wikipediaSearchCache.has(key)) return wikipediaSearchCache.get(key)

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    list: 'search',
    srlimit: '5',
    srsearch: query,
    origin: '*',
  })
  const url = `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`
  try {
    const payload = await fetchJsonWithRetry(url, 2, 140)
    const list = Array.isArray(payload?.query?.search) ? payload.query.search : []
    wikipediaSearchCache.set(key, list)
    return list
  } catch {
    wikipediaSearchCache.set(key, [])
    return []
  }
}

const fetchWikipediaSummary = async (lang, title) => {
  const key = `${lang}:${title}`
  if (!title) return null
  if (wikipediaSummaryCache.has(key)) return wikipediaSummaryCache.get(key)

  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  try {
    const payload = await fetchJsonWithRetry(url, 2, 140)
    wikipediaSummaryCache.set(key, payload)
    return payload
  } catch {
    wikipediaSummaryCache.set(key, null)
    return null
  }
}

const enrichWithWikipedia = async (game, queries) => {
  const seedNorm = normalizeName(game.titleOriginal || game.titleRu)
  const seedCanon = stripEditionSuffixes(seedNorm)
  const seedTokens = tokenize(seedCanon)
  const candidates = []

  for (const query of queries) {
    for (const lang of WIKIPEDIA_LANGS) {
      const rows = await fetchWikipediaSearch(lang, query)
      for (const row of rows.slice(0, 3)) {
        const title = String(row?.title || '').trim()
        if (!title) continue
        const summary = await fetchWikipediaSummary(lang, title)
        if (!summary) continue

        const titleNorm = normalizeName(title)
        const canonical = stripEditionSuffixes(titleNorm)
        const nameScore = nameSimilarity(seedNorm, seedCanon, seedTokens, titleNorm, canonical, tokenize(canonical))
        const extract = String(summary.extract || '').trim()
        const descriptionBonus = extract ? 0.04 : 0
        const score = Math.min(1, nameScore + descriptionBonus)

        candidates.push({
          source: 'wikipedia',
          score,
          nameScore,
          title,
          lang,
          description: extract,
          posterUrl: summary?.thumbnail?.source || '',
          wikidataId: typeof summary?.wikibase_item === 'string' ? summary.wikibase_item : '',
        })
      }
    }
  }

  if (!candidates.length) {
    return null
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (best.nameScore < 0.5) return null

  if (best.wikidataId && /^Q\d+$/.test(best.wikidataId)) {
    const entity = await fetchWikidataEntity(best.wikidataId)
    const mapped = await mapWikidataEntity(entity)
    if (mapped) {
      return {
        ...mapped,
        source: 'wikipedia+wikidata',
        description: mapped.description || best.description,
        posterUrl: mapped.posterUrl || best.posterUrl,
        score: best.score,
      }
    }
  }

  return {
    id: best.wikidataId || '',
    source: 'wikipedia',
    labelRu: best.lang === 'ru' ? best.title : '',
    labelEn: best.lang === 'en' ? best.title : '',
    aliases: [],
    description: best.description,
    year: null,
    releaseDate: null,
    genres: [],
    platforms: [],
    developers: [],
    publishers: [],
    posterUrl: best.posterUrl,
    score: best.score,
  }
}

const scoreWikidataCandidate = (seed, candidate) => {
  const seedNorm = normalizeName(seed.name)
  const seedCanon = stripEditionSuffixes(seedNorm)
  const seedTokens = tokenize(seedCanon)
  const names = uniqueStrings([candidate.labelRu, candidate.labelEn, ...candidate.aliases])
  const nameScore = names.length
    ? Math.max(...names.map((name) => {
      const norm = normalizeName(name)
      return nameSimilarity(seedNorm, seedCanon, seedTokens, norm, stripEditionSuffixes(norm), tokenize(stripEditionSuffixes(norm)))
    }))
    : 0
  const yScore = yearScore(seed.year, candidate.year)
  return {
    nameScore,
    yearScore: yScore,
    total: nameScore * 0.82 + yScore * 0.18,
  }
}

const enrichWithWikidata = async (game) => {
  const querySeeds = uniqueStrings([game.titleOriginal, game.titleRu])
  const queries = uniqueStrings(querySeeds.flatMap((title) => {
    const value = String(title || '').trim()
    if (!value) return []
    const withoutParens = value.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
    const beforeColon = withoutParens.includes(':') ? withoutParens.split(':')[0].trim() : ''
    const beforeDash = withoutParens.includes('-') ? withoutParens.split('-')[0].trim() : ''
    return [value, withoutParens, beforeColon, beforeDash].filter(Boolean)
  }))
  let candidates = []
  for (const query of queries) {
    const list = await fetchWikidataSearch(query)
    candidates = appendUnique(candidates, list.map((item) => item.id).filter(Boolean))
  }

  if (!candidates.length) return null

  const mapped = []
  for (const id of candidates.slice(0, 8)) {
    const entity = await fetchWikidataEntity(id)
    const item = await mapWikidataEntity(entity)
    if (!item) continue
    const scored = scoreWikidataCandidate({ name: game.titleOriginal || game.titleRu, year: game.year }, item)
    mapped.push({ ...item, ...scored, score: scored.total })
  }

  mapped.sort((a, b) => b.score - a.score)
  const best = mapped[0]
  if (!best) return null
  const second = mapped[1]

  const weakAmbiguous = Boolean(second && Math.abs(best.score - second.score) <= 0.04 && best.nameScore < 0.58)
  const accepted = (
    best.nameScore >= 0.72
    || best.score >= 0.5
    || (best.nameScore >= 0.55 && (best.yearScore >= 0.45 || !game.year))
    || (best.nameScore >= 0.5 && (best.description || best.genres.length > 0 || best.platforms.length > 0))
  ) && !weakAmbiguous

  if (!accepted) {
    return enrichWithWikipedia(game, queries)
  }

  return best
}

const applyWikidataData = (game, wiki) => {
  if (!wiki) return false
  let changed = false

  const fillScalar = (key, value) => {
    if (value === undefined || value === null || value === '') return
    if (game[key]) return
    game[key] = value
    changed = true
  }

  const fillList = (key, values, limit = 12) => {
    if (!Array.isArray(values) || !values.length) return
    if (Array.isArray(game[key]) && game[key].length > 0) return
    game[key] = uniqueStrings(values).slice(0, limit)
    changed = true
  }

  fillScalar('releaseDate', wiki.releaseDate)
  fillScalar('year', wiki.year)
  fillScalar('posterUrl', wiki.posterUrl)
  fillScalar('description', wiki.description)
  fillScalar('shortDescription', wiki.description)
  fillScalar('plotHint', wiki.description)

  fillList('alternativeTitles', appendUnique(game.alternativeTitles, [wiki.labelEn, wiki.labelRu, ...wiki.aliases]), 8)
  fillList('genres', wiki.genres, 10)
  fillList('platforms', wiki.platforms, 10)
  fillList('developers', wiki.developers, 8)
  fillList('publishers', wiki.publishers, 8)

  if (changed) {
    game.notes = appendUnique(game.notes, ['external_enriched'])
    game.dataQuality = game.dataQuality ?? { source: [], verified: false, missingFields: [] }
    game.dataQuality.source = appendUnique(game.dataQuality.source, [wiki.source || 'wikidata'])
  }

  return changed
}

const refreshGameQuality = (game) => {
  const missing = []
  if (!game.description && !game.shortDescription) missing.push('description')
  if (!game.genres?.length) missing.push('genres')
  if (!game.platforms?.length) missing.push('platforms')
  if (!game.developers?.length && !game.publishers?.length) missing.push('developers_or_publishers')
  if (!game.posterUrl && !game.backdropUrl) missing.push('poster_or_backdrop')

  game.dataQuality = game.dataQuality ?? { source: [], verified: false, missingFields: [] }
  game.dataQuality.missingFields = missing
  game.dataQuality.verified = missing.length === 0
}

const detailCache = new Map()
const reviewsCache = new Map()
const headCache = new Map()
let steamReviewsUnavailable = false

const readAppDetailsPayload = (payload, appid) => {
  const key = String(appid)
  const raw = payload?.[key]
  if (!raw?.success) return null
  return raw.data ?? null
}

const parseReleaseDate = (text) => {
  const raw = String(text || '').trim()
  if (!raw) return { year: null, iso: null }

  const normalized = raw
    .toLowerCase()
    .replace(/г\./g, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const yearMatch = normalized.match(/(19\d{2}|20\d{2})/)
  const year = yearMatch ? Number(yearMatch[1]) : null

  const monthMap = {
    jan: 1, january: 1, 'янв': 1, 'января': 1,
    feb: 2, february: 2, 'фев': 2, 'февраля': 2,
    mar: 3, march: 3, 'мар': 3, 'марта': 3,
    apr: 4, april: 4, 'апр': 4, 'апреля': 4,
    may: 5, 'мая': 5,
    jun: 6, june: 6, 'июн': 6, 'июня': 6,
    jul: 7, july: 7, 'июл': 7, 'июля': 7,
    aug: 8, august: 8, 'авг': 8, 'августа': 8,
    sep: 9, sept: 9, september: 9, 'сен': 9, 'сент': 9, 'сентября': 9,
    oct: 10, october: 10, 'окт': 10, 'октября': 10,
    nov: 11, november: 11, 'ноя': 11, 'ноября': 11,
    dec: 12, december: 12, 'дек': 12, 'декабря': 12,
  }

  const dayMatch = normalized.match(/\b([0-3]?\d)\b/)
  const monthKey = Object.keys(monthMap).find((key) => normalized.includes(key))
  const month = monthKey ? monthMap[monthKey] : null
  const day = dayMatch ? Number(dayMatch[1]) : null

  let iso = null
  if (year && month && day) {
    iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return { year, iso }
}

const parseSupportedLanguages = (supportedLanguagesHtml) => {
  const plain = stripHtml(supportedLanguagesHtml)
    .replace(/\*+/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/full audio|subtitles|interface/gi, ' ')
    .replace(/languages with full audio support/gi, ' ')
    .replace(/available languages/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!plain) return []
  return [...new Set(plain.split(/[,;/|]/).map((chunk) => chunk.trim()).filter(Boolean))].slice(0, 20)
}

const fetchAppDetails = async (appid) => {
  if (detailCache.has(appid)) return detailCache.get(appid)

  const ruUrl = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=russian&cc=ru`
  const enUrl = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=us`

  let ruPayload
  try {
    ruPayload = await fetchJsonWithRetry(ruUrl, 3, 180)
  } catch {
    detailCache.set(appid, null)
    return null
  }

  const ruData = readAppDetailsPayload(ruPayload, appid)
  if (!ruData) {
    detailCache.set(appid, null)
    return null
  }

  const needsEnglish = !stripHtml(ruData.short_description || '') || !stripHtml(ruData.detailed_description || '')
  let enData = null
  if (needsEnglish) {
    try {
      const enPayload = await fetchJsonWithRetry(enUrl, 2, 150)
      enData = readAppDetailsPayload(enPayload, appid)
    } catch {
      enData = null
    }
  }

  const merged = {
    appid,
    type: ruData.type || enData?.type || null,
    nameRu: stripHtml(ruData.name || ''),
    nameEn: stripHtml(enData?.name || ruData.name || ''),
    steamName: stripHtml(ruData.name || enData?.name || ''),
    headerImage: ruData.header_image || enData?.header_image || '',
    background: ruData.background || enData?.background || '',
    backgroundRaw: ruData.background_raw || enData?.background_raw || '',
    screenshots: Array.isArray(ruData.screenshots) ? ruData.screenshots : (Array.isArray(enData?.screenshots) ? enData.screenshots : []),
    genres: Array.isArray(ruData.genres) ? ruData.genres : (Array.isArray(enData?.genres) ? enData.genres : []),
    categories: Array.isArray(ruData.categories) ? ruData.categories : (Array.isArray(enData?.categories) ? enData.categories : []),
    developers: Array.isArray(ruData.developers) ? ruData.developers : (Array.isArray(enData?.developers) ? enData.developers : []),
    publishers: Array.isArray(ruData.publishers) ? ruData.publishers : (Array.isArray(enData?.publishers) ? enData.publishers : []),
    platforms: ruData.platforms || enData?.platforms || {},
    requiredAge: ruData.required_age ?? enData?.required_age ?? null,
    metacritic: ruData.metacritic?.score ?? enData?.metacritic?.score ?? null,
    recommendationsTotal: Number(ruData.recommendations?.total ?? enData?.recommendations?.total ?? 0),
    isFree: Boolean(ruData.is_free ?? enData?.is_free ?? false),
    priceOverview: ruData.price_overview || enData?.price_overview || null,
    shortDescription: stripHtml(ruData.short_description || enData?.short_description || ''),
    detailedDescription: stripHtml(ruData.detailed_description || enData?.detailed_description || ''),
    supportedLanguages: parseSupportedLanguages(ruData.supported_languages || enData?.supported_languages || ''),
    releaseDateRaw: ruData.release_date?.date || enData?.release_date?.date || '',
  }

  const release = parseReleaseDate(merged.releaseDateRaw)
  merged.releaseYear = release.year
  merged.releaseDateIso = release.iso
  merged.detailsQuality = Number(Boolean(merged.headerImage && (merged.detailedDescription || merged.shortDescription) && merged.genres.length > 0))
  merged.nameNormalized = normalizeName(merged.steamName)
  merged.nameCanonical = stripEditionSuffixes(merged.nameNormalized)
  merged.nameTokens = tokenize(merged.nameCanonical)

  detailCache.set(appid, merged)
  return merged
}

const fetchReviews = async (appid) => {
  if (reviewsCache.has(appid)) return reviewsCache.get(appid)

  const urls = [
    `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=1&filter=summary`,
    `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=20&filter=summary`,
  ]

  try {
    let payload = null
    for (const url of urls) {
      try {
        payload = await fetchJsonWithRetry(url, 2, 140)
        if (payload?.query_summary) break
      } catch {
        payload = null
      }
    }

    const summary = payload?.query_summary ?? {}
    const totalPositive = Number(summary.total_positive ?? 0)
    const totalNegative = Number(summary.total_negative ?? 0)
    const totalReviews = Number(summary.total_reviews ?? totalPositive + totalNegative)
    const positivePercent = totalReviews > 0 ? Math.round((totalPositive / totalReviews) * 1000) / 10 : null
    const result = { totalReviews, totalPositive, totalNegative, positivePercent }

    reviewsCache.set(appid, result)
    return result
  } catch (error) {
    const text = String(error?.message || error || '')
    if (/HTTP 403|Access Denied|not valid JSON/i.test(text)) steamReviewsUnavailable = true

    const empty = {
      totalReviews: 0,
      totalPositive: 0,
      totalNegative: 0,
      positivePercent: null,
    }
    reviewsCache.set(appid, empty)
    return empty
  }
}

const checkHead = async (url) => {
  if (!url) return false
  if (headCache.has(url)) return headCache.get(url)

  const attempt = async (method) => {
    const response = await fetch(url, {
      method,
      headers: { 'User-Agent': 'Shoditsa-Steam-Importer/1.0' },
    })
    return response.ok
  }

  let ok = false
  try {
    ok = await attempt('HEAD')
  } catch {
    ok = false
  }

  if (!ok) {
    try {
      ok = await attempt('GET')
    } catch {
      ok = false
    }
  }

  headCache.set(url, ok)
  return ok
}

const yearScore = (seedYear, releaseYear) => {
  if (!seedYear || !releaseYear) return 0
  const diff = Math.abs(seedYear - releaseYear)
  if (diff === 0) return 1
  if (diff === 1) return 0.9
  if (diff === 2) return 0.8
  if (diff <= 4) return 0.45
  if (diff <= 7) return 0.2
  return 0
}

const isLikelyEditionMatch = (seedName, steamName) => {
  const seed = normalizeName(seedName)
  const steam = normalizeName(steamName)
  if (!seed || !steam) return false
  const canonicalSeed = stripEditionSuffixes(seed)
  const canonicalSteam = stripEditionSuffixes(steam)
  if (!canonicalSeed || !canonicalSteam) return false
  if (!canonicalSteam.includes(canonicalSeed) && !canonicalSeed.includes(canonicalSteam)) return false
  return REMASTER_KEYWORDS.some((keyword) => steam.includes(keyword))
}

const buildSearchIndexes = (steamRecords) => {
  const tokenToIndices = new Map()
  const normalizedToIndices = new Map()
  const prefixToIndices = new Map()

  for (const item of steamRecords) {
    if (!normalizedToIndices.has(item.normalized)) normalizedToIndices.set(item.normalized, [])
    normalizedToIndices.get(item.normalized).push(item.idx)

    const prefix = item.canonical.slice(0, 8)
    if (prefix) {
      if (!prefixToIndices.has(prefix)) prefixToIndices.set(prefix, [])
      prefixToIndices.get(prefix).push(item.idx)
    }

    for (const token of item.tokens) {
      if (!tokenToIndices.has(token)) tokenToIndices.set(token, [])
      tokenToIndices.get(token).push(item.idx)
    }
  }

  return { tokenToIndices, normalizedToIndices, prefixToIndices }
}

const getCandidateIndices = (seed, indexes, steamRecords) => {
  const normalized = normalizeName(seed.name)
  const canonical = stripEditionSuffixes(normalized)
  const tokens = tokenize(canonical)
  const candidates = new Set()

  const exact = indexes.normalizedToIndices.get(normalized) ?? []
  for (const idx of exact) candidates.add(idx)

  const rankedTokens = tokens
    .map((token) => ({ token, freq: indexes.tokenToIndices.get(token)?.length ?? 0 }))
    .filter((entry) => entry.freq > 0)
    .sort((a, b) => a.freq - b.freq)

  for (const entry of rankedTokens.slice(0, 4)) {
    const fromToken = indexes.tokenToIndices.get(entry.token) ?? []
    for (const idx of fromToken.slice(0, 8000)) candidates.add(idx)
  }

  const prefix = canonical.slice(0, 8)
  const fromPrefix = indexes.prefixToIndices.get(prefix) ?? []
  for (const idx of fromPrefix.slice(0, 3000)) candidates.add(idx)

  if (candidates.size < 40) {
    for (let i = 0; i < steamRecords.length; i += 1) {
      const item = steamRecords[i]
      if (item.canonical.includes(canonical) || canonical.includes(item.canonical)) candidates.add(item.idx)
      if (candidates.size >= 4000) break
    }
  }

  return {
    normalized,
    canonical,
    tokens,
    candidateIndices: [...candidates],
  }
}

const buildFranchiseKey = (title) => {
  for (const item of FRANCHISE_PATTERNS) {
    if (item.regex.test(title)) return item.key
  }
  return null
}

const isJunkGame = (game, details, options = {}) => {
  const skipReviewFloor = Boolean(options.skipReviewFloor)
  if (!details || details.type !== 'game') return 'not_game_type'

  const loweredName = normalizeName(details.steamName)
  const loweredDesc = normalizeName(details.shortDescription || details.detailedDescription || '')
  const haystack = `${loweredName} ${loweredDesc}`
  for (const keyword of EXCLUDE_KEYWORDS) {
    if (haystack.includes(keyword)) return `keyword:${keyword}`
  }

  if (!details.detailedDescription && !details.shortDescription) return 'missing_description'
  if (!Array.isArray(details.genres) || !details.genres.length) return 'missing_genres'

  if (!game.headerUrl) return 'missing_header'

  if (!skipReviewFloor) {
    const totalReviews = game.votes?.steamReviews ?? 0
    const rank = game.externalRanks?.playThatGame ?? 99999
    if (totalReviews < 1000 && rank > HIGH_RANK_REVIEW_EXCEPTION) return 'low_reviews'
  }

  return null
}

const scaleByMinMax = (value, min, max) => {
  if (!Number.isFinite(value)) return 0
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

const computeDataCompleteness = (game) => {
  const checks = [
    Boolean(game.posterUrl),
    Boolean(game.backdropUrl),
    Array.isArray(game.screenshots) && game.screenshots.length > 0,
    Array.isArray(game.genres) && game.genres.length > 0,
    Array.isArray(game.steamCategories) && game.steamCategories.length > 0,
    Array.isArray(game.steamTags) && game.steamTags.length > 0,
  ]
  const good = checks.filter(Boolean).length
  return checks.length ? good / checks.length : 0
}

const dedupeStrings = (items) => [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))]

const setIntersectionCount = (left, right) => {
  const leftSet = new Set(left)
  let count = 0
  for (const token of right) if (leftSet.has(token)) count += 1
  return count
}

const createSeedFallbackGame = (seed, topRank, totalSeeds) => {
  const popularity = totalSeeds > 1
    ? Math.max(1, Math.min(100, Math.round((1 - (seed.rank - 1) / (totalSeeds - 1)) * 100)))
    : 100

  return {
    id: `ptg_${seed.rank}`,
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
    topRank,
    popularityScore: popularity,
    externalRanks: {
      playThatGame: seed.rank,
    },
    plotHint: '',
    notes: ['not_found_in_steam'],
    dataQuality: {
      source: ['play_that_game_seed_list'],
      verified: false,
      missingFields: [
        'steamAppId',
        'headerUrl',
        'posterUrl',
        'backdropUrl',
        'description',
        'genres',
      ],
    },
  }
}

const main = async () => {
  await readEnvFileIfExists(resolve(root, '.env'))
  await readEnvFileIfExists(resolve(root, '.env.local'))

  console.log('Loading Play That Game seed list...')
  const seedRows = await loadSeedList()
  console.log(`Seed rows: ${seedRows.length}`)

  const steamKey = getSteamKey()
  console.log('Loading Steam app list...')
  const appList = await fetchSteamAppList(steamKey)
  console.log(`Steam app list rows: ${appList.length}`)

  const steamRecordsRaw = appList
    .map((entry, idx) => toSteamRecord(entry, idx))
    .filter(Boolean)

  const steamRecords = steamRecordsRaw.map((item, idx) => ({ ...item, idx }))

  const indexes = buildSearchIndexes(steamRecords)

  const seedCandidates = []

  console.log('Building candidate matches...')
  for (const seed of seedRows) {
    const { normalized, canonical, tokens, candidateIndices } = getCandidateIndices(seed, indexes, steamRecords)
    if (!candidateIndices.length) {
      seedCandidates.push({ seed, normalized, canonical, tokens, candidates: [] })
      continue
    }

    const scored = candidateIndices
      .map((idx) => {
        const record = steamRecords[idx]
        return {
          appid: record.appid,
          steamName: record.name,
          nameScore: nameSimilarity(normalized, canonical, tokens, record.normalized, record.canonical, record.tokens),
        }
      })
      .sort((a, b) => b.nameScore - a.nameScore)
      .slice(0, 10)

    seedCandidates.push({ seed, normalized, canonical, tokens, candidates: scored })
  }

  const preloadCandidateAppIds = [...new Set(seedCandidates.flatMap((row) => row.candidates.map((candidate) => candidate.appid)))]
  console.log(`Preloading appdetails for match candidates: ${preloadCandidateAppIds.length}`)
  let preloadDone = 0
  await mapWithConcurrency(preloadCandidateAppIds, 14, async (appid) => {
    await fetchAppDetails(appid)
    preloadDone += 1
    if (preloadDone % 250 === 0 || preloadDone === preloadCandidateAppIds.length) {
      console.log(`appdetails preload: ${preloadDone}/${preloadCandidateAppIds.length}`)
    }
  })

  const matched = []
  const notFound = []
  const ambiguousMatches = []

  console.log('Resolving best matches with year/details score...')
  const resolved = await mapWithConcurrency(seedCandidates, 18, async (row, index) => {
    if (!row.candidates.length) {
      return {
        kind: 'not_found',
        payload: { rank: row.seed.rank, name: row.seed.name, year: row.seed.year, reason: 'no_candidates' },
      }
    }

    const detailedCandidates = []
    for (const candidate of row.candidates) {
      const details = detailCache.get(candidate.appid) ?? null
      if (!details || details.type !== 'game') continue

      const yScore = yearScore(row.seed.year, details.releaseYear ?? null)
      const dScore = details.detailsQuality ?? 0
      const popularityHint = Math.min(1, Math.log10(Math.max(1, details.recommendationsTotal || 0) + 1) / 6)
      const metacriticHint = Number.isFinite(Number(details.metacritic)) && Number(details.metacritic) > 0
        ? Math.min(1, Number(details.metacritic) / 100)
        : 0
      const overlap = row.tokens.length
        ? setIntersectionCount(row.tokens, details.nameTokens || []) / row.tokens.length
        : 0
      const finalScore = candidate.nameScore * 0.52 + yScore * 0.14 + dScore * 0.11 + popularityHint * 0.19 + metacriticHint * 0.04

      detailedCandidates.push({
        ...candidate,
        releaseYear: details.releaseYear ?? null,
        detailsQuality: dScore,
        yearScore: yScore,
        popularityHint,
        metacriticHint,
        overlap,
        finalScore,
        details,
      })
    }

    if (!detailedCandidates.length) {
      return {
        kind: 'not_found',
        payload: { rank: row.seed.rank, name: row.seed.name, year: row.seed.year, reason: 'no_valid_appdetails' },
      }
    }

    detailedCandidates.sort((a, b) => b.finalScore - a.finalScore)
    const best = detailedCandidates[0]
    const second = detailedCandidates[1]

    const accepted = (
      best.nameScore >= 0.93
      || (
        best.nameScore >= 0.82
        && (best.yearScore >= 0.45 || best.popularityHint >= 0.16 || best.metacriticHint >= 0.75)
      )
      || (
        best.nameScore >= 0.72
        && best.yearScore >= 0.8
        && (best.popularityHint >= 0.18 || best.metacriticHint >= 0.7)
      )
      || (
        best.finalScore >= 0.6
        && best.nameScore >= 0.58
      )
    )

    if (!accepted) {
      return {
        kind: 'not_found',
        payload: {
          rank: row.seed.rank,
          name: row.seed.name,
          year: row.seed.year,
          reason: 'low_confidence',
          bestCandidate: {
            appid: best.appid,
            steamName: best.steamName,
            finalScore: Number(best.finalScore.toFixed(4)),
            nameScore: Number(best.nameScore.toFixed(4)),
            releaseYear: best.releaseYear,
          },
        },
      }
    }

    const notes = []
    if (isLikelyEditionMatch(row.seed.name, best.steamName)) notes.push('steam_version_remaster_or_re-release_used')

    const payload = {
      seed: row.seed,
      appid: best.appid,
      steamName: best.steamName,
      matchScore: Number(best.finalScore.toFixed(6)),
      nameScore: Number(best.nameScore.toFixed(6)),
      yearScore: Number(best.yearScore.toFixed(6)),
      detailsScore: Number(best.detailsQuality.toFixed(6)),
      popularityHint: Number(best.popularityHint.toFixed(6)),
      notes,
    }

    const ambiguous = (
      second
      && second.finalScore >= best.finalScore - 0.045
      && second.finalScore >= 0.62
    )
      ? {
        seed: row.seed,
        chosen: {
          appid: best.appid,
          steamName: best.steamName,
          finalScore: Number(best.finalScore.toFixed(4)),
        },
        alternative: {
          appid: second.appid,
          steamName: second.steamName,
          finalScore: Number(second.finalScore.toFixed(4)),
        },
      }
      : null

    if ((index + 1) % 120 === 0 || index + 1 === seedCandidates.length) {
      console.log(`match resolve: ${index + 1}/${seedCandidates.length}`)
    }

    return { kind: 'matched', payload, ambiguous }
  })

  for (const item of resolved) {
    if (!item) continue
    if (item.kind === 'matched') {
      matched.push(item.payload)
      if (item.ambiguous) ambiguousMatches.push(item.ambiguous)
      continue
    }
    notFound.push(item.payload)
  }

  const bestByAppId = new Map()
  for (const item of matched) {
    const existing = bestByAppId.get(item.appid)
    if (!existing) {
      bestByAppId.set(item.appid, item)
      continue
    }
    const better = item.matchScore > existing.matchScore + 0.015
      || (Math.abs(item.matchScore - existing.matchScore) <= 0.015 && item.seed.rank < existing.seed.rank)
    if (better) bestByAppId.set(item.appid, item)
  }

  const uniqueMatches = [...bestByAppId.values()]
    .sort((a, b) => a.seed.rank - b.seed.rank || b.matchScore - a.matchScore)

  const targetCount = includeAllFromSeed ? seedRows.length : BASE_TARGET_COUNT
  const enrichPool = includeAllFromSeed
    ? matched.slice().sort((a, b) => a.seed.rank - b.seed.rank)
    : uniqueMatches.slice(0, Math.max(targetCount + 450, 900))
  console.log(`Enriching ${enrichPool.length} matched entries...`)

  const rejected = []
  const enriched = []

  let enrichDone = 0
  await mapWithConcurrency(enrichPool, 8, async (item) => {
    const details = detailCache.get(item.appid) ?? await fetchAppDetails(item.appid)
    if (!details) {
      rejected.push({ appid: item.appid, seedRank: item.seed.rank, title: item.seed.name, reason: 'missing_appdetails' })
      enrichDone += 1
      return
    }

    const reviews = await fetchReviews(item.appid)
    const reviewTotal = reviews.totalReviews > 0 ? reviews.totalReviews : Math.max(0, Number(details.recommendationsTotal ?? 0))

    const cdnHeader = `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/header.jpg`
    const cdnPoster = `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/library_600x900.jpg`
    const cdnBackdrop = `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/library_hero.jpg`

    const hasHeader = await checkHead(cdnHeader)
    const headerUrl = hasHeader ? cdnHeader : (details.headerImage || '')

    let posterUrl = ''
    if (await checkHead(cdnPoster)) {
      posterUrl = cdnPoster
    } else if (details.headerImage) {
      posterUrl = details.headerImage
    }

    let backdropUrl = ''
    if (await checkHead(cdnBackdrop)) {
      backdropUrl = cdnBackdrop
    } else if (details.backgroundRaw) {
      backdropUrl = details.backgroundRaw
    } else if (details.background) {
      backdropUrl = details.background
    }

    const genres = dedupeStrings(details.genres.map((entry) => stripHtml(entry.description || entry)))
    const steamCategories = dedupeStrings(details.categories.map((entry) => stripHtml(entry.description || entry)))
    const steamTags = dedupeStrings([...genres, ...steamCategories]).slice(0, 20)
    const screenshots = dedupeStrings((details.screenshots || []).map((entry) => entry.path_full || entry.path_thumbnail || '')).slice(0, 12)

    const titleRu = details.nameRu || details.steamName || item.seed.name
    const titleOriginal = details.nameEn || details.steamName || item.seed.name
    const alternativeTitles = dedupeStrings([
      item.seed.name,
      details.steamName,
      details.nameEn,
      details.nameRu,
    ]).filter((title) => title !== titleRu)

    const game = {
      id: `steam_${item.appid}`,
      mode: 'game',
      titleRu,
      titleOriginal,
      alternativeTitles,
      year: details.releaseYear || item.seed.year,
      releaseDate: details.releaseDateIso || null,
      developers: dedupeStrings(details.developers || []),
      publishers: dedupeStrings(details.publishers || []),
      platforms: Object.entries(details.platforms || {}).filter(([, enabled]) => Boolean(enabled)).map(([name]) => name),
      genres,
      steamCategories,
      steamTags,
      supportedLanguages: dedupeStrings(details.supportedLanguages || []),
      ageRating: Number(details.requiredAge) > 0 ? `${Number(details.requiredAge)}+` : null,
      metacritic: Number.isFinite(Number(details.metacritic)) ? Number(details.metacritic) : null,
      ratings: {
        steamPositivePercent: reviews.positivePercent,
        metacritic: Number.isFinite(Number(details.metacritic)) ? Number(details.metacritic) : null,
      },
      votes: {
        steamReviews: reviewTotal,
        steamPositive: reviews.totalPositive,
        steamNegative: reviews.totalNegative,
      },
      price: {
        isFree: details.isFree,
        currency: details.priceOverview?.currency ?? null,
        initial: Number.isFinite(Number(details.priceOverview?.initial)) ? Number(details.priceOverview.initial) : null,
        final: Number.isFinite(Number(details.priceOverview?.final)) ? Number(details.priceOverview.final) : null,
        discountPercent: Number.isFinite(Number(details.priceOverview?.discount_percent)) ? Number(details.priceOverview.discount_percent) : 0,
      },
      steamAppId: item.appid,
      steamUrl: `https://store.steampowered.com/app/${item.appid}/`,
      posterUrl,
      headerUrl,
      backdropUrl,
      screenshots,
      description: details.detailedDescription || details.shortDescription || '',
      shortDescription: details.shortDescription || '',
      topRank: null,
      popularityScore: 0,
      externalRanks: {
        playThatGame: item.seed.rank,
      },
      plotHint: buildPlotHint({ title: titleOriginal || titleRu, text: details.shortDescription || details.detailedDescription || '' }),
      notes: item.notes,
      dataQuality: {
        source: [
          'play_that_game_seed_list',
          'steam_store_appdetails',
          'steam_reviews',
          'steam_cdn_assets',
        ],
        verified: true,
        missingFields: [],
      },
    }

    const missingFields = []
    if (!game.posterUrl) missingFields.push('posterUrl')
    if (!game.backdropUrl) missingFields.push('backdropUrl')
    if (!game.screenshots.length) missingFields.push('screenshots')
    if (!game.genres.length) missingFields.push('genres')
    if (!game.steamCategories.length) missingFields.push('steamCategories')
    if (!game.steamTags.length) missingFields.push('steamTags')
    game.dataQuality.missingFields = missingFields

    const rejectionReason = isJunkGame(game, details, { skipReviewFloor: steamReviewsUnavailable })
    if (rejectionReason) {
      rejected.push({
        appid: item.appid,
        seedRank: item.seed.rank,
        title: item.seed.name,
        steamName: details.steamName,
        reason: rejectionReason,
      })
      enrichDone += 1
      if (enrichDone % 80 === 0 || enrichDone === enrichPool.length) {
        console.log(`enrich progress: ${enrichDone}/${enrichPool.length}`)
      }
      return
    }

    enriched.push(game)
    enrichDone += 1
    if (enrichDone % 80 === 0 || enrichDone === enrichPool.length) {
      console.log(`enrich progress: ${enrichDone}/${enrichPool.length}`)
    }
  })

  const logReviewValues = enriched.map((game) => Math.log10(Math.max(1, game.votes.steamReviews)))
  const minReview = logReviewValues.length ? Math.min(...logReviewValues) : 0
  const maxReview = logReviewValues.length ? Math.max(...logReviewValues) : 1
  const maxSeedRank = seedRows.length ? Math.max(...seedRows.map((item) => item.rank)) : 1

  const scored = enriched
    .map((game) => {
      const rankScore = maxSeedRank > 1 ? 1 - (game.externalRanks.playThatGame - 1) / (maxSeedRank - 1) : 1
      const reviewScore = scaleByMinMax(Math.log10(Math.max(1, game.votes.steamReviews)), minReview, maxReview)
      const positiveScore = Number.isFinite(game.ratings.steamPositivePercent) ? game.ratings.steamPositivePercent / 100 : 0
      const completenessScore = computeDataCompleteness(game)

      const finalScore = rankScore * 0.5 + reviewScore * 0.25 + positiveScore * 0.15 + completenessScore * 0.1
      return {
        game,
        rankScore,
        reviewScore,
        positiveScore,
        completenessScore,
        finalScore,
      }
    })
    .sort((a, b) => b.finalScore - a.finalScore)

  let generated = []

  if (includeAllFromSeed) {
    const bySeedRank = new Map()
    for (const entry of scored) {
      const rank = entry.game.externalRanks.playThatGame
      if (!bySeedRank.has(rank)) bySeedRank.set(rank, entry)
    }

    generated = seedRows
      .sort((a, b) => a.rank - b.rank)
      .map((seed, index) => {
        const entry = bySeedRank.get(seed.rank)
        if (!entry) return createSeedFallbackGame(seed, index + 1, seedRows.length)

        const game = entry.game
        game.topRank = index + 1
        game.popularityScore = Math.max(1, Math.min(100, Math.round(entry.finalScore * 100)))
        return game
      })
  } else {
    const finalList = []
    const overflowByFranchise = []
    const franchiseCounters = new Map()

    for (const entry of scored) {
      if (finalList.length >= targetCount) break
      const titleForFranchise = `${entry.game.titleOriginal} ${entry.game.titleRu}`
      const franchise = buildFranchiseKey(titleForFranchise)
      if (franchise) {
        const used = franchiseCounters.get(franchise) ?? 0
        if (used >= FRANCHISE_LIMIT) {
          overflowByFranchise.push(entry)
          continue
        }
        franchiseCounters.set(franchise, used + 1)
      }
      finalList.push(entry)
    }

    for (const entry of overflowByFranchise) {
      if (finalList.length >= targetCount) break
      finalList.push(entry)
    }

    const trimmed = finalList.slice(0, targetCount)
    generated = trimmed.map((entry, index) => {
      const game = entry.game
      game.topRank = index + 1
      game.popularityScore = Math.max(1, Math.min(100, Math.round(entry.finalScore * 100)))
      return game
    })
  }

  const manualOverrides = await loadManualOverrides()
  let wikidataEnrichedCount = 0
  let manualOverridesAppliedCount = 0

  const nonSteamGames = generated.filter((game) => !game.steamAppId)
  console.log(`Enriching non-Steam entries via Wikidata/manual: ${nonSteamGames.length}`)

  let nonSteamDone = 0
  await mapWithConcurrency(nonSteamGames, 6, async (game) => {
    const override = getManualOverride(manualOverrides, game)
    let wikidataChanged = false

    const forceWikidataId = typeof override?.wikidataId === 'string' ? override.wikidataId.trim() : ''
    const skipWikidata = Boolean(override?.skipWikidata)

    if (!skipWikidata) {
      if (/^Q\d+$/.test(forceWikidataId)) {
        const entity = await fetchWikidataEntity(forceWikidataId)
        const mapped = await mapWikidataEntity(entity)
        if (mapped) wikidataChanged = applyWikidataData(game, mapped)
      } else {
        const mapped = await enrichWithWikidata(game)
        if (mapped) wikidataChanged = applyWikidataData(game, mapped)
      }
    }

    if (wikidataChanged) wikidataEnrichedCount += 1

    const overrideChanged = applyManualOverride(game, override)
    if (overrideChanged) manualOverridesAppliedCount += 1

    refreshGameQuality(game)

    nonSteamDone += 1
    if (nonSteamDone % 80 === 0 || nonSteamDone === nonSteamGames.length) {
      console.log(`non-steam enrich progress: ${nonSteamDone}/${nonSteamGames.length}`)
    }
  })

  for (const game of generated.filter((entry) => entry.steamAppId)) {
    refreshGameQuality(game)
  }

  const unresolvedGames = generated
    .filter((game) => !game.dataQuality?.verified)
    .map((game) => ({
      id: game.id,
      titleRu: game.titleRu,
      titleOriginal: game.titleOriginal,
      topRank: game.topRank,
      seedRank: game.externalRanks?.playThatGame ?? null,
      steamAppId: game.steamAppId,
      missingFields: game.dataQuality?.missingFields ?? [],
      notes: game.notes ?? [],
    }))

  const searchIndex = generated.map((game) => ({
    id: game.id,
    steamAppId: game.steamAppId,
    titleRu: game.titleRu,
    titleOriginal: game.titleOriginal,
    alternativeTitles: game.alternativeTitles,
    year: game.year,
  }))

  const noPosterCount = generated.filter((game) => !game.posterUrl).length
  const noBackdropCount = generated.filter((game) => !game.backdropUrl).length
  const verifiedCount = generated.filter((game) => game.dataQuality?.verified).length
  const withDescriptionCount = generated.filter((game) => Boolean(game.description || game.shortDescription)).length
  const withGenresCount = generated.filter((game) => Array.isArray(game.genres) && game.genres.length > 0).length
  const nonSteamVerifiedCount = generated.filter((game) => !game.steamAppId && game.dataQuality?.verified).length

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      playThatGameUrl: PLAY_THAT_GAME_URL,
      seedRawPath: SEED_RAW_PATH,
      manualFallbackPath: SEED_MANUAL_HTML_PATH,
      manualOverridesPath: MANUAL_OVERRIDES_PATH,
      targetCount,
      mode: includeAllFromSeed ? 'all_seed_entries' : 'top_targeted',
      steamReviewsUnavailable,
    },
    counts: {
      seedTotal: seedRows.length,
      matchedToSteam: matched.length,
      notFoundInSteam: notFound.length,
      rejectedAfterFilter: rejected.length,
      finalSelected: generated.length,
      withoutPosterUrl: noPosterCount,
      withoutBackdropUrl: noBackdropCount,
      withDescription: withDescriptionCount,
      withGenres: withGenresCount,
      verifiedCount,
      unresolvedCount: unresolvedGames.length,
      nonSteamVerified: nonSteamVerifiedCount,
      uniqueSteamMatchesBeforeFilter: uniqueMatches.length,
      ambiguousMatches: ambiguousMatches.length,
      wikidataEnriched: wikidataEnrichedCount,
      manualOverridesApplied: manualOverridesAppliedCount,
    },
    top50: generated.slice(0, 50).map((game) => ({
      topRank: game.topRank,
      id: game.id,
      steamAppId: game.steamAppId,
      titleRu: game.titleRu,
      titleOriginal: game.titleOriginal,
      playThatGameRank: game.externalRanks.playThatGame,
      steamReviews: game.votes.steamReviews,
      steamPositivePercent: game.ratings.steamPositivePercent,
      popularityScore: game.popularityScore,
    })),
    ambiguousMatches,
    samples: {
      notFoundTop50: notFound.slice(0, 50),
      rejectedTop100: rejected.slice(0, 100),
    },
  }

  await ensureDirForFile(GAMES_OUTPUT_PATH)
  await ensureDirForFile(INDEX_OUTPUT_PATH)
  await ensureDirForFile(REPORT_OUTPUT_PATH)
  await ensureDirForFile(UNRESOLVED_OUTPUT_PATH)

  await writeFile(GAMES_OUTPUT_PATH, `${JSON.stringify(generated, null, 2)}\n`, 'utf8')
  await writeFile(INDEX_OUTPUT_PATH, `${JSON.stringify(searchIndex, null, 2)}\n`, 'utf8')
  await writeFile(REPORT_OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(UNRESOLVED_OUTPUT_PATH, `${JSON.stringify(unresolvedGames, null, 2)}\n`, 'utf8')

  console.log('Done.')
  console.log(`Final games: ${generated.length}`)
  console.log(`Report: ${REPORT_OUTPUT_PATH}`)
  console.log(`Unresolved: ${UNRESOLVED_OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
