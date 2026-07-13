import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SOURCE_PRIORITY = ['musicbrainz', 'lastfm', 'wikidata', 'theaudiodb', 'spotify']
const MUSICBRAINZ_USER_AGENT = process.env.MUSICBRAINZ_USER_AGENT?.trim() || 'seans-starter-pack-music-enricher/1.0 (local-dev)'
const AUDIODB_DEMO_KEY = '2'
const SOCIAL_HOST_MARKERS = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'vk.com',
  't.me',
  'spotify.com',
]

let musicBrainzLastRequestAt = 0

const parseArgs = () => {
  const options = {
    input: 'archive/local/music-pipeline/source/music_artists_merged_dedup.json',
    limit: 10,
    runTag: null,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length).trim()
      continue
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10)
      if (Number.isFinite(parsed) && parsed > 0) options.limit = parsed
      continue
    }
    if (arg.startsWith('--run-tag=')) {
      const value = arg.slice('--run-tag='.length).trim()
      if (value) options.runTag = value
      continue
    }
  }

  return options
}

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true })
}

const writeJson = (filePath, value) => {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmpty = (value) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0
  if (isObject(value)) return Object.keys(value).length > 0
  return false
}

const normalizeName = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/\s+/g, ' ')
  .trim()

const slugify = (value) => {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized || 'artist'
}

const toInt = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[^0-9-]+/g, '')
  if (!cleaned) return null
  const parsed = Number.parseInt(cleaned, 10)
  return Number.isFinite(parsed) ? parsed : null
}

