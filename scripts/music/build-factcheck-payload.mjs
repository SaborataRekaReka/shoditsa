import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DEFAULT_INPUT = 'data/music/normalized/music_artists_enriched_first500_merged_retry_batched.resolved.json'
const DEFAULT_REPORT = 'docs/music-manual-review-report.after-rules.json'
const DEFAULT_OUTPUT = 'docs/music-factcheck-payload.after-rules.json'
const SOURCE_PRIORITY = ['input', 'musicbrainz', 'lastfm', 'wikidata', 'theaudiodb', 'spotify', 'derived']
const SOURCE_RANK = new Map(SOURCE_PRIORITY.map((source, index) => [source, index]))

const parseArgs = () => {
  const options = {
    input: DEFAULT_INPUT,
    report: DEFAULT_REPORT,
    output: DEFAULT_OUTPUT,
    limit: null,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--input=')) {
      const value = arg.slice('--input='.length).trim()
      if (value) options.input = value
      continue
    }
    if (arg.startsWith('--report=')) {
      const value = arg.slice('--report='.length).trim()
      if (value) options.report = value
      continue
    }
    if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim()
      if (value) options.output = value
      continue
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10)
      if (Number.isFinite(parsed) && parsed > 0) options.limit = parsed
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
const asArray = (value) => (Array.isArray(value) ? value : [])

const asString = (value) => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeText = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/\s+/g, ' ')
  .trim()

const uniqueStrings = (values) => {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (!text) continue
    const key = normalizeText(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

const sourceRank = (source) => {
  const key = String(source ?? '').trim()
  if (!key) return Number.MAX_SAFE_INTEGER
  return SOURCE_RANK.get(key) ?? Number.MAX_SAFE_INTEGER
}

const getPrimary = (entry, fieldName, fallback = null) => {
  const field = entry?.[fieldName]
  if (isObject(field) && Object.prototype.hasOwnProperty.call(field, 'primaryValue')) {
    return field.primaryValue
  }
  return fallback
}

const getEvidence = (entry, fieldName) => {
  const field = entry?.[fieldName]
  if (isObject(field) && Array.isArray(field.sourceEvidence)) return field.sourceEvidence
  const sourceEvidence = entry?.sourceEvidence
  if (isObject(sourceEvidence) && Array.isArray(sourceEvidence[fieldName])) return sourceEvidence[fieldName]
  return []
}

const flattenStringValues = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStringValues(item))
  }
  const text = asString(value)
  return text ? [text] : []
}

const extractLinkUrls = (value) => {
  if (!Array.isArray(value)) return []
  const urls = []
  for (const item of value) {
    if (typeof item === 'string') {
      const url = asString(item)
      if (url) urls.push(url)
      continue
    }
    const url = asString(item?.url)
    if (url) urls.push(url)
  }
  return uniqueStrings(urls)
}

const extractImageUrls = (value) => {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (typeof item === 'string') {
      const text = asString(item)
      if (text) out.push(text)
      continue
    }
    const url = asString(item?.url)
    if (url) out.push(url)
  }
  return uniqueStrings(out)
}

const collectOptionStats = (evidenceList, expandValues) => {
  const optionMap = new Map()

  for (const entry of asArray(evidenceList)) {
    const source = asString(entry?.source) ?? 'unknown'
    const values = expandValues(entry?.value)
    for (const value of values) {
      const key = typeof value === 'string' ? normalizeText(value) : JSON.stringify(value)
      if (!key) continue
      if (!optionMap.has(key)) {
        optionMap.set(key, {
          value,
          sources: new Set(),
        })
      }
      optionMap.get(key).sources.add(source)
    }
  }

  return [...optionMap.values()]
    .map((option) => {
      const sources = [...option.sources].sort((a, b) => sourceRank(a) - sourceRank(b) || a.localeCompare(b, 'ru-RU'))
      return {
        value: option.value,
        sourceCount: sources.length,
        sources,
      }
    })
    .sort((a, b) => {
      if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount
      const ar = sourceRank(a.sources[0])
      const br = sourceRank(b.sources[0])
      if (ar !== br) return ar - br
      return String(a.value).localeCompare(String(b.value), 'ru-RU')
    })
}

