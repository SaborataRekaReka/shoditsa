import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const DEFAULT_PARTS_DIR = 'public/data/libraries/music/additional-data/factcheck-pending'
const DEFAULT_INPUT = 'public/data/libraries/music/items.json'
const DEFAULT_OUTPUT_PREFIX = 'docs/music-hints-payload'
const DEFAULT_CHUNK_SIZE = 40
const DEFAULT_MIN_HINT_CHARS = 95
const DEFAULT_MAX_HINT_CHARS = 170

const STOP_TOKENS = new Set([
  'the',
  'and',
  'that',
  'this',
  'from',
  'into',
  'over',
  'under',
  'after',
  'before',
  'during',
  'while',
  'their',
  'there',
  'where',
  'whose',
  'feat',
  'with',
  'music',
  'artist',
  'group',
  'band',
  'official',
  'radio',
  'live',
  'song',
  'track',
  'album',
  'artist',
  'музыка',
  'музыкальный',
  'артист',
  'группа',
  'песня',
  'трек',
  'альбом',
  'официальный',
  'живой',
  'версия',
  'этот',
  'эта',
  'это',
  'эти',
  'того',
  'чтобы',
  'когда',
  'после',
  'перед',
  'через',
  'между',
  'вокруг',
  'feat',
])

const parseArgs = () => {
  const options = {
    partsDir: DEFAULT_PARTS_DIR,
    input: DEFAULT_INPUT,
    outputPrefix: DEFAULT_OUTPUT_PREFIX,
    chunkSize: DEFAULT_CHUNK_SIZE,
    limit: null,
    minHintChars: DEFAULT_MIN_HINT_CHARS,
    maxHintChars: DEFAULT_MAX_HINT_CHARS,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--parts-dir=')) {
      const value = arg.slice('--parts-dir='.length).trim()
      if (value) options.partsDir = value
      continue
    }

    if (arg.startsWith('--input=')) {
      const value = arg.slice('--input='.length).trim()
      if (value) options.input = value
      continue
    }

    if (arg.startsWith('--output-prefix=')) {
      const value = arg.slice('--output-prefix='.length).trim()
      if (value) options.outputPrefix = value
      continue
    }

    if (arg.startsWith('--chunk-size=')) {
      const value = Number.parseInt(arg.slice('--chunk-size='.length), 10)
      if (Number.isFinite(value) && value > 0) options.chunkSize = value
      continue
    }

    if (arg.startsWith('--limit=')) {
      const value = Number.parseInt(arg.slice('--limit='.length), 10)
      if (Number.isFinite(value) && value > 0) options.limit = value
      continue
    }

    if (arg.startsWith('--min-hint-chars=')) {
      const value = Number.parseInt(arg.slice('--min-hint-chars='.length), 10)
      if (Number.isFinite(value) && value > 20) options.minHintChars = value
      continue
    }

    if (arg.startsWith('--max-hint-chars=')) {
      const value = Number.parseInt(arg.slice('--max-hint-chars='.length), 10)
      if (Number.isFinite(value) && value > 30) options.maxHintChars = value
      continue
    }
  }

  if (options.maxHintChars < options.minHintChars) {
    throw new Error('max-hint-chars must be greater than or equal to min-hint-chars')
  }

  return options
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const asArray = (value) => (Array.isArray(value) ? value : [])