const yearFromDateLike = (value) => {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  const isoMatch = value.match(/^(\d{4})/)
  if (isoMatch) return Number.parseInt(isoMatch[1], 10)

  const wikiMatch = value.match(/^[+-](\d{1,})-/)
  if (wikiMatch) {
    const digits = wikiMatch[1]
    const slice = digits.slice(0, 4)
    const parsed = Number.parseInt(slice, 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

const splitList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  return value
    .split(/[;,|/]/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

const uniqueStrings = (values) => {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (!text) continue
    const key = normalizeName(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

const uniqueByJson = (values) => {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const key = JSON.stringify(value)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

const asArray = (value) => (Array.isArray(value) ? value : [])

const encodeWikiTitle = (title) => encodeURIComponent(String(title ?? '').replace(/ /g, '_'))

const normalizeUrl = (value) => {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text)) return text
  if (text.startsWith('//')) return `https:${text}`
  return `https://${text.replace(/^\/+/, '')}`
}

const isSocialUrl = (urlValue) => {
  const text = String(urlValue ?? '').toLowerCase()
  return SOCIAL_HOST_MARKERS.some((marker) => text.includes(marker))
}

const makeRawPath = (source, artistKey, endpoint) => path.join(ROOT, 'data', 'music', 'raw', source, `${artistKey}.${endpoint}.json`)

const saveRawJson = ({ source, artistKey, endpoint, payload }) => {
  const filePath = makeRawPath(source, artistKey, endpoint)
  writeJson(filePath, payload)
  return path.relative(ROOT, filePath).replace(/\\/g, '/')
}

const fetchJson = async (url, options = {}) => {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 25000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    })

    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch (error) {
      return {
        ok: false,
        status: response.status,
        error: `Invalid JSON response: ${error.message}`,
        text,
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      json,
      error: response.ok ? null : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
      json: null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

const fetchMusicBrainzJson = async (url) => {
  const elapsed = Date.now() - musicBrainzLastRequestAt
  if (elapsed < 1100) {
    await sleep(1100 - elapsed)
  }

  const result = await fetchJson(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': MUSICBRAINZ_USER_AGENT,
    },
  })

  musicBrainzLastRequestAt = Date.now()
  return result
}

const computeNameConfidence = (targetName, candidateName, baseline = 0.4) => {
  const target = normalizeName(targetName)
  const candidate = normalizeName(candidateName)
  if (!target || !candidate) return baseline
  if (target === candidate) return 1
  if (candidate.includes(target) || target.includes(candidate)) return Math.max(baseline, 0.75)
  return baseline
}

const pickBestMusicBrainzCandidate = (searchJson, artistName) => {
  const artists = asArray(searchJson?.artists)
  if (!artists.length) return null

  let best = null
  let bestScore = -Infinity
  for (const artist of artists) {
    const scoreBase = Number.parseInt(String(artist?.score ?? '0'), 10)
    const confidence = computeNameConfidence(artistName, artist?.name, scoreBase / 100)
    const exactBoost = normalizeName(artist?.name) === normalizeName(artistName) ? 0.25 : 0
    const total = scoreBase / 100 + confidence + exactBoost
    if (total > bestScore) {
      bestScore = total
      best = {
        artist,
        confidence: Math.max(0, Math.min(1, confidence)),
      }
    }
  }

  return best
}

const extractQidFromUrl = (urlValue) => {
  const text = String(urlValue ?? '')
  const match = text.match(/\/wiki\/(Q\d+)/i)
  return match ? match[1].toUpperCase() : null
}

const pickBestWikidataCandidate = (searchJson, artistName) => {
  const list = asArray(searchJson?.search)
  if (!list.length) return null

  let best = null
  let bestScore = -Infinity
  for (const item of list) {
    const confidence = computeNameConfidence(artistName, item?.label, 0.35)
    const exactBoost = normalizeName(item?.label) === normalizeName(artistName) ? 0.25 : 0
    const score = confidence + exactBoost
    if (score > bestScore) {
      bestScore = score
      best = {
        item,
        confidence: Math.max(0, Math.min(1, score)),
      }
    }
  }

  return best
}

const pickBestAudioDbArtist = (searchJson, artistName) => {
  const list = asArray(searchJson?.artists)
  if (!list.length) return null

  let best = null
  let bestScore = -Infinity
  for (const item of list) {
    const confidence = computeNameConfidence(artistName, item?.strArtist, 0.3)
    const exactBoost = normalizeName(item?.strArtist) === normalizeName(artistName) ? 0.2 : 0
    const score = confidence + exactBoost
    if (score > bestScore) {
      bestScore = score
      best = {
        item,
        confidence: Math.max(0, Math.min(1, score)),
      }
    }
  }

  return best
}

const pickBestSpotifyArtist = (searchJson, artistName) => {
  const list = asArray(searchJson?.artists?.items)
  if (!list.length) return null

  let best = null
  let bestScore = -Infinity
  for (const item of list) {
    const confidence = computeNameConfidence(artistName, item?.name, 0.35)
    const exactBoost = normalizeName(item?.name) === normalizeName(artistName) ? 0.25 : 0
    const score = confidence + exactBoost
    if (score > bestScore) {
      bestScore = score
      best = {
        item,
        confidence: Math.max(0, Math.min(1, score)),
      }
    }
  }

  return best
}

const getMusicBrainzQid = (mbArtistDetail) => {
  const relations = asArray(mbArtistDetail?.relations)
  for (const relation of relations) {
    const resource = String(relation?.url?.resource ?? '')
    const qid = extractQidFromUrl(resource)
    if (qid) return qid
  }
  return null
}

const getWikidataClaimList = (entity, property) => asArray(entity?.claims?.[property])

const getWikidataClaimEntityId = (claim) => {
  const value = claim?.mainsnak?.datavalue?.value
  if (!value) return null
  if (typeof value?.id === 'string') return value.id
  if (typeof value?.['numeric-id'] === 'number') return `Q${value['numeric-id']}`
  return null
}

const getWikidataClaimTimeYear = (claim) => {
  const value = claim?.mainsnak?.datavalue?.value
  const time = value?.time
  return yearFromDateLike(time)
}

const getWikidataClaimString = (claim) => {
  const value = claim?.mainsnak?.datavalue?.value
  if (typeof value === 'string') return value
  if (typeof value?.text === 'string') return value.text
  return null
}

const getWikidataLabel = (labelsResponse, entityId, languages = ['ru', 'en']) => {
  const labels = labelsResponse?.entities?.[entityId]?.labels
  if (!labels) return null
  for (const language of languages) {
    const value = labels?.[language]?.value
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const first = Object.values(labels)[0]
  return typeof first?.value === 'string' ? first.value : null
}

const toCommonsFileUrl = (fileName) => {
  const text = String(fileName ?? '').trim()
  if (!text) return null
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeWikiTitle(text)}`
}

const pushEvidence = (bucket, source, value) => {
  if (!Array.isArray(bucket)) return
  if (!isNonEmpty(value)) return
  bucket.push({ source, value })
}

const choosePrimaryFromEvidence = (evidence) => {
  const allPriority = [...SOURCE_PRIORITY, 'input', 'derived']
  for (const source of allPriority) {
    const match = evidence.find((entry) => entry?.source === source && isNonEmpty(entry?.value))
    if (match) return match.value
  }
  const first = evidence.find((entry) => isNonEmpty(entry?.value))
  return first ? first.value : null
}

const makeField = (evidence, fallbackValue = null) => {
  const cleaned = uniqueByJson(
    evidence
      .filter((entry) => entry && typeof entry.source === 'string')
      .map((entry) => ({ source: entry.source, value: entry.value }))
  )
  const primary = choosePrimaryFromEvidence(cleaned)
  return {
    primaryValue: primary ?? fallbackValue,
    sourceEvidence: cleaned,
  }
}

const hasConflict = (fieldValue) => {
  const list = asArray(fieldValue?.sourceEvidence).map((entry) => JSON.stringify(entry?.value))
  return new Set(list).size > 1
}

const collectMusicBrainzLinks = (artistDetail) => {
  const officialLinks = []
  const socialLinks = []
  const relations = asArray(artistDetail?.relations)

  for (const relation of relations) {
    const url = normalizeUrl(relation?.url?.resource)
    if (!url) continue

    const item = {
      url,
      relationType: relation?.type ?? null,
      source: 'musicbrainz',
    }

    if (isSocialUrl(url)) socialLinks.push(item)
    else officialLinks.push(item)
  }

  return {
    officialLinks: uniqueByJson(officialLinks),
    socialLinks: uniqueByJson(socialLinks),
  }
}

const collectMusicBrainzRelations = (artistDetail) => {
  const members = []
  const associatedActs = []
  const relations = asArray(artistDetail?.relations)

  for (const relation of relations) {
    if (!relation?.artist) continue

    const relationType = String(relation?.type ?? '').toLowerCase()
    const item = {
      name: relation.artist.name ?? null,
      mbid: relation.artist.id ?? null,
      relationType: relation?.type ?? null,
      direction: relation?.direction ?? null,
      source: 'musicbrainz',
    }

    if (relationType.includes('member') || relationType.includes('founder')) {
      members.push(item)
      continue
    }

    associatedActs.push(item)
  }

  return {
    members: uniqueByJson(members),
    associatedActs: uniqueByJson(associatedActs),
  }
}

const collectImageCandidates = ({ wikidata, lastfm, theaudiodb, spotify }) => {
  const images = []

  const wdEntity = wikidata?.entity
  if (wdEntity?.entity) {
    const claims = wdEntity.entity
    const imageClaims = getWikidataClaimList(claims, 'P18')
    for (const claim of imageClaims) {
      const fileName = getWikidataClaimString(claim)
      const url = toCommonsFileUrl(fileName)
      if (!url) continue
      images.push({
        url,
        source: 'wikidata',
        license: null,
        attribution: 'Wikimedia Commons via Wikidata',
      })
    }
  }

  const ruSummary = wikidata?.wikipediaRu
  const enSummary = wikidata?.wikipediaEn
  const ruThumb = ruSummary?.thumbnail?.source
  const enThumb = enSummary?.thumbnail?.source
  if (ruThumb) {
    images.push({
      url: ruThumb,
      source: 'wikimedia',
      license: null,
      attribution: 'Wikipedia REST API (ru)',
    })
  }
  if (enThumb) {
    images.push({
      url: enThumb,
      source: 'wikimedia',
      license: null,
      attribution: 'Wikipedia REST API (en)',
    })
  }

  const lfImages = asArray(lastfm?.getinfo?.artist?.image)
  for (const image of lfImages) {
    const url = normalizeUrl(image?.['#text'])
    if (!url) continue
    images.push({
      url,
      source: 'lastfm',
      license: null,
      attribution: 'Last.fm API',
    })
  }

  const adbArtist = theaudiodb?.selectedArtist
  const adbImageFields = [
    'strArtistThumb',
    'strArtistCutout',
    'strArtistClearart',
    'strArtistWideThumb',
    'strArtistFanart',
    'strArtistLogo',
    'strArtistBanner',
  ]
  for (const field of adbImageFields) {
    const url = normalizeUrl(adbArtist?.[field])
    if (!url) continue
    images.push({
      url,
      source: 'theaudiodb',
      license: null,
      attribution: 'TheAudioDB API',
    })
  }

  const spotifyImages = asArray(spotify?.selectedArtist?.images)
  for (const image of spotifyImages) {
    const url = normalizeUrl(image?.url)
    if (!url) continue
    images.push({
      url,
      source: 'spotify',
      license: null,
      attribution: 'Spotify Web API (attribution required)',
    })
  }

  return uniqueByJson(images)
}

const buildLastfmTopTracks = (lastfmData) => {
  return asArray(lastfmData?.gettoptracks?.toptracks?.track)
    .slice(0, 10)
    .map((track, index) => ({
      rank: toInt(track?.['@attr']?.rank) ?? index + 1,
      title: track?.name ?? null,
      listeners: toInt(track?.listeners),
      playcount: toInt(track?.playcount),
      source: 'lastfm',
    }))
    .filter((track) => isNonEmpty(track.title))
}

const buildAudioDbTopTracks = (audioDbData) => {
  return asArray(audioDbData?.trackTop10?.track)
    .slice(0, 10)
    .map((track, index) => ({
      rank: index + 1,
      title: track?.strTrack ?? null,
      listeners: null,
      playcount: toInt(track?.intMusicVidViews),
      source: 'theaudiodb',
    }))
    .filter((track) => isNonEmpty(track.title))
}

const buildSpotifyTopTracks = (spotifyData) => {
  return asArray(spotifyData?.topTracks?.tracks)
    .slice(0, 10)
    .map((track, index) => ({
      rank: index + 1,
      title: track?.name ?? null,
      listeners: null,
      playcount: null,
      source: 'spotify',
    }))
    .filter((track) => isNonEmpty(track.title))
}

const buildLastfmTopAlbums = (lastfmData) => {
  return asArray(lastfmData?.gettopalbums?.topalbums?.album)
    .slice(0, 5)
    .map((album, index) => ({
      rank: toInt(album?.['@attr']?.rank) ?? index + 1,
      title: album?.name ?? null,
      listeners: toInt(album?.playcount) ?? null,
      source: 'lastfm',
    }))
    .filter((album) => isNonEmpty(album.title))
}

const buildAudioDbTopAlbums = (audioDbData) => {
  return asArray(audioDbData?.albums?.album)
    .slice(0, 5)
    .map((album, index) => ({
      rank: index + 1,
      title: album?.strAlbum ?? null,
      listeners: null,
      source: 'theaudiodb',
    }))
    .filter((album) => isNonEmpty(album.title))
}

const buildLastfmSimilarArtists = (lastfmData) => {
  return asArray(lastfmData?.getsimilar?.similarartists?.artist)
    .slice(0, 3)
    .map((artist, index) => ({
      rank: index + 1,
      name: artist?.name ?? null,
      match: Number.parseFloat(String(artist?.match ?? '0')) || null,
      source: 'lastfm',
    }))
    .filter((artist) => isNonEmpty(artist.name))
}

const buildMusicBrainzGenres = (artistDetail) => uniqueStrings([
  ...asArray(artistDetail?.genres).map((item) => item?.name),
])

const buildMusicBrainzTags = (artistDetail) => uniqueStrings([
  ...asArray(artistDetail?.tags).map((item) => item?.name),
])

const buildLastfmTags = (lastfmData) => uniqueStrings([
  ...asArray(lastfmData?.gettoptags?.toptags?.tag).map((item) => item?.name),
  ...asArray(lastfmData?.getinfo?.artist?.tags?.tag).map((item) => item?.name),
])

const buildWikidataGenreLabels = (wikidataData) => {
  const entity = wikidataData?.entity?.entity
  if (!entity) return []

  const labelsResponse = wikidataData?.labels
  const genreIds = getWikidataClaimList(entity, 'P136')
    .map((claim) => getWikidataClaimEntityId(claim))
    .filter(Boolean)

  return uniqueStrings(genreIds.map((id) => getWikidataLabel(labelsResponse, id)).filter(Boolean))
}

const buildWikidataTypeLabels = (wikidataData) => {
  const entity = wikidataData?.entity?.entity
  if (!entity) return []

  const labelsResponse = wikidataData?.labels
  const typeIds = getWikidataClaimList(entity, 'P31')
    .map((claim) => getWikidataClaimEntityId(claim))
    .filter(Boolean)

  return uniqueStrings(typeIds.map((id) => getWikidataLabel(labelsResponse, id)).filter(Boolean))
}

const pickWikidataCountry = (wikidataData) => {
  const entity = wikidataData?.entity?.entity
  if (!entity) return null

  const labelsResponse = wikidataData?.labels
  const claimCandidates = [
    ...getWikidataClaimList(entity, 'P27'),
    ...getWikidataClaimList(entity, 'P17'),
  ]

  for (const claim of claimCandidates) {
    const id = getWikidataClaimEntityId(claim)
    if (!id) continue
    const label = getWikidataLabel(labelsResponse, id)
    if (label) return label
  }

  return null
}

const pickWikidataCity = (wikidataData) => {
  const entity = wikidataData?.entity?.entity
  if (!entity) return null

  const labelsResponse = wikidataData?.labels
  const claimCandidates = [
    ...getWikidataClaimList(entity, 'P159'),
    ...getWikidataClaimList(entity, 'P19'),
  ]

  for (const claim of claimCandidates) {
    const id = getWikidataClaimEntityId(claim)
    if (!id) continue
    const label = getWikidataLabel(labelsResponse, id)
    if (label) return label
  }

  return null
}

const fetchMusicBrainzStage = async ({ artistName, artistKey, notes }) => {
  const source = 'musicbrainz'
  const stage = {
    source,
    status: 'not_found',
    rawFiles: [],
    data: null,
    confidence: null,
    error: null,
  }

  const searchParams = new URLSearchParams({
    query: `artist:"${artistName}"`,
    fmt: 'json',
    limit: '5',
  })

  const searchUrl = `https://musicbrainz.org/ws/2/artist/?${searchParams.toString()}`
  const searchResponse = await fetchMusicBrainzJson(searchUrl)
  if (!searchResponse.ok || !searchResponse.json) {
    stage.status = 'error'
    stage.error = searchResponse.error || 'MusicBrainz search failed'
    notes.push(`musicbrainz_search_failed:${stage.error}`)
    return stage
  }

  stage.rawFiles.push(saveRawJson({
    source,
    artistKey,
    endpoint: 'search',
    payload: searchResponse.json,
  }))

  const picked = pickBestMusicBrainzCandidate(searchResponse.json, artistName)
  if (!picked?.artist?.id) {
    stage.status = 'not_found'
    notes.push('musicbrainz_no_match')
    stage.data = {
      search: searchResponse.json,
      selected: null,
      artist: null,
    }
    return stage
  }

  const detailParams = new URLSearchParams({
    fmt: 'json',
    inc: 'aliases+tags+genres+url-rels+artist-rels',
  })
  const detailUrl = `https://musicbrainz.org/ws/2/artist/${picked.artist.id}?${detailParams.toString()}`
  const detailResponse = await fetchMusicBrainzJson(detailUrl)
  if (!detailResponse.ok || !detailResponse.json) {
    stage.status = 'error'
    stage.error = detailResponse.error || 'MusicBrainz artist details failed'
    notes.push(`musicbrainz_details_failed:${stage.error}`)
    stage.data = {
      search: searchResponse.json,
      selected: picked,
      artist: null,
    }
    return stage
  }

  stage.rawFiles.push(saveRawJson({
    source,
    artistKey,
    endpoint: 'artist',
    payload: detailResponse.json,
  }))

  stage.status = 'ok'
  stage.confidence = picked.confidence
  stage.data = {
    search: searchResponse.json,
    selected: {
      id: picked.artist.id,
      name: picked.artist.name,
      score: picked.artist.score,
      confidence: picked.confidence,
    },
    artist: detailResponse.json,
  }

  return stage
}

const fetchLastfmStage = async ({ artistName, artistKey, notes }) => {
  const source = 'lastfm'
  const stage = {
    source,
    status: 'skipped',
    rawFiles: [],
    data: null,
    confidence: null,
    error: null,
  }

  const apiKey = process.env.LASTFM_API_KEY
  if (!apiKey) {
    notes.push('lastfm_api_key_missing')
    stage.error = 'LASTFM_API_KEY is missing'
    return stage
  }

  const methods = [
    'artist.getinfo',
    'artist.gettoptracks',
    'artist.gettopalbums',
    'artist.getsimilar',
    'artist.gettoptags',
  ]

  const data = {}
  let successCount = 0

  for (const method of methods) {
    const params = new URLSearchParams({
      method,
      artist: artistName,
      api_key: apiKey,
      format: 'json',
      autocorrect: '1',
    })

    if (method === 'artist.gettoptracks') params.set('limit', '10')
    if (method === 'artist.gettopalbums') params.set('limit', '5')
    if (method === 'artist.getsimilar') params.set('limit', '3')

    const url = `https://ws.audioscrobbler.com/2.0/?${params.toString()}`
    const response = await fetchJson(url)
    if (!response.ok || !response.json) {
      notes.push(`lastfm_${method}_failed:${response.error || 'request_failed'}`)
      continue
    }

    const key = method.split('.').pop()
    data[key] = response.json
    stage.rawFiles.push(saveRawJson({
      source,
      artistKey,
      endpoint: key,
      payload: response.json,
    }))
    successCount += 1
  }

  if (!successCount) {
    stage.status = 'error'
    stage.error = 'No successful Last.fm responses'
    notes.push('lastfm_no_successful_responses')
    return stage
  }

  stage.status = 'ok'
  stage.data = data

  const infoName = data?.getinfo?.artist?.name
  if (infoName) stage.confidence = computeNameConfidence(artistName, infoName, 0.4)
  return stage
}

const fetchWikidataStage = async ({ artistName, artistKey, notes, mbStage }) => {
  const source = 'wikidata'
  const stage = {
    source,
    status: 'not_found',
    rawFiles: [],
    data: null,
    confidence: null,
    error: null,
  }

  let qid = getMusicBrainzQid(mbStage?.data?.artist)
  let searchJson = null
  let searchConfidence = null

  if (!qid) {
    const searchParams = new URLSearchParams({
      action: 'wbsearchentities',
      search: artistName,
      language: 'en',
      type: 'item',
      limit: '5',
      format: 'json',
      origin: '*',
    })
    const searchUrl = `https://www.wikidata.org/w/api.php?${searchParams.toString()}`
    const searchResponse = await fetchJson(searchUrl)
    if (searchResponse.ok && searchResponse.json) {
      searchJson = searchResponse.json
      stage.rawFiles.push(saveRawJson({
        source,
        artistKey,
        endpoint: 'search',
        payload: searchJson,
      }))
      const picked = pickBestWikidataCandidate(searchJson, artistName)
      if (picked?.item?.id) {
        qid = picked.item.id
        searchConfidence = picked.confidence
      }
    }
  }

  if (!qid) {
    notes.push('wikidata_no_match')
    stage.data = {
      qid: null,
      search: searchJson,
      entity: null,
      labels: null,
      wikipediaRu: null,
      wikipediaEn: null,
    }
    return stage
  }

  const entityUrl = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`
  const entityResponse = await fetchJson(entityUrl)
  if (!entityResponse.ok || !entityResponse.json) {
    stage.status = 'error'
    stage.error = entityResponse.error || 'Wikidata entity request failed'
    notes.push(`wikidata_entity_failed:${stage.error}`)
    return stage
  }

  stage.rawFiles.push(saveRawJson({
    source,
    artistKey,
    endpoint: 'entity',
    payload: entityResponse.json,
  }))

  const entity = entityResponse.json?.entities?.[qid]
  const labelIds = new Set()
  if (entity) {
    for (const property of ['P31', 'P136', 'P27', 'P17', 'P159', 'P19']) {
      for (const claim of getWikidataClaimList(entity, property)) {
        const id = getWikidataClaimEntityId(claim)
        if (id) labelIds.add(id)
      }
    }
  }

  let labelsResponseJson = null
  if (labelIds.size) {
    const labelsParams = new URLSearchParams({
      action: 'wbgetentities',
      ids: [...labelIds].join('|'),
      props: 'labels',
      languages: 'ru|en',
      format: 'json',
      origin: '*',
    })
    const labelsUrl = `https://www.wikidata.org/w/api.php?${labelsParams.toString()}`
    const labelsResponse = await fetchJson(labelsUrl)
    if (labelsResponse.ok && labelsResponse.json) {
      labelsResponseJson = labelsResponse.json
      stage.rawFiles.push(saveRawJson({
        source,
        artistKey,
        endpoint: 'labels',
        payload: labelsResponseJson,
      }))
    }
  }

  const wikiRuTitle = entity?.sitelinks?.ruwiki?.title
  const wikiEnTitle = entity?.sitelinks?.enwiki?.title

  let wikipediaRu = null
  let wikipediaEn = null

  if (wikiRuTitle) {
    const ruUrl = `https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeWikiTitle(wikiRuTitle)}`
    const ruResponse = await fetchJson(ruUrl)
    if (ruResponse.ok && ruResponse.json) {
      wikipediaRu = ruResponse.json
      stage.rawFiles.push(saveRawJson({
        source: 'wikimedia',
        artistKey,
        endpoint: 'wikipedia_ru_summary',
        payload: wikipediaRu,
      }))
    }
  }

  if (wikiEnTitle) {
    const enUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeWikiTitle(wikiEnTitle)}`
    const enResponse = await fetchJson(enUrl)
    if (enResponse.ok && enResponse.json) {
      wikipediaEn = enResponse.json
      stage.rawFiles.push(saveRawJson({
        source: 'wikimedia',
        artistKey,
        endpoint: 'wikipedia_en_summary',
        payload: wikipediaEn,
      }))
    }
  }

  stage.status = 'ok'
  stage.confidence = searchConfidence ?? (mbStage?.data?.selected?.confidence ?? 0.6)
  stage.data = {
    qid,
    search: searchJson,
    entity: {
      qid,
      entity,
    },
    labels: labelsResponseJson,
    wikipediaRu,
    wikipediaEn,
  }

  return stage
}

const fetchAudioDbStage = async ({ artistName, artistKey, notes }) => {
  const source = 'theaudiodb'
  const stage = {
    source,
    status: 'not_found',
    rawFiles: [],
    data: null,
    confidence: null,
    error: null,
  }

  const apiKey = process.env.THEAUDIODB_API_KEY || AUDIODB_DEMO_KEY
  if (!process.env.THEAUDIODB_API_KEY) {
    notes.push('theaudiodb_demo_key_used')
  }

  const searchUrl = `https://www.theaudiodb.com/api/v1/json/${apiKey}/search.php?s=${encodeURIComponent(artistName)}`
  const searchResponse = await fetchJson(searchUrl)
  if (!searchResponse.ok || !searchResponse.json) {
    stage.status = 'error'
    stage.error = searchResponse.error || 'TheAudioDB search failed'
    notes.push(`theaudiodb_search_failed:${stage.error}`)
    return stage
  }

  stage.rawFiles.push(saveRawJson({
    source,
    artistKey,
    endpoint: 'search',
    payload: searchResponse.json,
  }))

  const picked = pickBestAudioDbArtist(searchResponse.json, artistName)
  if (!picked?.item?.idArtist) {
    notes.push('theaudiodb_no_match')
    stage.data = {
      search: searchResponse.json,
      selectedArtist: null,
      trackTop10: null,
      albums: null,
      videos: null,
    }
    return stage
  }

  const artistId = picked.item.idArtist
  const trackTop10Url = `https://www.theaudiodb.com/api/v1/json/${apiKey}/track-top10.php?s=${encodeURIComponent(picked.item.strArtist ?? artistName)}`
  const albumsUrl = `https://www.theaudiodb.com/api/v1/json/${apiKey}/album.php?i=${encodeURIComponent(artistId)}`
  const videosUrl = `https://www.theaudiodb.com/api/v1/json/${apiKey}/mvid.php?i=${encodeURIComponent(artistId)}`

  const [trackTop10Response, albumsResponse, videosResponse] = await Promise.all([
    fetchJson(trackTop10Url),
    fetchJson(albumsUrl),
    fetchJson(videosUrl),
  ])

  let trackTop10 = null
  let albums = null
  let videos = null

  if (trackTop10Response.ok && trackTop10Response.json) {
    trackTop10 = trackTop10Response.json
    stage.rawFiles.push(saveRawJson({
      source,
      artistKey,
      endpoint: 'track_top10',
      payload: trackTop10,
    }))
  }

  if (albumsResponse.ok && albumsResponse.json) {
    albums = albumsResponse.json
    stage.rawFiles.push(saveRawJson({
      source,
      artistKey,
      endpoint: 'albums',
      payload: albums,
    }))
  }

  if (videosResponse.ok && videosResponse.json) {
    videos = videosResponse.json
    stage.rawFiles.push(saveRawJson({
      source,
      artistKey,
      endpoint: 'videos',
      payload: videos,
    }))
  }

  stage.status = 'ok'
  stage.confidence = picked.confidence
  stage.data = {
    search: searchResponse.json,
    selectedArtist: picked.item,
    trackTop10,
    albums,
    videos,
  }

  return stage
}

const fetchSpotifyStage = async ({ artistName, artistKey, notes }) => {
  const source = 'spotify'
  const stage = {
    source,
    status: 'skipped',
    rawFiles: [],
    data: null,
    confidence: null,
    error: null,
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    notes.push('spotify_api_credentials_missing')
    stage.error = 'SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET are missing'
    return stage
  }

  const authToken = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const tokenResponse = await fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  })

  if (!tokenResponse.ok || !tokenResponse.json?.access_token) {
    stage.status = 'error'
    stage.error = tokenResponse.error || 'Spotify token request failed'
    notes.push(`spotify_token_failed:${stage.error}`)
    return stage
  }

  stage.rawFiles.push(saveRawJson({
    source,
    artistKey,
    endpoint: 'token',
    payload: tokenResponse.json,
  }))

  const accessToken = tokenResponse.json.access_token
  const baseHeaders = {
    Authorization: `Bearer ${accessToken}`,
  }

  const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(`artist:${artistName}`)}&type=artist&limit=5`
  const searchResponse = await fetchJson(searchUrl, { headers: baseHeaders })
  if (!searchResponse.ok || !searchResponse.json) {
    stage.status = 'error'
    stage.error = searchResponse.error || 'Spotify artist search failed'
    notes.push(`spotify_search_failed:${stage.error}`)
    return stage
  }

  stage.rawFiles.push(saveRawJson({
    source,
    artistKey,
    endpoint: 'search',
    payload: searchResponse.json,
  }))

  const picked = pickBestSpotifyArtist(searchResponse.json, artistName)
  if (!picked?.item?.id) {
    notes.push('spotify_no_match')
    stage.data = {
      search: searchResponse.json,
      selectedArtist: null,
      artistDetails: null,
      topTracks: null,
    }
    return stage
  }

  const artistId = picked.item.id
  const detailsUrl = `https://api.spotify.com/v1/artists/${artistId}`
  const topTracksUrl = `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`
  const [detailsResponse, topTracksResponse] = await Promise.all([
    fetchJson(detailsUrl, { headers: baseHeaders }),
    fetchJson(topTracksUrl, { headers: baseHeaders }),
  ])

  let artistDetails = null
  let topTracks = null

  if (detailsResponse.ok && detailsResponse.json) {
    artistDetails = detailsResponse.json
    stage.rawFiles.push(saveRawJson({
      source,
      artistKey,
      endpoint: 'artist',
      payload: artistDetails,
    }))
  }

  if (topTracksResponse.ok && topTracksResponse.json) {
    topTracks = topTracksResponse.json
    stage.rawFiles.push(saveRawJson({
      source,
      artistKey,
      endpoint: 'top_tracks',
      payload: topTracks,
    }))
  }

  stage.status = 'ok'
  stage.confidence = picked.confidence
  stage.data = {
    search: searchResponse.json,
    selectedArtist: picked.item,
    artistDetails,
    topTracks,
  }

  return stage
}

