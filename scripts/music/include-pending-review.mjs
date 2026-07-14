import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const DEFAULT_PARTS_DIR = 'public/data/libraries/music/additional-data/factcheck-pending'
const DEFAULT_EXCLUDED_INPUT = 'public/data/libraries/music/additional-data/factcheck-pending/music-excluded-from-runtime.pending-review.json'
const DEFAULT_RUNTIME_GENERATED = 'public/data/music.generated.json'
const DEFAULT_RUNTIME_ITEMS = 'public/data/libraries/music/items.json'
const DEFAULT_RUNTIME_INDEX = 'public/data/libraries/music/search-index.json'
const DEFAULT_SOURCE_META = 'public/data/source.json'

const parseArgs = () => {
  const options = {
    partsDir: DEFAULT_PARTS_DIR,
    excludedInput: DEFAULT_EXCLUDED_INPUT,
    generated: DEFAULT_RUNTIME_GENERATED,
    items: DEFAULT_RUNTIME_ITEMS,
    index: DEFAULT_RUNTIME_INDEX,
    sourceMeta: DEFAULT_SOURCE_META,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--parts-dir=')) {
      const value = arg.slice('--parts-dir='.length).trim()
      if (value) options.partsDir = value
      continue
    }
    if (arg.startsWith('--excluded-input=')) {
      const value = arg.slice('--excluded-input='.length).trim()
      if (value) options.excludedInput = value
      continue
    }
    if (arg.startsWith('--generated=')) {
      const value = arg.slice('--generated='.length).trim()
      if (value) options.generated = value
      continue
    }
    if (arg.startsWith('--items=')) {
      const value = arg.slice('--items='.length).trim()
      if (value) options.items = value
      continue
    }
    if (arg.startsWith('--index=')) {
      const value = arg.slice('--index='.length).trim()
      if (value) options.index = value
      continue
    }
    if (arg.startsWith('--source-meta=')) {
      const value = arg.slice('--source-meta='.length).trim()
      if (value) options.sourceMeta = value
      continue
    }
  }

  return options
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const normalize = (value) => String(value ?? '')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const tokenize = (value) => normalize(value)
  .split(/\s+/)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2)

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

