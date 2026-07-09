import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DEFAULT_INPUT = 'data/music/normalized/music_artists_enriched_first500_merged_retry_batched.json'
const DEFAULT_OUTPUT = 'data/music/normalized/music_artists_enriched_first500_merged_retry_batched.resolved.json'

const SOURCE_PRIORITY = ['input', 'musicbrainz', 'lastfm', 'wikidata', 'theaudiodb', 'spotify', 'derived']
const SOURCE_RANK = new Map(SOURCE_PRIORITY.map((source, index) => [source, index]))

const parseArgs = () => {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--input=')) {
      const value = arg.slice('--input='.length).trim()
      if (value) options.input = value
      continue
    }
    if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim()
      if (value) options.output = value
      continue
    }
  }

  return options
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value) => (Array.isArray(value) ? value : [])

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const normalizeText = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const normalizeNameKey = (value) => normalizeText(value)

const uniqueStrings = (values) => {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (!text) continue
    const key = normalizeNameKey(text)
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

const toReasonSet = (value) => new Set(
  asArray(value)
    .map((item) => String(item ?? '').trim())
    .filter(Boolean),
)

const evidenceForField = (item, fieldName) => {
  const fieldEvidence = asArray(item?.[fieldName]?.sourceEvidence)
  if (fieldEvidence.length) return fieldEvidence
  return asArray(item?.sourceEvidence?.[fieldName])
}

const syncField = (item, fieldName, primaryValue, sourceEvidence) => {
  if (!isObject(item[fieldName])) item[fieldName] = {}
  item[fieldName].primaryValue = primaryValue
  item[fieldName].sourceEvidence = sourceEvidence

  if (!isObject(item.sourceEvidence)) item.sourceEvidence = {}
  item.sourceEvidence[fieldName] = sourceEvidence
}

const dedupeEvidence = (entries) => {
  const seen = new Set()
  const out = []
  for (const entry of entries) {
    const source = String(entry?.source ?? '').trim()
    if (!source) continue
    const key = `${source}|${JSON.stringify(entry?.value)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ source, value: entry.value })
  }
  return out
}

const pickBySourceCount = (options) => {
  if (!options.length) return null
  return [...options].sort((a, b) => {
    if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount
    if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank
    return String(a.value).localeCompare(String(b.value), 'ru-RU')
  })[0]
}

const pickOptionWithInputPriority = (options) => {
  const inputOptions = options.filter((option) => option.hasInput)
  if (inputOptions.length) return pickBySourceCount(inputOptions)
  return pickBySourceCount(options)
}

const normalizeCountryValue = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const text = normalizeText(raw)
  if (!text) return null

  if (text.includes('ссср') || text.includes('soviet union') || text === 'ussr') return 'USSR'
  if (
    text === 'ru'
    || text.includes('russia')
    || text.includes('росси')
    || text.includes('rossi')
    || text.includes('russian federation')
  ) {
    return 'RU'
  }
  if (
    text === 'kr'
    || text.includes('south korea')
    || text.includes('republic of korea')
    || (text.includes('южн') && text.includes('коре'))
  ) {
    return 'KR'
  }

  if (/\busa\b/.test(text) || text.includes('united states') || text.includes('сша')) return 'US'
  if (/\buk\b/.test(text) || text.includes('united kingdom') || text.includes('great britain') || text.includes('британи')) return 'GB'

  if (/^[a-z]{2,4}$/i.test(text)) return text.toUpperCase()
  return raw
}

const toYear = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  const text = String(value ?? '').trim()
  if (!text) return null
  const match = text.match(/-?\d{1,4}/)
  if (!match) return null
  const parsed = Number.parseInt(match[0], 10)
  return Number.isFinite(parsed) ? parsed : null
}

const buildCanonicalOptions = (entries) => {
  const map = new Map()
  for (const entry of entries) {
    const source = String(entry?.source ?? '').trim()
    const value = String(entry?.value ?? '').trim()
    if (!source || !value) continue
    const key = normalizeNameKey(value)
    if (!key) continue

    if (!map.has(key)) {
      map.set(key, {
        key,
        values: new Map(),
        sources: new Set(),
        hasInput: false,
        inputValue: null,
      })
    }

    const option = map.get(key)
    option.sources.add(source)
    option.values.set(value, (option.values.get(value) ?? 0) + 1)
    if (source === 'input' && !option.inputValue) {
      option.hasInput = true
      option.inputValue = value
    }
  }

  return [...map.values()].map((option) => {
    let displayValue = option.inputValue
    if (!displayValue) {
      const sortedValues = [...option.values.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]
        if (a[0].length !== b[0].length) return a[0].length - b[0].length
        return a[0].localeCompare(b[0], 'ru-RU')
      })
      displayValue = sortedValues[0]?.[0] ?? null
    }

    const bestRank = Math.min(...[...option.sources].map((source) => sourceRank(source)))

    return {
      value: displayValue,
      sourceCount: option.sources.size,
      bestRank,
      hasInput: option.hasInput,
      sources: [...option.sources],
      variants: [...option.values.keys()],
    }
  }).filter((option) => option.value)
}

const buildSimpleOptions = (entries) => {
  const map = new Map()
  for (const entry of entries) {
    const source = String(entry?.source ?? '').trim()
    if (!source) continue
    const value = entry?.value
    if (value === null || value === undefined || value === '') continue
    const key = JSON.stringify(value)

    if (!map.has(key)) {
      map.set(key, {
        value,
        sources: new Set(),
      })
    }

    map.get(key).sources.add(source)
  }

  return [...map.values()].map((option) => ({
    value: option.value,
    sourceCount: option.sources.size,
    bestRank: Math.min(...[...option.sources].map((source) => sourceRank(source))),
    hasInput: option.sources.has('input'),
    sources: [...option.sources],
  }))
}

const cleanImageEntries = (value) => {
  const list = asArray(value)
  return list
    .map((item) => {
      const source = String(item?.source ?? '').trim()
      const url = String(item?.url ?? '').trim()
      if (!url) return null
      return {
        url,
        source: source || null,
        license: item?.license ?? null,
        attribution: item?.attribution ?? null,
      }
    })
    .filter(Boolean)
    .filter((item) => !/2a96cbd8b46e442fc41c2b86b821562f/i.test(item.url))
    .filter((item) => !/lastfm\.freetls\.fastly\.net\/i\/u\/(34s|64s|174s)\//i.test(item.url))
}

const resolveCanonicalName = (item, reasons, stats) => {
  const inputArtist = String(item?.input?.artist ?? '').trim()
  const rawEvidence = evidenceForField(item, 'canonicalName')
  const normalizedEvidence = dedupeEvidence(rawEvidence
    .map((entry) => ({
      source: String(entry?.source ?? '').trim(),
      value: String(entry?.value ?? '').trim(),
    }))
    .filter((entry) => entry.source && entry.value)
  )

  if (!normalizedEvidence.length && inputArtist) {
    normalizedEvidence.push({ source: 'input', value: inputArtist })
  }

  if (!normalizedEvidence.length) return

  const options = buildCanonicalOptions(normalizedEvidence)
  if (!options.length) return

  const selected = pickOptionWithInputPriority(options)
  if (!selected) return

  syncField(item, 'canonicalName', selected.value, normalizedEvidence)

  const existingAliases = asArray(item?.aliases?.primaryValue).map((value) => String(value ?? '').trim()).filter(Boolean)
  const optionVariants = options.flatMap((option) => option.variants)
  const nextAliases = uniqueStrings([...existingAliases, ...optionVariants])
  syncField(item, 'aliases', nextAliases, asArray(item?.aliases?.sourceEvidence))

  if (reasons.delete('conflict_canonical_name')) stats.resolvedCanonical += 1
}

const resolveCountry = (item, reasons, stats) => {
  const rawEvidence = evidenceForField(item, 'country')
  const normalizedEvidence = dedupeEvidence(rawEvidence
    .map((entry) => ({
      source: String(entry?.source ?? '').trim(),
      value: normalizeCountryValue(entry?.value),
    }))
    .filter((entry) => entry.source && entry.value)
  )

  if (!normalizedEvidence.length) return

  const options = buildSimpleOptions(normalizedEvidence)
  if (!options.length) return

  const selected = pickOptionWithInputPriority(options)
  if (!selected) return

  syncField(item, 'country', selected.value, normalizedEvidence)

  if (reasons.delete('conflict_country')) stats.resolvedCountry += 1
}

const resolveBeginYear = (item, reasons, stats) => {
  const rawEvidence = evidenceForField(item, 'beginYear')
  const normalizedEvidence = dedupeEvidence(rawEvidence
    .map((entry) => ({
      source: String(entry?.source ?? '').trim(),
      value: toYear(entry?.value),
    }))
    .filter((entry) => entry.source && Number.isFinite(entry.value) && entry.value > 0)
  )

  const options = buildSimpleOptions(normalizedEvidence)

  let selected = null
  if (options.length) {
    const non1939 = options.filter((option) => option.value !== 1939)
    const pool = non1939.length ? non1939 : options
    selected = pickOptionWithInputPriority(pool)

    if (selected?.value === 1939) {
      selected = null
      stats.yearClearedAsNoData += 1
    }
  }

  syncField(item, 'beginYear', selected ? selected.value : null, normalizedEvidence)

  if (reasons.delete('conflict_begin_year')) stats.resolvedBeginYear += 1
}

const fixAdeleImage = (item, stats) => {
  const artistKey = String(item?.artistKey ?? '').trim().toLocaleLowerCase('en-US')
  const inputArtist = String(item?.input?.artist ?? '').trim().toLocaleLowerCase('en-US')
  if (!(artistKey.endsWith('_adele') || inputArtist === 'adele')) return

  const rawEvidence = evidenceForField(item, 'imageCandidates')
  if (!rawEvidence.length) return

  const cleanedEvidence = rawEvidence
    .map((entry) => ({
      source: String(entry?.source ?? '').trim(),
      value: cleanImageEntries(entry?.value),
    }))
    .filter((entry) => entry.source && entry.value.length)

  if (!cleanedEvidence.length) return

  const spotifyBucket = cleanedEvidence.find((entry) => entry.source === 'spotify')
  const selectedBucket = spotifyBucket || [...cleanedEvidence].sort((a, b) => b.value.length - a.value.length)[0]
  if (!selectedBucket) return

  const reordered = spotifyBucket
    ? [spotifyBucket, ...cleanedEvidence.filter((entry) => entry !== spotifyBucket)]
    : cleanedEvidence

  syncField(item, 'imageCandidates', selectedBucket.value, reordered)
  stats.adeleImageAdjusted += 1
}

const main = () => {
  const options = parseArgs()
  const inputPath = path.isAbsolute(options.input) ? options.input : path.join(ROOT, options.input)
  const outputPath = path.isAbsolute(options.output) ? options.output : path.join(ROOT, options.output)

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${path.relative(ROOT, inputPath)}`)
  }

  const payload = readJson(inputPath)
  const items = asArray(payload?.items)
  const stats = {
    total: items.length,
    resolvedCanonical: 0,
    resolvedCountry: 0,
    resolvedBeginYear: 0,
    yearClearedAsNoData: 0,
    adeleImageAdjusted: 0,
  }

  const nextItems = items.map((item) => {
    const next = JSON.parse(JSON.stringify(item))
    const reasons = toReasonSet(next.manualReviewReason)

    resolveCanonicalName(next, reasons, stats)
    resolveCountry(next, reasons, stats)
    resolveBeginYear(next, reasons, stats)
    fixAdeleImage(next, stats)

    next.manualReviewReason = [...reasons]
    return next
  })

  const nextPayload = {
    ...payload,
    resolvedAt: new Date().toISOString(),
    resolvedFrom: path.relative(ROOT, inputPath).replace(/\\/g, '/'),
    resolutionRules: {
      inputPriority: true,
      countryNormalization: ['RU=Russia', 'USSR=СССР', 'KR=South Korea'],
      beginYearRules: ['ignore 0', '1939=>no-data when no better candidate'],
      canonicalNameRules: ['keep similar variants in aliases', 'close canonical conflict by selected variant'],
      chooseBySourceCount: true,
    },
    items: nextItems,
  }

  writeJson(outputPath, nextPayload)

  console.log(`Input: ${path.relative(ROOT, inputPath).replace(/\\/g, '/')}`)
  console.log(`Output: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`)
  console.log(`Items: ${stats.total}`)
  console.log(`Resolved conflict_canonical_name: ${stats.resolvedCanonical}`)
  console.log(`Resolved conflict_country: ${stats.resolvedCountry}`)
  console.log(`Resolved conflict_begin_year: ${stats.resolvedBeginYear}`)
  console.log(`Begin year -> no data (1939 only): ${stats.yearClearedAsNoData}`)
  console.log(`Adele image adjusted: ${stats.adeleImageAdjusted}`)
}

main()