const fetchStageForArtist = async ({ item, index }) => {
  const artistName = String(item?.artist ?? '').trim()
  const artistKey = `${String(index + 1).padStart(3, '0')}_${slugify(artistName)}`
  const notes = []

  const sourceStages = {}

  sourceStages.musicbrainz = await fetchMusicBrainzStage({
    artistName,
    artistKey,
    notes,
  })

  sourceStages.lastfm = await fetchLastfmStage({
    artistName,
    artistKey,
    notes,
  })

  sourceStages.wikidata = await fetchWikidataStage({
    artistName,
    artistKey,
    notes,
    mbStage: sourceStages.musicbrainz,
  })

  sourceStages.theaudiodb = await fetchAudioDbStage({
    artistName,
    artistKey,
    notes,
  })

  sourceStages.spotify = await fetchSpotifyStage({
    artistName,
    artistKey,
    notes,
  })

  const rawFiles = uniqueStrings(Object.values(sourceStages).flatMap((stage) => asArray(stage?.rawFiles)))
  const sourceStatus = Object.fromEntries(
    Object.entries(sourceStages).map(([source, stage]) => [source, stage?.status ?? 'unknown'])
  )

  return {
    artistKey,
    artistName,
    index,
    input: item,
    fetchedAt: new Date().toISOString(),
    notes: uniqueStrings(notes),
    sourceStatus,
    rawFiles,
    sources: sourceStages,
  }
}