const topTracks = (entry) => asArray(getPrimary(entry, 'topTracks', []))
  .map((item) => {
    const title = asString(item?.title)
    if (!title) return null
    return {
      rank: toNumber(item?.rank),
      title,
      listeners: toNumber(item?.listeners),
      playcount: toNumber(item?.playcount),
      source: asString(item?.source),
    }
  })
  .filter(Boolean)
  .slice(0, 5)

const topAlbums = (entry) => asArray(getPrimary(entry, 'topAlbums', []))
  .map((item) => {
    const title = asString(item?.title)
    if (!title) return null
    return {
      rank: toNumber(item?.rank),
      title,
      listeners: toNumber(item?.listeners),
      source: asString(item?.source),
    }
  })
  .filter(Boolean)
  .slice(0, 5)

const findDisplayName = (entry) => asString(getPrimary(entry, 'displayNameRu'))
  || asString(getPrimary(entry, 'displayNameEn'))
  || asString(getPrimary(entry, 'canonicalName'))
  || asString(entry?.input?.artist)
  || asString(entry?.artistKey)
  || 'unknown'

const reasonCounts = (artists) => {
  const counts = new Map()
  for (const artist of artists) {
    for (const reason of asArray(artist?.reasons)) {
      const key = asString(reason)
      if (!key) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'ru-RU'))
}

const buildRecord = (normalizedEntry, reportEntry, index) => {
  const canonicalEvidence = collectOptionStats(getEvidence(normalizedEntry, 'canonicalName'), (value) => {
    const text = asString(value)
    return text ? [text] : []
  })
  const countryEvidence = collectOptionStats(getEvidence(normalizedEntry, 'country'), (value) => {
    const text = asString(value)
    return text ? [text] : []
  })
  const beginYearEvidence = collectOptionStats(getEvidence(normalizedEntry, 'beginYear'), (value) => {
    const year = toNumber(value)
    return Number.isFinite(year) ? [Math.trunc(year)] : []
  })
  const imageEvidence = collectOptionStats(getEvidence(normalizedEntry, 'imageCandidates'), (value) => extractImageUrls(value))

  return {
    queueIndex: index + 1,
    artistKey: asString(normalizedEntry?.artistKey) ?? asString(reportEntry?.artistKey) ?? `unknown-${index + 1}`,
    id: `music:${asString(normalizedEntry?.artistKey) ?? asString(reportEntry?.artistKey) ?? `unknown-${index + 1}`}`,
    rank: toNumber(normalizedEntry?.input?.rank) ?? toNumber(reportEntry?.rank),
    artist: findDisplayName(normalizedEntry),
    unresolvedReasons: uniqueStrings(asArray(reportEntry?.reasons).map((reason) => asString(reason)).filter(Boolean)),
    sourceStatus: isObject(reportEntry?.sourceStatus) ? reportEntry.sourceStatus : (isObject(normalizedEntry?.pipeline?.sourceStatus) ? normalizedEntry.pipeline.sourceStatus : {}),
    matchConfidence: toNumber(getPrimary(normalizedEntry, 'matchConfidence')),
    current: {
      canonicalName: asString(getPrimary(normalizedEntry, 'canonicalName')),
      displayNameRu: asString(getPrimary(normalizedEntry, 'displayNameRu')),
      displayNameEn: asString(getPrimary(normalizedEntry, 'displayNameEn')),
      aliases: uniqueStrings(flattenStringValues(getPrimary(normalizedEntry, 'aliases', [])).slice(0, 20)),
      country: asString(getPrimary(normalizedEntry, 'country')),
      beginYear: toNumber(getPrimary(normalizedEntry, 'beginYear')),
      endYear: toNumber(getPrimary(normalizedEntry, 'endYear')),
      isActive: typeof getPrimary(normalizedEntry, 'isActive') === 'boolean' ? getPrimary(normalizedEntry, 'isActive') : null,
      artistType: flattenStringValues(getPrimary(normalizedEntry, 'artistType', [])).slice(0, 6),
      genres: uniqueStrings(flattenStringValues(getPrimary(normalizedEntry, 'genres', [])).slice(0, 20)),
      topTracks: topTracks(normalizedEntry),
      topAlbums: topAlbums(normalizedEntry),
      posterUrl: extractImageUrls(getPrimary(normalizedEntry, 'imageCandidates', []))[0] ?? null,
      links: uniqueStrings([
        ...extractLinkUrls(getPrimary(normalizedEntry, 'officialLinks', [])),
        ...extractLinkUrls(getPrimary(normalizedEntry, 'socialLinks', [])),
      ]).slice(0, 20),
    },
    evidenceSummary: {
      canonicalNameOptions: canonicalEvidence.slice(0, 8),
      countryOptions: countryEvidence.slice(0, 8),
      beginYearOptions: beginYearEvidence.slice(0, 8),
      imageOptions: imageEvidence.slice(0, 8),
    },
    rawFiles: asArray(normalizedEntry?.pipeline?.rawFiles).slice(0, 50),
  }
}

