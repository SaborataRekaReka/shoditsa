import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DEFAULT_ORIGINAL = 'data/music/normalized/music_artists_enriched_first500.json'
const DEFAULT_RETRY = 'data/music/normalized/music_artists_enriched_first177.json'
const DEFAULT_RETRY_REPORT = 'data/music/tmp/music_artists_retry_not_found_error_from_first500.report.json'
const DEFAULT_OUTPUT = 'data/music/normalized/music_artists_enriched_first500_merged_retry.json'
const DEFAULT_SUMMARY = 'docs/music-merge-original-retry-summary.first500.json'

const PRIMARY_SOURCE_WEIGHTS = {
  musicbrainz: 5,
  wikidata: 4,
  spotify: 3,
  lastfm: 2,
  theaudiodb: 1,
}

const parseArgs = () => {
  const options = {
    original: DEFAULT_ORIGINAL,
    retry: DEFAULT_RETRY,
    retryReport: DEFAULT_RETRY_REPORT,
    output: DEFAULT_OUTPUT,
    summary: DEFAULT_SUMMARY,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--original=')) {
      const value = arg.slice('--original='.length).trim()
      if (value) options.original = value
      continue
    }
    if (arg.startsWith('--retry=')) {
      const value = arg.slice('--retry='.length).trim()
      if (value) options.retry = value
      continue
    }
    if (arg.startsWith('--retry-report=')) {
      const value = arg.slice('--retry-report='.length).trim()
      if (value) options.retryReport = value
      continue
    }
    if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim()
      if (value) options.output = value
      continue
    }
    if (arg.startsWith('--summary=')) {
      const value = arg.slice('--summary='.length).trim()
      if (value) options.summary = value
    }
  }

  return options
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})

const sourceStatusScore = (sourceStatus) => {
  const map = asObject(sourceStatus)
  let score = 0
  for (const [source, status] of Object.entries(map)) {
    const weight = PRIMARY_SOURCE_WEIGHTS[source] ?? 1
    if (status === 'ok') score += weight * 3
    else if (status === 'not_found') score += weight * 1
    else if (status === 'skipped') score += 0
    else if (status === 'error') score -= weight * 2
  }
  return score
}

const numeric = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const itemScore = (item) => {
  const pipeline = asObject(item?.pipeline)
  const sourceStatus = asObject(pipeline?.sourceStatus)
  const statusScore = sourceStatusScore(sourceStatus)
  const confidence = numeric(item?.matchConfidence?.primaryValue) ?? -1
  const reviewCount = Array.isArray(item?.manualReviewReason) ? item.manualReviewReason.length : 0

  return {
    statusScore,
    confidence,
    reviewPenalty: reviewCount,
    total: statusScore * 1000 + confidence * 100 - reviewCount,
  }
}