const extractStageForArtist = (entry) => {
  const input = entry.input ?? {}
  const mb = entry.sources?.musicbrainz?.data ?? {}
  const lf = entry.sources?.lastfm?.data ?? {}
  const wd = entry.sources?.wikidata?.data ?? {}
  const adb = entry.sources?.theaudiodb?.data ?? {}
  const sp = entry.sources?.spotify?.data ?? {}

  const mbArtist = mb?.artist
  const lfArtist = lf?.getinfo?.artist
  const wdEntity = wd?.entity?.entity
  const adbArtist = adb?.selectedArtist
  const spArtist = sp?.selectedArtist

  const canonicalNameEvidence = []
  pushEvidence(canonicalNameEvidence, 'musicbrainz', mbArtist?.name)
  pushEvidence(canonicalNameEvidence, 'lastfm', lfArtist?.name)
  pushEvidence(canonicalNameEvidence, 'wikidata', wdEntity?.labels?.en?.value || wdEntity?.labels?.ru?.value)
  pushEvidence(canonicalNameEvidence, 'theaudiodb', adbArtist?.strArtist)
  pushEvidence(canonicalNameEvidence, 'spotify', spArtist?.name)
  pushEvidence(canonicalNameEvidence, 'input', input?.artist)

  const displayNameRuEvidence = []
  pushEvidence(displayNameRuEvidence, 'wikidata', wdEntity?.labels?.ru?.value)
  pushEvidence(displayNameRuEvidence, 'musicbrainz', asArray(mbArtist?.aliases).find((alias) => alias?.locale === 'ru')?.name)
  pushEvidence(displayNameRuEvidence, 'input', asArray(input?.alternative_names).find((name) => /[А-Яа-яЁё]/.test(String(name))))

  const displayNameEnEvidence = []
  pushEvidence(displayNameEnEvidence, 'musicbrainz', mbArtist?.name)
  pushEvidence(displayNameEnEvidence, 'wikidata', wdEntity?.labels?.en?.value)
  pushEvidence(displayNameEnEvidence, 'lastfm', lfArtist?.name)
  pushEvidence(displayNameEnEvidence, 'theaudiodb', adbArtist?.strArtist)
  pushEvidence(displayNameEnEvidence, 'spotify', spArtist?.name)

  const aliasesEvidence = []
  pushEvidence(aliasesEvidence, 'musicbrainz', uniqueStrings(asArray(mbArtist?.aliases).map((alias) => alias?.name)))
  pushEvidence(aliasesEvidence, 'wikidata', uniqueStrings([
    ...asArray(wdEntity?.aliases?.ru).map((item) => item?.value),
    ...asArray(wdEntity?.aliases?.en).map((item) => item?.value),
  ]))
  pushEvidence(aliasesEvidence, 'input', uniqueStrings(asArray(input?.alternative_names)))

  const artistTypeEvidence = []
  pushEvidence(artistTypeEvidence, 'musicbrainz', mbArtist?.type)
  pushEvidence(artistTypeEvidence, 'wikidata', buildWikidataTypeLabels(wd))
  pushEvidence(artistTypeEvidence, 'theaudiodb', adbArtist?.strStyle)

  const countryEvidence = []
  pushEvidence(countryEvidence, 'musicbrainz', mbArtist?.country)
  pushEvidence(countryEvidence, 'wikidata', pickWikidataCountry(wd))
  pushEvidence(countryEvidence, 'theaudiodb', adbArtist?.strCountry)
  pushEvidence(countryEvidence, 'input', input?.country)

  const areaEvidence = []
  pushEvidence(areaEvidence, 'musicbrainz', mbArtist?.area?.name)
  pushEvidence(areaEvidence, 'theaudiodb', adbArtist?.strCountry)

  const cityEvidence = []
  pushEvidence(cityEvidence, 'musicbrainz', mbArtist?.['begin-area']?.name)
  pushEvidence(cityEvidence, 'wikidata', pickWikidataCity(wd))
  pushEvidence(cityEvidence, 'theaudiodb', adbArtist?.strLocation)

  const beginYearEvidence = []
  pushEvidence(beginYearEvidence, 'musicbrainz', yearFromDateLike(mbArtist?.['life-span']?.begin))
  pushEvidence(beginYearEvidence, 'wikidata',
    yearFromDateLike(
      getWikidataClaimList(wdEntity, 'P571').map((claim) => getWikidataClaimTimeYear(claim)).find(Boolean)
      || getWikidataClaimList(wdEntity, 'P569').map((claim) => getWikidataClaimTimeYear(claim)).find(Boolean)
    )
  )
  pushEvidence(beginYearEvidence, 'theaudiodb', toInt(adbArtist?.intFormedYear))
  pushEvidence(beginYearEvidence, 'input', toInt(input?.debutYear))

  const endYearEvidence = []
  pushEvidence(endYearEvidence, 'musicbrainz', yearFromDateLike(mbArtist?.['life-span']?.end))
  pushEvidence(endYearEvidence, 'wikidata',
    yearFromDateLike(
      getWikidataClaimList(wdEntity, 'P576').map((claim) => getWikidataClaimTimeYear(claim)).find(Boolean)
      || getWikidataClaimList(wdEntity, 'P570').map((claim) => getWikidataClaimTimeYear(claim)).find(Boolean)
    )
  )
  pushEvidence(endYearEvidence, 'theaudiodb', toInt(adbArtist?.intDiedYear))

  const isActiveEvidence = []
  if (typeof mbArtist?.['life-span']?.ended === 'boolean') {
    pushEvidence(isActiveEvidence, 'musicbrainz', !mbArtist['life-span'].ended)
  }
  if (isNonEmpty(toInt(adbArtist?.intDiedYear))) {
    pushEvidence(isActiveEvidence, 'theaudiodb', false)
  }

  const genresEvidence = []
  pushEvidence(genresEvidence, 'musicbrainz', buildMusicBrainzGenres(mbArtist))
  pushEvidence(genresEvidence, 'lastfm', buildLastfmTags(lf))
  pushEvidence(genresEvidence, 'wikidata', buildWikidataGenreLabels(wd))
  pushEvidence(genresEvidence, 'theaudiodb', uniqueStrings(splitList(adbArtist?.strGenre)))
  pushEvidence(genresEvidence, 'input', uniqueStrings(asArray(input?.genres)))

  const tagsEvidence = []
  pushEvidence(tagsEvidence, 'musicbrainz', buildMusicBrainzTags(mbArtist))
  pushEvidence(tagsEvidence, 'lastfm', buildLastfmTags(lf))

  const stylesEvidence = []
  pushEvidence(stylesEvidence, 'theaudiodb', uniqueStrings(splitList(adbArtist?.strStyle)))

  const moodsEvidence = []
  pushEvidence(moodsEvidence, 'theaudiodb', uniqueStrings(splitList(adbArtist?.strMood)))

  const lastfmTracks = buildLastfmTopTracks(lf)
  const audioDbTracks = buildAudioDbTopTracks(adb)
  const spotifyTracks = buildSpotifyTopTracks(sp)
  const topTracksEvidence = []
  pushEvidence(topTracksEvidence, 'lastfm', lastfmTracks)
  pushEvidence(topTracksEvidence, 'theaudiodb', audioDbTracks)
  pushEvidence(topTracksEvidence, 'spotify', spotifyTracks)

  const lastfmAlbums = buildLastfmTopAlbums(lf)
  const audioDbAlbums = buildAudioDbTopAlbums(adb)
  const topAlbumsEvidence = []
  pushEvidence(topAlbumsEvidence, 'lastfm', lastfmAlbums)
  pushEvidence(topAlbumsEvidence, 'theaudiodb', audioDbAlbums)

  const similarEvidence = []
  pushEvidence(similarEvidence, 'lastfm', buildLastfmSimilarArtists(lf))

  const mbRelations = collectMusicBrainzRelations(mbArtist)
  const membersEvidence = []
  const associatedEvidence = []
  pushEvidence(membersEvidence, 'musicbrainz', mbRelations.members)
  pushEvidence(associatedEvidence, 'musicbrainz', mbRelations.associatedActs)

  const mbLinks = collectMusicBrainzLinks(mbArtist)
  const wikiLinks = []
  if (wd?.qid) wikiLinks.push(`https://www.wikidata.org/wiki/${wd.qid}`)
  if (wd?.wikipediaRu?.content_urls?.desktop?.page) wikiLinks.push(wd.wikipediaRu.content_urls.desktop.page)
  if (wd?.wikipediaEn?.content_urls?.desktop?.page) wikiLinks.push(wd.wikipediaEn.content_urls.desktop.page)

  const officialLinksEvidence = []
  pushEvidence(officialLinksEvidence, 'musicbrainz', mbLinks.officialLinks)
  pushEvidence(officialLinksEvidence, 'wikidata', uniqueByJson(wikiLinks.map((url) => ({ url, source: 'wikidata' }))))
  pushEvidence(officialLinksEvidence, 'theaudiodb', uniqueByJson([
    normalizeUrl(adbArtist?.strWebsite),
  ].filter(Boolean).map((url) => ({ url, source: 'theaudiodb' }))))
  pushEvidence(officialLinksEvidence, 'spotify', uniqueByJson([
    normalizeUrl(spArtist?.external_urls?.spotify),
  ].filter(Boolean).map((url) => ({ url, source: 'spotify' }))))

  const socialLinksEvidence = []
  pushEvidence(socialLinksEvidence, 'musicbrainz', mbLinks.socialLinks)
  pushEvidence(socialLinksEvidence, 'theaudiodb', uniqueByJson([
    normalizeUrl(adbArtist?.strFacebook),
    normalizeUrl(adbArtist?.strTwitter),
    normalizeUrl(adbArtist?.strInstagram),
    normalizeUrl(adbArtist?.strYoutube),
  ].filter(Boolean).map((url) => ({ url, source: 'theaudiodb' }))))

  const imageCandidatesEvidence = []
  pushEvidence(imageCandidatesEvidence, 'wikidata', collectImageCandidates({
    wikidata: wd,
    lastfm: null,
    theaudiodb: null,
    spotify: null,
  }))
  pushEvidence(imageCandidatesEvidence, 'lastfm', collectImageCandidates({
    wikidata: null,
    lastfm: lf,
    theaudiodb: null,
    spotify: null,
  }))
  pushEvidence(imageCandidatesEvidence, 'theaudiodb', collectImageCandidates({
    wikidata: null,
    lastfm: null,
    theaudiodb: adb,
    spotify: null,
  }))
  pushEvidence(imageCandidatesEvidence, 'spotify', collectImageCandidates({
    wikidata: null,
    lastfm: null,
    theaudiodb: null,
    spotify: sp,
  }))

  const listenersEvidence = []
  pushEvidence(listenersEvidence, 'lastfm', toInt(lfArtist?.stats?.listeners))

  const playcountEvidence = []
  pushEvidence(playcountEvidence, 'lastfm', toInt(lfArtist?.stats?.playcount))

  const matchConfidenceEvidence = []
  pushEvidence(matchConfidenceEvidence, 'musicbrainz', entry.sources?.musicbrainz?.confidence)
  pushEvidence(matchConfidenceEvidence, 'lastfm', entry.sources?.lastfm?.confidence)
  pushEvidence(matchConfidenceEvidence, 'wikidata', entry.sources?.wikidata?.confidence)
  pushEvidence(matchConfidenceEvidence, 'theaudiodb', entry.sources?.theaudiodb?.confidence)
  pushEvidence(matchConfidenceEvidence, 'spotify', entry.sources?.spotify?.confidence)

  const canonicalName = makeField(canonicalNameEvidence, null)
  const displayNameRu = makeField(displayNameRuEvidence, null)
  const displayNameEn = makeField(displayNameEnEvidence, null)
  const aliases = makeField(aliasesEvidence, [])
  const artistType = makeField(artistTypeEvidence, null)
  const country = makeField(countryEvidence, null)
  const area = makeField(areaEvidence, null)
  const city = makeField(cityEvidence, null)
  const beginYear = makeField(beginYearEvidence, null)
  const endYear = makeField(endYearEvidence, null)
  const isActive = makeField(isActiveEvidence, null)
  const genres = makeField(genresEvidence, [])
  const tags = makeField(tagsEvidence, [])
  const styles = makeField(stylesEvidence, [])
  const moods = makeField(moodsEvidence, [])
  const topTracks = makeField(topTracksEvidence, [])
  const topAlbums = makeField(topAlbumsEvidence, [])
  const similarArtists = makeField(similarEvidence, [])
  const members = makeField(membersEvidence, [])
  const associatedActs = makeField(associatedEvidence, [])
  const officialLinks = makeField(officialLinksEvidence, [])
  const socialLinks = makeField(socialLinksEvidence, [])
  const imageCandidates = makeField(imageCandidatesEvidence, [])
  const listeners = makeField(listenersEvidence, null)
  const playcount = makeField(playcountEvidence, null)
  const matchConfidence = makeField(matchConfidenceEvidence, null)

  const reviewReasons = [...entry.notes]
  if (!isNonEmpty(canonicalName.primaryValue)) reviewReasons.push('canonical_name_missing')
  if (!asArray(topTracks.primaryValue).length) reviewReasons.push('top_tracks_missing')
  if (!asArray(topAlbums.primaryValue).length) reviewReasons.push('top_albums_missing')
  if (typeof matchConfidence.primaryValue === 'number' && matchConfidence.primaryValue < 0.65) {
    reviewReasons.push('low_match_confidence')
  }
  if (hasConflict(canonicalName)) reviewReasons.push('conflict_canonical_name')
  if (hasConflict(country)) reviewReasons.push('conflict_country')
  if (hasConflict(beginYear)) reviewReasons.push('conflict_begin_year')

  const sourceEvidence = {
    canonicalName: canonicalName.sourceEvidence,
    displayNameRu: displayNameRu.sourceEvidence,
    displayNameEn: displayNameEn.sourceEvidence,
    aliases: aliases.sourceEvidence,
    artistType: artistType.sourceEvidence,
    country: country.sourceEvidence,
    area: area.sourceEvidence,
    city: city.sourceEvidence,
    beginYear: beginYear.sourceEvidence,
    endYear: endYear.sourceEvidence,
    isActive: isActive.sourceEvidence,
    genres: genres.sourceEvidence,
    tags: tags.sourceEvidence,
    styles: styles.sourceEvidence,
    moods: moods.sourceEvidence,
    topTracks: topTracks.sourceEvidence,
    topAlbums: topAlbums.sourceEvidence,
    similarArtists: similarArtists.sourceEvidence,
    members: members.sourceEvidence,
    associatedActs: associatedActs.sourceEvidence,
    officialLinks: officialLinks.sourceEvidence,
    socialLinks: socialLinks.sourceEvidence,
    imageCandidates: imageCandidates.sourceEvidence,
    listeners: listeners.sourceEvidence,
    playcount: playcount.sourceEvidence,
    matchConfidence: matchConfidence.sourceEvidence,
  }

  return {
    artistKey: entry.artistKey,
    input: {
      position: entry.index + 1,
      artist: entry.artistName,
      rank: input?.rank ?? null,
    },
    pipeline: {
      fetchedAt: entry.fetchedAt,
      extractedAt: new Date().toISOString(),
      sourcePriority: SOURCE_PRIORITY,
      sourceStatus: entry.sourceStatus,
      rawFiles: entry.rawFiles,
    },
    canonicalName,
    displayNameRu,
    displayNameEn,
    aliases,
    artistType,
    country,
    area,
    city,
    beginYear,
    endYear,
    isActive,
    genres,
    tags,
    styles,
    moods,
    topTracks,
    topAlbums,
    similarArtists,
    members,
    associatedActs,
    officialLinks,
    socialLinks,
    imageCandidates,
    popularityMetrics: {
      listeners,
      playcount,
    },
    matchConfidence,
    manualReviewReason: uniqueStrings(reviewReasons),
    sourceEvidence,
  }
}

