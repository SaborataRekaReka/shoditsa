import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const DEFAULT_REPORT = 'docs/music-manual-review-report.after-rules.json'
const DEFAULT_RUNTIME_GENERATED = 'public/data/music.generated.json'
const DEFAULT_RUNTIME_ITEMS = 'public/data/libraries/music/items.json'
const DEFAULT_RUNTIME_INDEX = 'public/data/libraries/music/search-index.json'
const DEFAULT_SOURCE_META = 'public/data/source.json'
const DEFAULT_EXCLUDED_OUTPUT = 'public/data/libraries/music/additional-data/factcheck-pending/music-excluded-from-runtime.pending-review.json'

const parseArgs = () => {
  const options = {
    report: DEFAULT_REPORT,
    generated: DEFAULT_RUNTIME_GENERATED,
    items: DEFAULT_RUNTIME_ITEMS,
    index: DEFAULT_RUNTIME_INDEX,
    sourceMeta: DEFAULT_SOURCE_META,
    excludedOutput: DEFAULT_EXCLUDED_OUTPUT,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--report=')) {
      const value = arg.slice('--report='.length).trim()
      if (value) options.report = value
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
    if (arg.startsWith('--excluded-output=')) {
      const value = arg.slice('--excluded-output='.length).trim()
      if (value) options.excludedOutput = value
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

const normalize = (value) => String(value ?? '')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const tokenize = (value) => normalize(value)
  .split(/\s+/)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2)

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

const main = () => {
  const options = parseArgs()
  const reportPath = path.isAbsolute(options.report) ? options.report : path.join(ROOT, options.report)
  const generatedPath = path.isAbsolute(options.generated) ? options.generated : path.join(ROOT, options.generated)
  const itemsPath = path.isAbsolute(options.items) ? options.items : path.join(ROOT, options.items)
  const indexPath = path.isAbsolute(options.index) ? options.index : path.join(ROOT, options.index)
  const sourceMetaPath = path.isAbsolute(options.sourceMeta) ? options.sourceMeta : path.join(ROOT, options.sourceMeta)
  const excludedOutputPath = path.isAbsolute(options.excludedOutput) ? options.excludedOutput : path.join(ROOT, options.excludedOutput)

  if (!fs.existsSync(reportPath)) throw new Error(`Review report not found: ${path.relative(ROOT, reportPath)}`)
  if (!fs.existsSync(generatedPath)) throw new Error(`Generated runtime file not found: ${path.relative(ROOT, generatedPath)}`)

  const report = readJson(reportPath)
  const runtimeItems = readJson(generatedPath)
  if (!Array.isArray(runtimeItems)) throw new Error('Runtime generated file must contain an array')

  const pendingKeys = new Set(
    (Array.isArray(report?.problematicArtists) ? report.problematicArtists : [])
      .map((entry) => String(entry?.artistKey ?? '').trim())
      .filter(Boolean),
  )

  const excluded = []
  const kept = []

  for (const item of runtimeItems) {
    const id = String(item?.id ?? '').trim()
    const artistKey = id.startsWith('music:') ? id.slice('music:'.length) : ''
    if (artistKey && pendingKeys.has(artistKey)) {
      excluded.push(item)
      continue
    }
    kept.push(item)
  }

  const searchIndex = buildSearchIndex(kept)

  writeJson(generatedPath, kept)
  writeJson(itemsPath, kept)
  writeJson(indexPath, searchIndex)

  const excludedPayload = {
    generatedAt: new Date().toISOString(),
    sourceReport: path.relative(ROOT, reportPath).replace(/\\/g, '/'),
    sourceRuntime: path.relative(ROOT, generatedPath).replace(/\\/g, '/'),
    excludedCount: excluded.length,
    keptCount: kept.length,
    items: excluded,
  }
  writeJson(excludedOutputPath, excludedPayload)

  if (fs.existsSync(sourceMetaPath)) {
    const sourceMeta = readJson(sourceMetaPath)
    sourceMeta.musicCount = kept.length
    sourceMeta.musicExcludedPendingReview = excluded.length
    sourceMeta.musicGeneratedAt = new Date().toISOString()
    writeJson(sourceMetaPath, sourceMeta)
  }

  console.log(`Report: ${path.relative(ROOT, reportPath).replace(/\\/g, '/')}`)
  console.log(`Pending keys: ${pendingKeys.size}`)
  console.log(`Kept in runtime: ${kept.length}`)
  console.log(`Excluded from runtime: ${excluded.length}`)
  console.log(`Updated: ${path.relative(ROOT, generatedPath).replace(/\\/g, '/')}`)
  console.log(`Updated: ${path.relative(ROOT, itemsPath).replace(/\\/g, '/')}`)
  console.log(`Updated: ${path.relative(ROOT, indexPath).replace(/\\/g, '/')}`)
  console.log(`Saved excluded set: ${path.relative(ROOT, excludedOutputPath).replace(/\\/g, '/')}`)
}

main()