const toInteger = (value) => {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

const toYear = (value) => {
  const parsed = toInteger(value)
  return parsed != null && parsed >= 1800 && parsed <= 2100 ? parsed : null
}

const isLastfmPlaceholderImage = (url) => /2a96cbd8b46e442fc41c2b86b821562f/i.test(String(url ?? ''))

const choosePoster = (currentPoster, nextPoster) => {
  const current = String(currentPoster ?? '').trim()
  const next = String(nextPoster ?? '').trim()
  if (!next) return current || null
  if (!current) return next

  const currentPlaceholder = isLastfmPlaceholderImage(current)
  const nextPlaceholder = isLastfmPlaceholderImage(next)

  if (!currentPlaceholder && nextPlaceholder) return current
  return next
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

const mapNamedPeople = (value, limit = 6) => {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const item of value) {
    const text = String(item ?? '').trim()
    if (!text) continue
    const key = normalize(text)
    if (!key || seen.has(key)) continue
    seen.add(key)

    const hasCyrillic = /[А-Яа-яЁё]/.test(text)
    out.push({
      nameRu: hasCyrillic ? text : '',
      nameOriginal: hasCyrillic ? '' : text,
    })

    if (out.length >= limit) break
  }
  return out
}

const upsertTopEntry = (list, title) => {
  const text = String(title ?? '').trim()
  if (!text) return Array.isArray(list) ? list : []

  if (!Array.isArray(list) || list.length === 0) {
    return [{ rank: 1, title: text, source: 'factcheck' }]
  }

  const nextList = list.map((item) => ({ ...item }))
  nextList[0] = {
    ...(isObject(nextList[0]) ? nextList[0] : {}),
    rank: 1,
    title: text,
  }
  return nextList
}

const buildSearchIndex = (items) => {
  const tokenMap = new Map()

  const docs = items.map((item) => {
    const id = String(item.id)
    const names = [item.titleRu, item.titleOriginal, ...(Array.isArray(item.alternativeTitles) ? item.alternativeTitles : [])].filter(Boolean)

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

const sortItems = (items) => [...items].sort((a, b) => {
  const byTitle = String(a.titleRu ?? '').localeCompare(String(b.titleRu ?? ''), 'ru-RU')
  if (byTitle !== 0) return byTitle
  return String(a.id ?? '').localeCompare(String(b.id ?? ''), 'ru-RU')
})

const readFactcheckRecords = (partsDirPath) => {
  const files = fs.readdirSync(partsDirPath)
    .filter((name) => /^music-factcheck-lite\.part-\d{2}\.json$/.test(name))
    .sort((a, b) => a.localeCompare(b, 'en-US'))

  if (!files.length) {
    throw new Error(`Factcheck parts not found in ${path.relative(ROOT, partsDirPath).replace(/\\/g, '/')}`)
  }

  const records = []
  for (const fileName of files) {
    const filePath = path.join(partsDirPath, fileName)
    const payload = readJson(filePath)
    const partRecords = Array.isArray(payload?.records) ? payload.records : []

    if (Number.isFinite(Number(payload?.meta?.recordsInPart)) && Number(payload.meta.recordsInPart) !== partRecords.length) {
      throw new Error(`Invalid meta.recordsInPart in ${fileName}: expected ${partRecords.length}, got ${payload.meta.recordsInPart}`)
    }

    for (const record of partRecords) records.push(record)
  }

  const artistKeySet = new Set()
  const queueSet = new Set()
  for (const record of records) {
    const artistKey = String(record?.artistKey ?? '').trim()
    const queueIndex = Number(record?.queueIndex)

    if (!artistKey) throw new Error('Factcheck record without artistKey')
    if (!Number.isFinite(queueIndex)) throw new Error(`Invalid queueIndex for artistKey ${artistKey}`)
    if (artistKeySet.has(artistKey)) throw new Error(`Duplicate artistKey in factcheck parts: ${artistKey}`)
    if (queueSet.has(queueIndex)) throw new Error(`Duplicate queueIndex in factcheck parts: ${queueIndex}`)

    artistKeySet.add(artistKey)
    queueSet.add(queueIndex)
  }

  return { files, records }
}

const applyFactcheckPatch = (baseItem, record) => {
  const next = JSON.parse(JSON.stringify(baseItem))
  const current = isObject(record?.current) ? record.current : {}
  const changed = new Set()

  const oldTitleRu = String(next.titleRu ?? '').trim()
  const oldTitleOriginal = String(next.titleOriginal ?? '').trim()

  const canonicalName = String(current.canonicalName ?? '').trim()
  const displayNameRu = String(current.displayNameRu ?? '').trim()
  const displayNameEn = String(current.displayNameEn ?? '').trim()
  const country = String(current.country ?? '').trim()
  const topTrack = String(current.topTrack ?? '').trim()
  const topAlbum = String(current.topAlbum ?? '').trim()

  const nextTitleRu = displayNameRu || canonicalName || oldTitleRu
  const nextTitleOriginal = displayNameEn || canonicalName || oldTitleOriginal || nextTitleRu

  if (nextTitleRu && nextTitleRu !== next.titleRu) {
    next.titleRu = nextTitleRu
    changed.add('titleRu')
  }
  if (nextTitleOriginal && nextTitleOriginal !== next.titleOriginal) {
    next.titleOriginal = nextTitleOriginal
    changed.add('titleOriginal')
  }

  const altTitles = uniqueStrings([
    ...(Array.isArray(next.alternativeTitles) ? next.alternativeTitles : []),
    oldTitleRu,
    oldTitleOriginal,
    canonicalName,
    displayNameEn,
    String(record?.artist ?? '').trim(),
    String(current.realName ?? '').trim(),
  ]).filter((title) => normalize(title) !== normalize(String(next.titleRu ?? '')) && normalize(title) !== normalize(String(next.titleOriginal ?? '')))
  if (JSON.stringify(altTitles) !== JSON.stringify(next.alternativeTitles ?? [])) {
    next.alternativeTitles = altTitles
    changed.add('alternativeTitles')
  }

  const beginYear = toYear(current.beginYear)
  if (beginYear != null && beginYear !== next.activityStartYear) {
    next.activityStartYear = beginYear
    delete next.year
    changed.add('activityStartYear')
    changed.add('year')
  }

  if (typeof current.isActive === 'boolean' && current.isActive !== next.musicIsActive) {
    next.musicIsActive = current.isActive
    changed.add('musicIsActive')
  }

  if (country) {
    const mergedCountries = uniqueStrings([country, ...(Array.isArray(next.countries) ? next.countries : [])])
    if (JSON.stringify(mergedCountries) !== JSON.stringify(next.countries ?? [])) {
      next.countries = mergedCountries
      changed.add('countries')
    }
  }

  const nextPoster = choosePoster(next.posterUrl, current.posterUrl)
  if (nextPoster !== next.posterUrl) {
    next.posterUrl = nextPoster
    changed.add('posterUrl')
  }

  if (topTrack && topTrack !== next.slogan) {
    next.slogan = topTrack
    changed.add('slogan')
  }
  if (topTrack) {
    const topTracks = upsertTopEntry(next.topTracks, topTrack)
    if (JSON.stringify(topTracks) !== JSON.stringify(next.topTracks ?? [])) {
      next.topTracks = topTracks
      changed.add('topTracks')
    }
  }

  if (topAlbum) {
    const topAlbums = upsertTopEntry(next.topAlbums, topAlbum)
    if (JSON.stringify(topAlbums) !== JSON.stringify(next.topAlbums ?? [])) {
      next.topAlbums = topAlbums
      changed.add('topAlbums')
    }
  }

  if (Array.isArray(current.genres) && current.genres.length) {
    const genres = uniqueStrings(current.genres)
    if (JSON.stringify(genres) !== JSON.stringify(next.genres ?? [])) {
      next.genres = genres
      changed.add('genres')
    }
  }

  if (Array.isArray(current.associatedActs) && current.associatedActs.length) {
    const directors = mapNamedPeople(current.associatedActs)
    if (JSON.stringify(directors) !== JSON.stringify(next.directors ?? [])) {
      next.directors = directors
      changed.add('directors')
    }
  }

  const reasons = uniqueStrings(Array.isArray(record?.unresolvedReasons) ? record.unresolvedReasons : [])
  if (JSON.stringify(reasons) !== JSON.stringify(next.notes ?? [])) {
    next.notes = reasons
    changed.add('notes')
  }

  const enriched = isObject(record?.enriched) ? record.enriched : {}
  const manualReview = Boolean(enriched.manualReview)
  const missingFields = [
    !Array.isArray(next.topTracks) || !next.topTracks.length ? 'topTracks' : null,
    !Array.isArray(next.topAlbums) || !next.topAlbums.length ? 'topAlbums' : null,
    !Array.isArray(next.genres) || !next.genres.length ? 'genres' : null,
  ].filter(Boolean)

  const oldDataQuality = isObject(next.dataQuality) ? next.dataQuality : {}
  const dataQuality = {
    ...oldDataQuality,
    source: uniqueStrings([...(Array.isArray(oldDataQuality.source) ? oldDataQuality.source : []), 'factcheck']),
    verified: reasons.length === 0 && !manualReview,
    missingFields,
  }
  if (JSON.stringify(dataQuality) !== JSON.stringify(next.dataQuality ?? {})) {
    next.dataQuality = dataQuality
    changed.add('dataQuality')
  }

  const rank = toInteger(record?.rank)
  if (rank != null && rank > 0 && rank !== next.topRank) {
    next.topRank = rank
    changed.add('topRank')
  }

  const artistType = String(enriched.artistType ?? '').trim()
  if (artistType) {
    const normalizedType = artistType[0].toUpperCase() + artistType.slice(1)
    if (normalizedType !== String(next.musicType ?? '')) {
      next.musicType = normalizedType
      changed.add('musicType')
    }
  }

  const description = buildDescription({
    canonicalName: canonicalName || next.titleOriginal || next.titleRu,
    country: country || (Array.isArray(next.countries) ? String(next.countries[0] ?? '').trim() : ''),
    genres: Array.isArray(next.genres) ? next.genres : [],
    topTrack: topTrack || String(next.slogan ?? '').trim(),
  })

  if (description && description !== next.description) {
    next.description = description
    next.shortDescription = description
    next.plotHint = description
    changed.add('description')
  }

  return { item: next, changed }
}

const incrementCount = (counterMap, key) => {
  counterMap.set(key, (counterMap.get(key) ?? 0) + 1)
}

const main = () => {
  const options = parseArgs()

  const partsDirPath = path.isAbsolute(options.partsDir) ? options.partsDir : path.join(ROOT, options.partsDir)
  const excludedInputPath = path.isAbsolute(options.excludedInput) ? options.excludedInput : path.join(ROOT, options.excludedInput)
  const generatedPath = path.isAbsolute(options.generated) ? options.generated : path.join(ROOT, options.generated)
  const itemsPath = path.isAbsolute(options.items) ? options.items : path.join(ROOT, options.items)
  const indexPath = path.isAbsolute(options.index) ? options.index : path.join(ROOT, options.index)
  const sourceMetaPath = path.isAbsolute(options.sourceMeta) ? options.sourceMeta : path.join(ROOT, options.sourceMeta)

  if (!fs.existsSync(partsDirPath)) throw new Error(`Parts directory not found: ${path.relative(ROOT, partsDirPath)}`)
  if (!fs.existsSync(excludedInputPath)) throw new Error(`Excluded snapshot not found: ${path.relative(ROOT, excludedInputPath)}`)
  if (!fs.existsSync(generatedPath)) throw new Error(`Runtime generated file not found: ${path.relative(ROOT, generatedPath)}`)

  const { files, records } = readFactcheckRecords(partsDirPath)
  const excludedPayload = readJson(excludedInputPath)
  const excludedItems = Array.isArray(excludedPayload?.items) ? excludedPayload.items : []
  const excludedById = new Map(excludedItems.map((item) => [String(item?.id ?? '').trim(), item]).filter(([id]) => id))

  if (!excludedById.size) throw new Error('Excluded snapshot has no items to import')

  const missingInExcluded = []
  const updatedById = new Map()
  const changeCounters = new Map()

  for (const record of records) {
    const artistKey = String(record?.artistKey ?? '').trim()
    const id = String(record?.id ?? `music:${artistKey}`).trim()

    if (!artistKey) throw new Error('Factcheck record contains empty artistKey')
    if (!id) throw new Error(`Factcheck record contains empty id for artistKey ${artistKey}`)

    const baseItem = excludedById.get(id)
    if (!baseItem) {
      missingInExcluded.push(id)
      continue
    }

    const { item, changed } = applyFactcheckPatch(baseItem, record)
    updatedById.set(id, item)
    for (const key of changed) incrementCount(changeCounters, key)
  }

  if (missingInExcluded.length) {
    throw new Error(`Factcheck records are missing in excluded snapshot: ${missingInExcluded.slice(0, 10).join(', ')}${missingInExcluded.length > 10 ? ' ...' : ''}`)
  }

  const runtimeItems = readJson(generatedPath)
  if (!Array.isArray(runtimeItems)) throw new Error('Runtime generated file must contain an array')

  const mergedById = new Map(runtimeItems.map((item) => [String(item?.id ?? '').trim(), item]).filter(([id]) => id))
  for (const [id, item] of updatedById) mergedById.set(id, item)

  const mergedItems = sortItems([...mergedById.values()])
  const searchIndex = buildSearchIndex(mergedItems)

  writeJson(generatedPath, mergedItems)
  writeJson(itemsPath, mergedItems)
  writeJson(indexPath, searchIndex)

  if (fs.existsSync(sourceMetaPath)) {
    const sourceMeta = readJson(sourceMetaPath)
    if (isObject(sourceMeta)) {
      sourceMeta.musicCount = mergedItems.length
      sourceMeta.musicExcludedPendingReview = 0
      sourceMeta.musicGeneratedAt = new Date().toISOString()
      writeJson(sourceMetaPath, sourceMeta)
    }
  }

  const changeSummary = [...changeCounters.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en-US'))
    .map(([field, count]) => `${field}:${count}`)

  console.log(`Factcheck part files: ${files.length}`)
  console.log(`Factcheck records: ${records.length}`)
  console.log(`Excluded snapshot records: ${excludedItems.length}`)
  console.log(`Imported back to runtime: ${updatedById.size}`)
  console.log(`Runtime pool size: ${mergedItems.length}`)
  console.log(`Updated: ${path.relative(ROOT, generatedPath).replace(/\\/g, '/')}`)
  console.log(`Updated: ${path.relative(ROOT, itemsPath).replace(/\\/g, '/')}`)
  console.log(`Updated: ${path.relative(ROOT, indexPath).replace(/\\/g, '/')}`)
  console.log(`Field updates: ${changeSummary.join(', ') || 'none'}`)
}

main()
