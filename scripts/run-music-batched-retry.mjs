import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const DEFAULT_RETRY_SOURCE = 'data/music/tmp/music_artists_retry_not_found_error_from_first500.json'
const DEFAULT_BATCH_SIZE = 40
const DEFAULT_PAUSE_MS = 8000
const DEFAULT_PREFIX = 'music-mbwd-retry'

const parseArgs = () => {
  const options = {
    retrySource: DEFAULT_RETRY_SOURCE,
    batchSize: DEFAULT_BATCH_SIZE,
    pauseMs: DEFAULT_PAUSE_MS,
    runTagPrefix: DEFAULT_PREFIX,
    keepBatchInputs: true,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--retry-source=')) {
      const value = arg.slice('--retry-source='.length).trim()
      if (value) options.retrySource = value
      continue
    }
    if (arg.startsWith('--batch-size=')) {
      const value = Number.parseInt(arg.slice('--batch-size='.length), 10)
      if (Number.isFinite(value) && value > 0) options.batchSize = value
      continue
    }
    if (arg.startsWith('--pause-ms=')) {
      const value = Number.parseInt(arg.slice('--pause-ms='.length), 10)
      if (Number.isFinite(value) && value >= 0) options.pauseMs = value
      continue
    }
    if (arg.startsWith('--run-tag-prefix=')) {
      const value = arg.slice('--run-tag-prefix='.length).trim()
      if (value) options.runTagPrefix = value
      continue
    }
    if (arg === '--delete-batch-inputs') {
      options.keepBatchInputs = false
    }
  }

  return options
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const scoreStatus = (status) => {
  if (status === 'ok') return 3
  if (status === 'not_found') return 1
  if (status === 'skipped') return 0
  if (status === 'error') return -2
  return 0
}

const betterStatus = (a, b) => (scoreStatus(b) > scoreStatus(a) ? b : a)

const mergeSourceStatus = (base, next) => {
  const out = { ...(base ?? {}) }
  for (const [source, status] of Object.entries(next ?? {})) {
    if (source === 'lastfm' || source === 'theaudiodb' || source === 'spotify') {
      out[source] = status
      continue
    }
    const current = out[source]
    out[source] = current == null ? status : betterStatus(current, status)
  }
  return out
}

const pickBestBySourceScore = (a, b) => {
  const fields = ['musicbrainz', 'wikidata']
  const sum = (item) => fields
    .map((field) => scoreStatus(item?.pipeline?.sourceStatus?.[field]))
    .reduce((acc, val) => acc + val, 0)

  const sa = sum(a)
  const sb = sum(b)
  if (sb > sa) return b
  return a
}

const updateItemWithBatchRetry = (baseItem, retryItem) => {
  const picked = pickBestBySourceScore(baseItem, retryItem)
  const merged = {
    ...picked,
    pipeline: {
      ...(picked?.pipeline ?? {}),
      sourceStatus: mergeSourceStatus(baseItem?.pipeline?.sourceStatus, retryItem?.pipeline?.sourceStatus),
      rawFiles: Array.from(new Set([...(baseItem?.pipeline?.rawFiles ?? []), ...(retryItem?.pipeline?.rawFiles ?? [])])),
    },
  }
  return merged
}

const main = async () => {
  const options = parseArgs()
  const retrySourcePath = path.isAbsolute(options.retrySource) ? options.retrySource : path.join(ROOT, options.retrySource)

  if (!fs.existsSync(retrySourcePath)) {
    throw new Error(`Retry source not found: ${path.relative(ROOT, retrySourcePath)}`)
  }

  const retrySource = readJson(retrySourcePath)
  if (!Array.isArray(retrySource)) {
    throw new Error('Retry source must be an array')
  }

  const batches = []
  for (let i = 0; i < retrySource.length; i += options.batchSize) {
    batches.push(retrySource.slice(i, i + options.batchSize))
  }

  const batchOutputs = []

  for (let idx = 0; idx < batches.length; idx += 1) {
    const batch = batches[idx]
    const batchNo = idx + 1
    const batchInputRel = `data/music/tmp/${options.runTagPrefix}.batch${String(batchNo).padStart(2, '0')}.input.json`
    const batchInputPath = path.join(ROOT, batchInputRel)
    const runTag = `${options.runTagPrefix}.batch${String(batchNo).padStart(2, '0')}`

    writeJson(batchInputPath, batch)

    console.log(`[batch ${batchNo}/${batches.length}] size=${batch.length}`)

    const run = spawnSync(process.execPath, [
      'scripts/enrich-music-artists-first10.mjs',
      `--input=${batchInputPath}`,
      `--limit=${batch.length}`,
      `--run-tag=${runTag}`,
    ], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    })

    if (run.status !== 0) {
      throw new Error(`Batch ${batchNo} failed with exit code ${run.status}`)
    }

    batchOutputs.push({
      batchNo,
      runTag,
      input: batchInputRel,
      normalized: `data/music/normalized/music_artists_enriched_${runTag}.json`,
      fetchIndex: `data/music/raw/fetch-index.${runTag}.json`,
      size: batch.length,
    })

    if (!options.keepBatchInputs) {
      try { fs.unlinkSync(batchInputPath) } catch {}
    }

    if (idx < batches.length - 1 && options.pauseMs > 0) {
      console.log(`[pause] ${options.pauseMs}ms before next batch`)
      await sleep(options.pauseMs)
    }
  }

  const mergedByRank = new Map()
  for (const output of batchOutputs) {
    const normalizedPath = path.join(ROOT, output.normalized)
    const payload = readJson(normalizedPath)
    const items = Array.isArray(payload?.items) ? payload.items : []
    for (const item of items) {
      const rank = Number.parseInt(String(item?.input?.rank), 10)
      if (!Number.isFinite(rank)) continue
      if (!mergedByRank.has(rank)) {
        mergedByRank.set(rank, item)
        continue
      }
      const current = mergedByRank.get(rank)
      mergedByRank.set(rank, updateItemWithBatchRetry(current, item))
    }
  }

  const mergedItems = [...mergedByRank.values()].sort((a, b) => {
    const ar = Number.parseInt(String(a?.input?.rank), 10)
    const br = Number.parseInt(String(b?.input?.rank), 10)
    if (ar !== br) return ar - br
    return String(a?.input?.artist ?? '').localeCompare(String(b?.input?.artist ?? ''), 'ru-RU')
  })

  const mergedRel = `data/music/normalized/music_artists_enriched_${options.runTagPrefix}.merged.json`
  const mergedPath = path.join(ROOT, mergedRel)
  writeJson(mergedPath, {
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, retrySourcePath).replace(/\\/g, '/'),
    batchSize: options.batchSize,
    pauseMs: options.pauseMs,
    batches: batchOutputs,
    items: mergedItems,
  })

  const summaryRel = `docs/music-${options.runTagPrefix}.summary.json`
  const summaryPath = path.join(ROOT, summaryRel)
  writeJson(summaryPath, {
    generatedAt: new Date().toISOString(),
    retrySource: path.relative(ROOT, retrySourcePath).replace(/\\/g, '/'),
    batchSize: options.batchSize,
    pauseMs: options.pauseMs,
    batches: batchOutputs,
    mergedOutput: mergedRel,
    mergedCount: mergedItems.length,
  })

  console.log(`Batches completed: ${batchOutputs.length}`)
  console.log(`Merged retry output: ${mergedRel}`)
  console.log(`Summary: ${summaryRel}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