const main = () => {
  const options = parseArgs()
  const inputPath = path.isAbsolute(options.input) ? options.input : path.join(ROOT, options.input)
  const reportPath = path.isAbsolute(options.report) ? options.report : path.join(ROOT, options.report)
  const outputPath = path.isAbsolute(options.output) ? options.output : path.join(ROOT, options.output)

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${path.relative(ROOT, inputPath)}`)
  }
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report file not found: ${path.relative(ROOT, reportPath)}`)
  }

  const normalizedPayload = readJson(inputPath)
  const reportPayload = readJson(reportPath)

  const normalizedItems = asArray(normalizedPayload?.items)
  const byArtistKey = new Map(normalizedItems.map((item) => [asString(item?.artistKey), item]))

  let queue = asArray(reportPayload?.problematicArtists)
  if (options.limit) queue = queue.slice(0, options.limit)

  const records = queue.map((reportEntry, index) => {
    const key = asString(reportEntry?.artistKey)
    const normalizedEntry = key && byArtistKey.has(key) ? byArtistKey.get(key) : null
    return buildRecord(normalizedEntry ?? {}, reportEntry, index)
  })

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      normalizedInput: path.relative(ROOT, inputPath).replace(/\\/g, '/'),
      reportInput: path.relative(ROOT, reportPath).replace(/\\/g, '/'),
      totalNormalizedItems: normalizedItems.length,
      reviewRecords: records.length,
      sourcePriority: SOURCE_PRIORITY,
      reasonCounts: reasonCounts(queue),
    },
    instructionsForModel: {
      goal: 'Провести фактчек каждого артиста и вернуть решения в формате decisions[].',
      returnJsonOnly: true,
      doNotRewriteInput: true,
      decisionRules: [
        'Если данных достаточно и текущее значение корректно: status=ok.',
        'Если нужно исправление: status=update и заполнить patch.',
        'Если артист не найден/данные недостоверны: status=not_found или status=uncertain.',
        'Для patch.country использовать ISO-код (например RU, KR, GB, US, USSR).',
        'Для patch.beginYear использовать число или null.',
        'Если предлагаете изменить постер, укажите patch.posterUrl и sourceUrls с подтверждением.',
      ],
      responseSchema: {
        decisions: [
          {
            artistKey: 'string',
            status: 'ok | update | not_found | uncertain',
            confidence: 0.0,
            patch: {
              canonicalName: null,
              displayNameRu: null,
              displayNameEn: null,
              aliases: null,
              country: null,
              beginYear: null,
              endYear: null,
              isActive: null,
              posterUrl: null,
            },
            removeReasons: [],
            addReasons: [],
            sourceUrls: [],
            comment: '',
          },
        ],
      },
    },
    records,
  }

  writeJson(outputPath, payload)

  console.log(`Normalized input: ${path.relative(ROOT, inputPath).replace(/\\/g, '/')}`)
  console.log(`Report input: ${path.relative(ROOT, reportPath).replace(/\\/g, '/')}`)
  console.log(`Records: ${records.length}`)
  console.log(`Output: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`)
}

main()