const asString = (value) => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[\u2019']/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const tokenize = (value) => normalize(value)
  .split(/[^a-zа-я0-9]+/i)
  .map((token) => token.trim())
  .filter((token) => token.length >= 3)

const uniqueStrings = (values) => {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const text = asString(value)
    if (!text) continue
    const key = normalize(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

const toInt = (value) => {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

const primaryValue = (value, fallback = null) => {
  if (isObject(value) && Object.prototype.hasOwnProperty.call(value, 'primaryValue')) {
    return value.primaryValue
  }
  return fallback
}

const makeArtistKey = (index, value) => {
  const text = asString(value)
  if (text) return text
  return `music_${String(index + 1).padStart(4, '0')}`
}

const linksFromValue = (value) => {
  const out = []
  for (const item of asArray(value)) {
    if (typeof item === 'string') {
      out.push(item)
      continue
    }
    const url = asString(item?.url)
    if (url) out.push(url)
  }
  return uniqueStrings(out)
}

const mapFromLibraryItem = (item, index) => {
  const artistKey = makeArtistKey(index, asString(item?.id)?.replace(/^music:/, ''))
  const titleRu = asString(item?.titleRu)
  const titleOriginal = asString(item?.titleOriginal)

  return {
    queueIndex: index + 1,
    artistKey,
    id: asString(item?.id) || `music:${artistKey}`,
    rank: toInt(item?.topRank),
    artist: titleRu || titleOriginal || artistKey,
    unresolvedReasons: asArray(item?.notes),
    sourceUrls: linksFromValue(item?.musicLinks),
    current: {
      canonicalName: titleOriginal || titleRu || artistKey,
      displayNameRu: titleRu,
      displayNameEn: titleOriginal,
      country: asString(asArray(item?.countries)[0]),
      beginYear: toInt(item?.year),
      endYear: toInt(item?.endYear),
      isActive: typeof item?.musicIsActive === 'boolean' ? item.musicIsActive : null,
      artistType: asString(item?.musicType),
      originCity: asString(asArray(item?.countries)[2]),
      genres: asArray(item?.genres),
      associatedActs: [],
      members: [],
      topTracks: asArray(item?.topTracks),
      topAlbums: asArray(item?.topAlbums),
      seedFacts: asArray(item?.facts).slice(0, 6),
    },
  }
}

const mapFromNormalizedItem = (item, index) => {
  const artistKey = makeArtistKey(index, item?.artistKey)
  const canonicalName = asString(primaryValue(item?.canonicalName))
  const displayNameRu = asString(primaryValue(item?.displayNameRu))
  const displayNameEn = asString(primaryValue(item?.displayNameEn))

  const officialLinks = linksFromValue(primaryValue(item?.officialLinks, []))
  const socialLinks = linksFromValue(primaryValue(item?.socialLinks, []))

  return {
    queueIndex: toInt(item?.input?.position) || index + 1,
    artistKey,
    id: `music:${artistKey}`,
    rank: toInt(item?.input?.rank),
    artist: displayNameRu || displayNameEn || canonicalName || artistKey,
    unresolvedReasons: asArray(item?.manualReviewReason),
    sourceUrls: uniqueStrings([...officialLinks, ...socialLinks]),
    current: {
      canonicalName,
      displayNameRu,
      displayNameEn,
      country: asString(primaryValue(item?.country)),
      beginYear: toInt(primaryValue(item?.beginYear)),
      endYear: toInt(primaryValue(item?.endYear)),
      isActive: typeof primaryValue(item?.isActive) === 'boolean' ? primaryValue(item?.isActive) : null,
      artistType: asString(primaryValue(item?.artistType)),
      originCity: asString(primaryValue(item?.city)) || asString(primaryValue(item?.area)),
      genres: asArray(primaryValue(item?.genres, [])),
      associatedActs: asArray(primaryValue(item?.associatedActs, [])),
      members: asArray(primaryValue(item?.members, [])),
      topTracks: asArray(primaryValue(item?.topTracks, [])),
      topAlbums: asArray(primaryValue(item?.topAlbums, [])),
      seedFacts: [],
    },
  }
}

const readFactcheckRecords = (partsDirPath) => {
  const files = fs.readdirSync(partsDirPath)
    .filter((name) => /^music-factcheck-lite\.part-\d{2}\.json$/.test(name))
    .sort((a, b) => a.localeCompare(b, 'en-US'))

  if (!files.length) {
    throw new Error(`No factcheck part files found in ${path.relative(ROOT, partsDirPath).replace(/\\/g, '/')}`)
  }

  const records = []
  for (const fileName of files) {
    const filePath = path.join(partsDirPath, fileName)
    const payload = readJson(filePath)
    const partRecords = asArray(payload?.records)
    for (const record of partRecords) records.push(record)
  }

  return { files, records }
}

const loadSourceRecords = ({ inputPath, partsDirPath }) => {
  if (fs.existsSync(inputPath)) {
    const payload = readJson(inputPath)

    if (Array.isArray(payload)) {
      const hasCurrentShape = payload.some((item) => isObject(item) && (isObject(item.current) || asString(item.artistKey)))
      const records = hasCurrentShape
        ? payload
        : payload.map((item, index) => mapFromLibraryItem(item, index))

      return {
        sourceKind: hasCurrentShape ? 'records-array' : 'items-array',
        sourceRef: path.relative(ROOT, inputPath).replace(/\\/g, '/'),
        sourcePartFiles: [],
        records,
      }
    }

    if (isObject(payload) && Array.isArray(payload.records)) {
      return {
        sourceKind: 'payload.records',
        sourceRef: path.relative(ROOT, inputPath).replace(/\\/g, '/'),
        sourcePartFiles: [],
        records: payload.records,
      }
    }

    if (isObject(payload) && Array.isArray(payload.items)) {
      const looksLikeNormalized = payload.items.some((item) => isObject(item?.canonicalName) || asString(item?.artistKey))
      const records = looksLikeNormalized
        ? payload.items.map((item, index) => mapFromNormalizedItem(item, index))
        : payload.items.map((item, index) => mapFromLibraryItem(item, index))

      return {
        sourceKind: looksLikeNormalized ? 'payload.items.normalized' : 'payload.items.runtime',
        sourceRef: path.relative(ROOT, inputPath).replace(/\\/g, '/'),
        sourcePartFiles: [],
        records,
      }
    }

    throw new Error(`Unsupported input JSON shape: ${path.relative(ROOT, inputPath).replace(/\\/g, '/')}`)
  }

  if (!fs.existsSync(partsDirPath)) {
    throw new Error(
      `Input not found (${path.relative(ROOT, inputPath).replace(/\\/g, '/')}) and parts dir not found (${path.relative(ROOT, partsDirPath).replace(/\\/g, '/')})`
    )
  }

  const { files, records } = readFactcheckRecords(partsDirPath)
  return {
    sourceKind: 'factcheck-parts',
    sourceRef: path.relative(ROOT, partsDirPath).replace(/\\/g, '/'),
    sourcePartFiles: files,
    records,
  }
}

const collectFromTopList = (value) => asArray(value)
  .map((item) => asString(item?.title) || asString(item?.name) || asString(item))
  .filter(Boolean)

const buildSearchQueries = ({ artistNames, country, genres, associatedActs }) => {
  const primary = artistNames[0] || ''
  const firstGenre = genres[0] || ''
  const firstAct = associatedActs[0] || ''

  const queries = uniqueStrings([
    primary ? `${primary} interesting fact` : null,
    primary ? `${primary} biography` : null,
    primary ? `${primary} interview` : null,
    primary && country ? `${primary} ${country} music` : null,
    primary && firstGenre ? `${primary} ${firstGenre} scene` : null,
    primary && firstAct ? `${primary} ${firstAct} collaboration` : null,
    primary ? `${primary} wikipedia` : null,
    primary ? `${primary} musicbrainz` : null,
  ])

  return queries.slice(0, 8)
}

const buildBannedTokens = (bannedPhrases) => {
  const tokenSet = new Set()
  for (const phrase of bannedPhrases) {
    for (const token of tokenize(phrase)) {
      if (token.length < 4) continue
      if (STOP_TOKENS.has(token)) continue
      tokenSet.add(token)
    }
  }
  return [...tokenSet].sort((a, b) => a.localeCompare(b, 'ru-RU')).slice(0, 120)
}

const buildHintRecord = (record, constraints) => {
  const current = isObject(record?.current) ? record.current : {}

  const artistNames = uniqueStrings([
    asString(current.canonicalName),
    asString(current.displayNameRu),
    asString(current.displayNameEn),
    asString(record?.artist),
    asString(current.realName),
    ...asArray(current.aliases).map((item) => asString(item)),
  ])

  const topTracks = uniqueStrings([
    asString(current.topTrack),
    ...collectFromTopList(current.topTracks),
  ]).slice(0, 8)

  const topAlbums = uniqueStrings([
    asString(current.topAlbum),
    ...collectFromTopList(current.topAlbums),
  ]).slice(0, 8)

  const associatedActs = uniqueStrings(asArray(current.associatedActs).map((item) => asString(item))).slice(0, 8)
  const members = uniqueStrings(collectFromTopList(current.members)).slice(0, 8)
  const genres = uniqueStrings(asArray(current.genres).map((item) => asString(item))).slice(0, 8)
  const seedFacts = uniqueStrings(asArray(current.seedFacts).map((item) => asString(item))).slice(0, 6)

  const bannedPhrases = uniqueStrings([
    ...artistNames,
    ...topTracks,
    ...topAlbums,
    ...associatedActs,
    ...members,
  ]).slice(0, 120)

  const bannedTokens = buildBannedTokens(bannedPhrases)

  const sourceUrls = uniqueStrings(asArray(record?.sourceUrls).map((url) => asString(url))).slice(0, 10)

  const country = asString(current.country)
  const beginYear = toInt(current.beginYear)
  const endYear = toInt(current.endYear)
  const birthYear = toInt(current.birthYear)
  const careerStartYear = toInt(current.careerStartYear)

  return {
    queueIndex: toInt(record?.queueIndex),
    artistKey: asString(record?.artistKey) || `unknown_${Math.random().toString(36).slice(2, 8)}`,
    id: asString(record?.id) || null,
    rank: toInt(record?.rank),
    subject: {
      names: artistNames,
      country,
      beginYear,
      endYear,
      birthYear,
      careerStartYear,
      artistType: asString(current.artistType),
      originCity: asString(current.originCity) || asString(current.city),
      birthPlace: asString(current.birthPlace),
      genres,
      associatedActs,
      members,
      topTracks,
      topAlbums,
      seedFacts,
      unresolvedReasons: uniqueStrings(asArray(record?.unresolvedReasons).map((item) => asString(item))),
    },
    searchHints: {
      suggestedQueries: buildSearchQueries({
        artistNames,
        country,
        genres,
        associatedActs,
      }),
      seedSourceUrls: sourceUrls,
      sourcePriority: ['wikipedia', 'musicbrainz', 'wikidata', 'official site', 'major media'],
    },
    antiSpoiler: {
      bannedPhrases,
      bannedTokens,
      minHintChars: constraints.minHintChars,
      maxHintChars: constraints.maxHintChars,
      maxSentences: 2,
      maxLines: 2,
      language: 'ru',
    },
  }
}

const chunksOf = (items, chunkSize) => {
  const result = []
  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize))
  }
  return result
}

const main = () => {
  const options = parseArgs()
  const partsDirPath = path.isAbsolute(options.partsDir) ? options.partsDir : path.join(ROOT, options.partsDir)
  const inputPath = path.isAbsolute(options.input) ? options.input : path.join(ROOT, options.input)
  const outputPrefixPath = path.isAbsolute(options.outputPrefix) ? options.outputPrefix : path.join(ROOT, options.outputPrefix)

  const source = loadSourceRecords({ inputPath, partsDirPath })
  const records = asArray(source.records)
  const selected = options.limit ? records.slice(0, options.limit) : records

  const hintRecords = selected.map((record) => buildHintRecord(record, {
    minHintChars: options.minHintChars,
    maxHintChars: options.maxHintChars,
  }))

  const chunks = chunksOf(hintRecords, options.chunkSize)
  const partFiles = []

  for (let index = 0; index < chunks.length; index += 1) {
    const partNo = index + 1
    const filePath = `${outputPrefixPath}.part-${String(partNo).padStart(2, '0')}.json`

    const payload = {
      meta: {
        generatedAt: new Date().toISOString(),
        sourceKind: source.sourceKind,
        sourceRef: source.sourceRef,
        sourcePartFiles: source.sourcePartFiles,
        outputPrefix: path.relative(ROOT, outputPrefixPath).replace(/\\/g, '/'),
        part: partNo,
        partsTotal: chunks.length,
        recordsInPart: chunks[index].length,
        totalRecords: hintRecords.length,
      },
      instructionsForModel: {
        goal: 'Сформировать короткую, умную и безопасную подсказку про музыкального исполнителя для игры-угадайки.',
        process: [
          'Сначала используй переданный контекст subject/searchHints, чтобы понять о ком речь.',
          'Если фактов недостаточно, выполни web-поиск по suggestedQueries и seedSourceUrls.',
          'Верни только лаконичный факт-подсказку на русском языке.',
        ],
        outputRules: [
          'Возвращай только JSON без markdown и пояснений.',
          'Поле hint: 1-2 предложения, без переносов строк, длина в диапазоне minHintChars..maxHintChars.',
          'Нельзя использовать слова и фразы из antiSpoiler.bannedPhrases и antiSpoiler.bannedTokens.',
          'Нельзя упоминать названия треков/альбомов, псевдонимы, реальное имя, участников.',
          'Подсказка должна помогать сузить ответ, но не раскрывать его напрямую.',
        ],
        responseSchema: {
          decisions: [
            {
              artistKey: 'string',
              status: 'ok | uncertain | not_found',
              hint: 'string',
              confidence: 0.0,
              sourceUrls: ['https://...'],
              comment: '',
            },
          ],
        },
      },
      records: chunks[index],
    }

    writeJson(filePath, payload)
    partFiles.push(path.relative(ROOT, filePath).replace(/\\/g, '/'))
  }

  const manifestPath = `${outputPrefixPath}.manifest.json`
  writeJson(manifestPath, {
    generatedAt: new Date().toISOString(),
    sourceKind: source.sourceKind,
    sourceRef: source.sourceRef,
    sourcePartFiles: source.sourcePartFiles,
    outputPrefix: path.relative(ROOT, outputPrefixPath).replace(/\\/g, '/'),
    chunkSize: options.chunkSize,
    minHintChars: options.minHintChars,
    maxHintChars: options.maxHintChars,
    totalRecords: hintRecords.length,
    partsTotal: partFiles.length,
    partFiles,
  })

  console.log(`Source records: ${records.length}`)
  console.log(`Selected records: ${hintRecords.length}`)
  console.log(`Parts: ${partFiles.length}`)
  console.log(`Manifest: ${path.relative(ROOT, manifestPath).replace(/\\/g, '/')}`)
}

main()