const main = async () => {
  const options = parseArgs()
  const inputPath = path.isAbsolute(options.input) ? options.input : path.join(ROOT, options.input)

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${options.input}`)
  }

  const inputJson = readJson(inputPath)
  if (!Array.isArray(inputJson)) {
    throw new Error('Input file must contain a JSON array')
  }

  const selected = inputJson.slice(0, options.limit)
  const runTag = options.runTag || `first${options.limit}`

  const fetchedEntries = []
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index]
    const artistName = String(item?.artist ?? '').trim()
    console.log(`[fetch] ${index + 1}/${selected.length}: ${artistName}`)
    const result = await fetchStageForArtist({ item, index })
    fetchedEntries.push(result)
  }

  const fetchIndexPath = path.join(ROOT, 'data', 'music', 'raw', `fetch-index.${runTag}.json`)
  writeJson(fetchIndexPath, {
    generatedAt: new Date().toISOString(),
    input: options.input,
    limit: options.limit,
    artists: fetchedEntries.map((entry) => ({
      artistKey: entry.artistKey,
      artistName: entry.artistName,
      position: entry.index + 1,
      sourceStatus: entry.sourceStatus,
      notes: entry.notes,
      rawFiles: entry.rawFiles,
    })),
  })

  const normalizedItems = fetchedEntries.map((entry) => extractStageForArtist(entry))
  const normalizedPath = path.join(ROOT, 'data', 'music', 'normalized', `music_artists_enriched_${runTag}.json`)
  writeJson(normalizedPath, {
    generatedAt: new Date().toISOString(),
    input: options.input,
    limit: options.limit,
    sourcePriority: SOURCE_PRIORITY,
    items: normalizedItems,
  })

  console.log(`Fetch index: ${path.relative(ROOT, fetchIndexPath).replace(/\\/g, '/')}`)
  console.log(`Normalized output: ${path.relative(ROOT, normalizedPath).replace(/\\/g, '/')}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
