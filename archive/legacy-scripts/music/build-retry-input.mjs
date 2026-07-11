import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DEFAULT_FETCH_INDEX = 'data/music/raw/fetch-index.first500.json'
const DEFAULT_SOURCE = 'archive/local/music-pipeline/source/music_artists_merged_dedup.json'
const DEFAULT_OUTPUT = 'data/music/tmp/music_artists_retry_not_found_error_from_first500.json'
const DEFAULT_REPORT = 'data/music/tmp/music_artists_retry_not_found_error_from_first500.report.json'
const DEFAULT_STATUSES = ['not_found', 'error']

const parseArgs = () => {
  const options = {
    fetchIndex: DEFAULT_FETCH_INDEX,
    source: DEFAULT_SOURCE,
    output: DEFAULT_OUTPUT,
    report: DEFAULT_REPORT,
    statuses: [...DEFAULT_STATUSES],
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--fetch-index=')) {
      const value = arg.slice('--fetch-index='.length).trim()
      if (value) options.fetchIndex = value
      continue
    }
    if (arg.startsWith('--source=')) {
      const value = arg.slice('--source='.length).trim()
      if (value) options.source = value
      continue
    }
    if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim()
      if (value) options.output = value
      continue
    }
    if (arg.startsWith('--report=')) {
      const value = arg.slice('--report='.length).trim()
      if (value) options.report = value
      continue
    }
    if (arg.startsWith('--statuses=')) {
      const value = arg.slice('--statuses='.length).trim()
      const items = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      if (items.length) options.statuses = items
    }
  }

  return options
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const toInt = (value) => {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

const main = () => {
  const options = parseArgs()
  const fetchIndexPath = path.isAbsolute(options.fetchIndex) ? options.fetchIndex : path.join(ROOT, options.fetchIndex)
  const sourcePath = path.isAbsolute(options.source) ? options.source : path.join(ROOT, options.source)
  const outputPath = path.isAbsolute(options.output) ? options.output : path.join(ROOT, options.output)
  const reportPath = path.isAbsolute(options.report) ? options.report : path.join(ROOT, options.report)

  if (!fs.existsSync(fetchIndexPath)) {
    throw new Error(`Fetch index not found: ${path.relative(ROOT, fetchIndexPath)}`)
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source input not found: ${path.relative(ROOT, sourcePath)}`)
  }

  const fetchIndex = readJson(fetchIndexPath)
  const source = readJson(sourcePath)

  if (!Array.isArray(fetchIndex?.artists)) {
    throw new Error('Invalid fetch index: artists[] is required')
  }
  if (!Array.isArray(source)) {
    throw new Error('Invalid source input: array is required')
  }

  const statusSet = new Set(options.statuses)
  const selectedInput = []
  const selectedRows = []

  for (const artist of fetchIndex.artists) {
    const sourceStatus = artist?.sourceStatus && typeof artist.sourceStatus === 'object'
      ? artist.sourceStatus
      : {}

    const flaggedSources = Object.entries(sourceStatus)
      .filter(([, status]) => statusSet.has(String(status)))
      .map(([sourceName, status]) => ({ source: sourceName, status: String(status) }))

    if (!flaggedSources.length) continue

    const position = toInt(artist?.position)
    const sourceItem = position != null && position >= 1 && position <= source.length
      ? source[position - 1]
      : null

    selectedInput.push(sourceItem ?? {
      rank: position,
      artist: String(artist?.artistName ?? '').trim() || null,
      alternative_names: [],
      country: null,
      genres: [],
      debutYear: null,
    })

    selectedRows.push({
      position,
      artistName: String(artist?.artistName ?? '').trim() || null,
      flaggedSources,
      notes: Array.isArray(artist?.notes) ? artist.notes : [],
    })
  }

  const reasonBySource = new Map()
  for (const row of selectedRows) {
    for (const flagged of row.flaggedSources) {
      const key = `${flagged.source}:${flagged.status}`
      reasonBySource.set(key, (reasonBySource.get(key) ?? 0) + 1)
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    fetchIndex: path.relative(ROOT, fetchIndexPath).replace(/\\/g, '/'),
    source: path.relative(ROOT, sourcePath).replace(/\\/g, '/'),
    statuses: [...statusSet],
    totalInFetchIndex: fetchIndex.artists.length,
    selectedCount: selectedRows.length,
    reasonBySource: [...reasonBySource.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'en-US')),
    selectedArtists: selectedRows,
  }

  writeJson(outputPath, selectedInput)
  writeJson(reportPath, report)

  console.log(`Selected for retry: ${selectedRows.length}`)
  console.log(`Retry input: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`)
  console.log(`Retry report: ${path.relative(ROOT, reportPath).replace(/\\/g, '/')}`)
}

main()
