import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DEFAULT_BASE = 'data/music/normalized/music_artists_enriched_first500_merged_retry.json'
const DEFAULT_RETRY = 'data/music/normalized/music_artists_enriched_music-mbwd-retry.merged.json'
const DEFAULT_OUTPUT = 'data/music/normalized/music_artists_enriched_first500_merged_retry_batched.json'
const DEFAULT_SUMMARY = 'docs/music-merge-batched-retry-into-first500.summary.json'

const SOURCE_WEIGHTS = {
  musicbrainz: 5,
  wikidata: 4,
  spotify: 3,
  lastfm: 2,
  theaudiodb: 1,
}

const parseArgs = () => {
  const options = {
    base: DEFAULT_BASE,
    retry: DEFAULT_RETRY,
    output: DEFAULT_OUTPUT,
    summary: DEFAULT_SUMMARY,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--base=')) {
      const value = arg.slice('--base='.length).trim()
      if (value) options.base = value
      continue
    }
    if (arg.startsWith('--retry=')) {
      const value = arg.slice('--retry='.length).trim()
      if (value) options.retry = value
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

const statusScore = (status) => {
  if (status === 'ok') return 3
  if (status === 'not_found') return 1
  if (status === 'skipped') return 0
  if (status === 'error') return -2
  return 0
}

const sourceScore = (item) => {
  const status = item?.pipeline?.sourceStatus ?? {}
  return Object.entries(status)
    .map(([source, st]) => (SOURCE_WEIGHTS[source] ?? 1) * statusScore(st))
    .reduce((acc, val) => acc + val, 0)
}

const confidenceScore = (item) => {
  const value = Number(item?.matchConfidence?.primaryValue)
  return Number.isFinite(value) ? value : -1
}

const reviewPenalty = (item) => {
  const reasons = Array.isArray(item?.manualReviewReason) ? item.manualReviewReason.length : 0
  return reasons
}

const totalScore = (item) => sourceScore(item) * 1000 + confidenceScore(item) * 100 - reviewPenalty(item)

const mergeStatus = (baseStatus, retryStatus) => {
  const merged = { ...(baseStatus ?? {}) }
  for (const [source, status] of Object.entries(retryStatus ?? {})) {
    const current = merged[source]
    if (current == null || statusScore(status) > statusScore(current)) merged[source] = status
  }
  return merged
}

const mergeRawFiles = (a, b) => Array.from(new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]))

const main = () => {
  const options = parseArgs()
  const basePath = path.isAbsolute(options.base) ? options.base : path.join(ROOT, options.base)
  const retryPath = path.isAbsolute(options.retry) ? options.retry : path.join(ROOT, options.retry)
  const outputPath = path.isAbsolute(options.output) ? options.output : path.join(ROOT, options.output)
  const summaryPath = path.isAbsolute(options.summary) ? options.summary : path.join(ROOT, options.summary)

  if (!fs.existsSync(basePath)) throw new Error(`Base file not found: ${path.relative(ROOT, basePath)}`)
  if (!fs.existsSync(retryPath)) throw new Error(`Retry file not found: ${path.relative(ROOT, retryPath)}`)

  const basePayload = readJson(basePath)
  const retryPayload = readJson(retryPath)

  const baseItems = Array.isArray(basePayload?.items) ? basePayload.items : []
  const retryItems = Array.isArray(retryPayload?.items) ? retryPayload.items : []

  const retryByRank = new Map()
  for (const item of retryItems) {
    const rank = Number.parseInt(String(item?.input?.rank), 10)
    if (Number.isFinite(rank)) retryByRank.set(rank, item)
  }

  const decisions = []
  const mergedItems = baseItems.map((baseItem) => {
    const rank = Number.parseInt(String(baseItem?.input?.rank), 10)
    if (!Number.isFinite(rank) || !retryByRank.has(rank)) return baseItem

    const retryItem = retryByRank.get(rank)

    const baseScore = totalScore(baseItem)
    const retryScore = totalScore(retryItem)

    const selected = retryScore > baseScore ? 'retry' : 'base'
    const picked = selected === 'retry' ? retryItem : baseItem

    const merged = {
      ...picked,
      pipeline: {
        ...(picked?.pipeline ?? {}),
        sourceStatus: mergeStatus(baseItem?.pipeline?.sourceStatus, retryItem?.pipeline?.sourceStatus),
        rawFiles: mergeRawFiles(baseItem?.pipeline?.rawFiles, retryItem?.pipeline?.rawFiles),
      },
    }

    decisions.push({
      rank,
      artist: String(baseItem?.input?.artist ?? retryItem?.input?.artist ?? ''),
      selected,
      baseScore,
      retryScore,
      baseStatus: baseItem?.pipeline?.sourceStatus ?? {},
      retryStatus: retryItem?.pipeline?.sourceStatus ?? {},
    })

    return merged
  })

  const outputPayload = {
    generatedAt: new Date().toISOString(),
    input: path.relative(ROOT, basePath).replace(/\\/g, '/'),
    mergedFromRetry: path.relative(ROOT, retryPath).replace(/\\/g, '/'),
    limit: mergedItems.length,
    sourcePriority: Array.isArray(basePayload?.sourcePriority) ? basePayload.sourcePriority : [],
    items: mergedItems,
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    base: outputPayload.input,
    retry: outputPayload.mergedFromRetry,
    output: path.relative(ROOT, outputPath).replace(/\\/g, '/'),
    totalBase: baseItems.length,
    totalRetry: retryItems.length,
    comparedCount: decisions.length,
    selectedRetryCount: decisions.filter((row) => row.selected === 'retry').length,
    selectedBaseCount: decisions.filter((row) => row.selected === 'base').length,
    decisions,
  }

  writeJson(outputPath, outputPayload)
  writeJson(summaryPath, summary)

  console.log(`Merged items: ${mergedItems.length}`)
  console.log(`Compared retry ranks: ${summary.comparedCount}`)
  console.log(`Selected retry: ${summary.selectedRetryCount}`)
  console.log(`Selected base: ${summary.selectedBaseCount}`)
  console.log(`Output: ${summary.output}`)
  console.log(`Summary: ${path.relative(ROOT, summaryPath).replace(/\\/g, '/')}`)
}

main()
