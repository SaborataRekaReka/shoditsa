import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DEFAULT_INPUT = 'data/music/normalized/music_artists_enriched_first500.json'
const DEFAULT_OUTPUT = 'docs/music-manual-review-report.first500.json'

const parseArgs = () => {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    excludeReasons: [],
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
    if (arg.startsWith('--exclude-reason=')) {
      const value = arg.slice('--exclude-reason='.length).trim()
      if (value) options.excludeReasons.push(value)
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

const cleanReasons = (value) => {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const item of value) {
    const reason = String(item ?? '').trim()
    if (!reason || seen.has(reason)) continue
    seen.add(reason)
    out.push(reason)
  }
  return out
}

const resolveArtistName = (entry) => {
  const direct = String(entry?.input?.artist ?? '').trim()
  if (direct) return direct

  const canonical = String(entry?.canonicalName?.primaryValue ?? '').trim()
  if (canonical) return canonical

  return String(entry?.artistKey ?? '').trim() || 'unknown'
}

const sortByCountDesc = (entries) => [...entries].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'en-US'))

const main = () => {
  const options = parseArgs()
  const inputPath = path.isAbsolute(options.input) ? options.input : path.join(ROOT, options.input)
  const outputPath = path.isAbsolute(options.output) ? options.output : path.join(ROOT, options.output)
  const excludeReasonSet = new Set(options.excludeReasons)

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${path.relative(ROOT, inputPath)}`)
  }

  const payload = readJson(inputPath)
  const items = Array.isArray(payload?.items) ? payload.items : []

  const reasonCounts = new Map()
  const problematicArtists = []

  for (const entry of items) {
    const reasons = cleanReasons(entry?.manualReviewReason).filter((reason) => !excludeReasonSet.has(reason))
    if (!reasons.length) continue

    for (const reason of reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
    }

    problematicArtists.push({
      artistKey: String(entry?.artistKey ?? ''),
      artist: resolveArtistName(entry),
      rank: toInt(entry?.input?.rank),
      reasons,
      sourceStatus: entry?.pipeline?.sourceStatus ?? {},
      matchConfidence: typeof entry?.matchConfidence?.primaryValue === 'number'
        ? entry.matchConfidence.primaryValue
        : null,
    })
  }

  problematicArtists.sort((a, b) => {
    const ar = a.rank ?? Number.MAX_SAFE_INTEGER
    const br = b.rank ?? Number.MAX_SAFE_INTEGER
    if (ar !== br) return ar - br
    return a.artist.localeCompare(b.artist, 'ru-RU')
  })

  const report = {
    generatedAt: new Date().toISOString(),
    input: path.relative(ROOT, inputPath).replace(/\\/g, '/'),
    excludedReasons: [...excludeReasonSet],
    totalItems: items.length,
    problematicCount: problematicArtists.length,
    problematicShare: items.length ? Number((problematicArtists.length / items.length).toFixed(4)) : 0,
    manualReviewReasonCounts: sortByCountDesc(
      [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count }))
    ),
    problematicArtists,
  }

  writeJson(outputPath, report)

  console.log(`Input: ${report.input}`)
  console.log(`Total: ${report.totalItems}`)
  console.log(`Problematic: ${report.problematicCount}`)
  console.log(`Report: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`)
}

main()