const main = () => {
  const options = parseArgs()

  const originalPath = path.isAbsolute(options.original) ? options.original : path.join(ROOT, options.original)
  const retryPath = path.isAbsolute(options.retry) ? options.retry : path.join(ROOT, options.retry)
  const retryReportPath = path.isAbsolute(options.retryReport) ? options.retryReport : path.join(ROOT, options.retryReport)
  const outputPath = path.isAbsolute(options.output) ? options.output : path.join(ROOT, options.output)
  const summaryPath = path.isAbsolute(options.summary) ? options.summary : path.join(ROOT, options.summary)

  if (!fs.existsSync(originalPath)) throw new Error(`Original file not found: ${path.relative(ROOT, originalPath)}`)
  if (!fs.existsSync(retryPath)) throw new Error(`Retry file not found: ${path.relative(ROOT, retryPath)}`)
  if (!fs.existsSync(retryReportPath)) throw new Error(`Retry report file not found: ${path.relative(ROOT, retryReportPath)}`)

  const originalPayload = readJson(originalPath)
  const retryPayload = readJson(retryPath)
  const retryReport = readJson(retryReportPath)

  const originalItems = Array.isArray(originalPayload?.items) ? originalPayload.items : []
  const retryItems = Array.isArray(retryPayload?.items) ? retryPayload.items : []
  const selectedArtists = Array.isArray(retryReport?.selectedArtists) ? retryReport.selectedArtists : []

  const originalByRank = new Map()
  for (const item of originalItems) {
    const rank = Number.parseInt(String(item?.input?.rank), 10)
    if (Number.isFinite(rank)) originalByRank.set(rank, item)
  }

  const retryByRank = new Map()
  for (const item of retryItems) {
    const rank = Number.parseInt(String(item?.input?.rank), 10)
    if (Number.isFinite(rank)) retryByRank.set(rank, item)
  }

  const retryRanks = selectedArtists
    .map((row) => Number.parseInt(String(row?.position), 10))
    .filter((value) => Number.isFinite(value))

  const retryRankSet = new Set(retryRanks)
  const mergedItems = []
  const decisions = []

  for (const item of originalItems) {
    const rank = Number.parseInt(String(item?.input?.rank), 10)
    if (!Number.isFinite(rank) || !retryRankSet.has(rank)) {
      mergedItems.push(item)
      continue
    }

    const originalItem = originalByRank.get(rank)
    const retryItem = retryByRank.get(rank)

    if (!retryItem) {
      mergedItems.push(originalItem)
      decisions.push({
        rank,
        artist: String(originalItem?.input?.artist ?? ''),
        selected: 'original',
        reason: 'retry_missing_for_rank',
      })
      continue
    }

    const os = itemScore(originalItem)
    const rs = itemScore(retryItem)

    let selected = 'original'
    let selectedItem = originalItem

    if (rs.total > os.total) {
      selected = 'retry'
      selectedItem = retryItem
    }

    mergedItems.push(selectedItem)

    decisions.push({
      rank,
      artist: String(originalItem?.input?.artist ?? retryItem?.input?.artist ?? ''),
      selected,
      originalScore: os,
      retryScore: rs,
      originalSourceStatus: asObject(originalItem?.pipeline?.sourceStatus),
      retrySourceStatus: asObject(retryItem?.pipeline?.sourceStatus),
    })
  }

  mergedItems.sort((a, b) => {
    const ar = Number.parseInt(String(a?.input?.rank), 10)
    const br = Number.parseInt(String(b?.input?.rank), 10)
    if (Number.isFinite(ar) && Number.isFinite(br) && ar !== br) return ar - br
    const aa = String(a?.input?.artist ?? '')
    const ba = String(b?.input?.artist ?? '')
    return aa.localeCompare(ba, 'ru-RU')
  })

  const summary = {
    generatedAt: new Date().toISOString(),
    original: path.relative(ROOT, originalPath).replace(/\\/g, '/'),
    retry: path.relative(ROOT, retryPath).replace(/\\/g, '/'),
    retryReport: path.relative(ROOT, retryReportPath).replace(/\\/g, '/'),
    mergedOutput: path.relative(ROOT, outputPath).replace(/\\/g, '/'),
    totalOriginal: originalItems.length,
    totalRetry: retryItems.length,
    retryRankCount: retryRankSet.size,
    selectedOriginalCount: decisions.filter((row) => row.selected === 'original').length,
    selectedRetryCount: decisions.filter((row) => row.selected === 'retry').length,
    decisions,
  }

  const outputPayload = {
    generatedAt: new Date().toISOString(),
    input: summary.original,
    mergedFromRetry: summary.retry,
    limit: mergedItems.length,
    sourcePriority: Array.isArray(originalPayload?.sourcePriority) ? originalPayload.sourcePriority : [],
    items: mergedItems,
  }

  writeJson(outputPath, outputPayload)
  writeJson(summaryPath, summary)

  console.log(`Merged items: ${mergedItems.length}`)
  console.log(`Selected from retry: ${summary.selectedRetryCount}`)
  console.log(`Selected from original: ${summary.selectedOriginalCount}`)
  console.log(`Merged output: ${summary.mergedOutput}`)
  console.log(`Summary: ${path.relative(ROOT, summaryPath).replace(/\\/g, '/')}`)
}

main()
