import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  acquireLock,
  buildQueue,
  ensureDir,
  isRunnableQueueItem,
  loadState,
  readJson,
  recoverInterruptedEntities,
  retryAt,
  saveState,
  sha256,
  summarizeQueue,
  writeJsonAtomic,
} from './core.mjs'

const ROOT = process.cwd()

const loadLocalEnv = () => {
  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.join(ROOT, fileName)
    if (!fs.existsSync(filePath)) continue
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i)
      if (!match || match[1].startsWith('#')) continue
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2')
      if (process.env[match[1]] == null) process.env[match[1]] = value
    }
  }
}

const parseArgs = () => {
  const [domain = 'music', action = 'status', ...args] = process.argv.slice(2)
  const options = {
    domain,
    action,
    source: null,
    maxItems: 5,
    maxAttempts: 4,
    refreshDays: 90,
    retryReview: false,
    ai: 'auto',
    maxAiReviews: 5,
    model: 'gpt-5-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
    apiBaseUrl: 'https://api.openai.com/v1',
    aiTimeoutMs: 90000,
    aiWebSearch: true,
    confidenceThreshold: 0.75,
  }

  for (const arg of args) {
    if (arg.startsWith('--source=')) options.source = arg.slice('--source='.length).trim() || null
    else if (arg.startsWith('--max-items=')) options.maxItems = Math.max(1, Number.parseInt(arg.slice(12), 10) || 1)
    else if (arg.startsWith('--max-attempts=')) options.maxAttempts = Math.max(1, Number.parseInt(arg.slice(15), 10) || 1)
    else if (arg.startsWith('--refresh-days=')) options.refreshDays = Math.max(0, Number.parseInt(arg.slice(15), 10) || 0)
    else if (arg === '--retry-review') options.retryReview = true
    else if (arg.startsWith('--ai=')) options.ai = arg.slice(5)
    else if (arg.startsWith('--max-ai-reviews=')) options.maxAiReviews = Math.max(0, Number.parseInt(arg.slice(17), 10) || 0)
    else if (arg.startsWith('--model=')) options.model = arg.slice(8).trim() || options.model
    else if (arg.startsWith('--api-key-env=')) options.apiKeyEnv = arg.slice(14).trim() || options.apiKeyEnv
    else if (arg.startsWith('--api-base-url=')) options.apiBaseUrl = arg.slice(15).replace(/\/+$/, '')
    else if (arg === '--no-ai-web-search') options.aiWebSearch = false
    else if (arg.startsWith('--confidence-threshold=')) options.confidenceThreshold = Number.parseFloat(arg.slice(23))
  }

  if (!['status', 'plan', 'run', 'discover', 'rebuild', 'publish'].includes(options.action)) {
    throw new Error(`Unknown action: ${options.action}. Use status, plan, run, discover, rebuild, or publish.`)
  }
  if (!['auto', 'always', 'never'].includes(options.ai)) {
    throw new Error('--ai must be auto, always, or never')
  }
  return options
}

const loadAdapter = async (domain) => {
  const modulePath = path.join(ROOT, 'scripts', 'enrichment-agent', 'adapters', `${domain}.mjs`)
  if (!fs.existsSync(modulePath)) throw new Error(`No enrichment adapter for domain: ${domain}`)
  const module = await import(pathToFileURL(modulePath))
  const adapter = module[`${domain}Adapter`]
  if (!adapter) throw new Error(`Adapter module does not export ${domain}Adapter`)
  return adapter
}

const makeRunId = () => new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)

const loadRecords = (recordsDir) => {
  if (!fs.existsSync(recordsDir)) return []
  return fs.readdirSync(recordsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson(path.join(recordsDir, name)))
}

const rebuildAggregate = ({ adapter, recordsDir, aggregatePath }) => {
  const records = loadRecords(recordsDir)
  writeJsonAtomic(aggregatePath, adapter.buildAggregate(records))
  return records.length
}

const printSummary = ({ options, sourcePath, paths, queue, recovered = 0 }) => {
  const summary = summarizeQueue(queue)
  console.log(JSON.stringify({
    domain: options.domain,
    action: options.action,
    source: path.relative(ROOT, sourcePath).replace(/\\/g, '/'),
    state: path.relative(ROOT, paths.statePath).replace(/\\/g, '/'),
    recovered,
    ...summary,
  }, null, 2))
}

const main = async () => {
  loadLocalEnv()
  const options = parseArgs()
  const adapter = await loadAdapter(options.domain)
  const { items, sourcePath, scope = 'default' } = adapter.loadItems(ROOT, options.source)
  const enrichmentRoot = process.env.ENRICHMENT_DATA_ROOT
    ? path.resolve(process.env.ENRICHMENT_DATA_ROOT)
    : path.join(ROOT, 'data', 'enrichment-agent')
  const baseDir = path.join(enrichmentRoot, options.domain, scope)
  const paths = {
    statePath: path.join(baseDir, 'state.json'),
    lockPath: path.join(baseDir, 'run.lock'),
    recordsDir: path.join(baseDir, 'records'),
    runsDir: path.join(baseDir, 'runs'),
    aggregatePath: path.join(baseDir, `${options.domain}.enriched.json`),
  }
  const state = loadState(paths.statePath, options.domain)
  const isNewState = Object.keys(state.entities).length === 0
  const baseline = typeof adapter.bootstrap === 'function'
    ? await adapter.bootstrap({
      root: ROOT,
      items,
      state,
      recordsDir: paths.recordsDir,
      persist: false,
      sha256,
    })
    : { accepted: 0, review: 0 }
  const queueOptions = {
    items,
    state,
    adapter,
    refreshDays: options.refreshDays,
    retryReview: options.retryReview,
  }
  const queue = buildQueue(queueOptions)

  if (options.action === 'status' || options.action === 'plan') {
    printSummary({ options, sourcePath, paths, queue })
    if (baseline.accepted || baseline.review) console.log(JSON.stringify({ inferredBaseline: baseline }, null, 2))
    if (options.action === 'plan') {
      console.log(JSON.stringify({
        next: queue.filter(isRunnableQueueItem).slice(0, options.maxItems).map(({ key, reason, item }) => ({
          key,
          reason,
          entity: item?.artist ?? item?.titleRu ?? item?.title ?? item?.kinopoiskId ?? null,
          rank: item?.rank ?? null,
        })),
      }, null, 2))
    }
    return
  }

  const plannedWork = queue.filter(isRunnableQueueItem).length
  if (options.action === 'run' && plannedWork > 0 && options.ai !== 'never' && !process.env[options.apiKeyEnv]) {
    throw new Error(
      `${options.apiKeyEnv} is required for researched hint generation. `
      + 'Configure it before run, or use --ai=never for metadata-only collection without auto-acceptance.'
    )
  }
  if (options.action === 'discover' && adapter.discoveryRequiresAi !== false && !process.env[options.apiKeyEnv]) {
    throw new Error(`${options.apiKeyEnv} is required for web research and artist discovery.`)
  }

  const releaseLock = acquireLock(paths.lockPath)
  try {
    ensureDir(paths.recordsDir)
    if (isNewState && typeof adapter.bootstrap === 'function') {
      for (const key of Object.keys(state.entities)) delete state.entities[key]
      const persistedBaseline = await adapter.bootstrap({
        root: ROOT,
        items,
        state,
        recordsDir: paths.recordsDir,
        persist: true,
        sha256,
      })
      if (persistedBaseline.accepted || persistedBaseline.review) saveState(paths.statePath, state)
    }

    if (options.action === 'discover') {
      if (typeof adapter.discover !== 'function') throw new Error(`${options.domain} adapter does not support discovery`)
    const outputPath = path.join(enrichmentRoot, options.domain, 'discovery', 'discovered-candidates.json')
      const result = await adapter.discover({ items, options, outputPath, count: options.maxItems })
      console.log(JSON.stringify({
        added: result.added,
        total: result.total,
        output: path.relative(ROOT, result.outputPath).replace(/\\/g, '/'),
        candidates: result.additions.map((item) => ({
          entity: item.artist ?? item.title ?? item.kinopoiskId ?? null,
          reason: item.provenance?.reason ?? item.provenance?.source ?? null,
          sourceUrls: item.provenance?.sourceUrls ?? [],
        })),
      }, null, 2))
      return
    }

    if (options.action === 'rebuild' || options.action === 'publish') {
      const count = rebuildAggregate({ adapter, recordsDir: paths.recordsDir, aggregatePath: paths.aggregatePath })
      console.log(`Aggregate rebuilt from ${count} records`)
      if (options.action === 'publish') {
        const publish = spawnSync(process.execPath, [
          'scripts/music/build-dataset.mjs',
          `--input=${paths.aggregatePath}`,
          '--merge',
        ], { cwd: ROOT, stdio: 'inherit', env: process.env })
        if (publish.status !== 0) throw new Error(`Publish failed with exit code ${publish.status}`)
        console.log(`Published accepted ${options.domain} records`)
      }
      return
    }

    const recovered = recoverInterruptedEntities(state)
    if (recovered) saveState(paths.statePath, state)
    const freshQueue = buildQueue(queueOptions)
    const runnable = freshQueue
      .filter(isRunnableQueueItem)
      .filter((item) => (item.previous?.attempts ?? 0) < options.maxAttempts || item.reason === 'input_changed')
      .slice(0, options.maxItems)
    printSummary({ options, sourcePath, paths, queue: freshQueue, recovered })

    if (!runnable.length) {
      console.log('Nothing to process')
      return
    }

    const runId = makeRunId()
    const workDir = path.join(paths.runsDir, runId)
    ensureDir(workDir)
    const run = {
      id: runId,
      startedAt: new Date().toISOString(),
      status: 'running',
      requested: runnable.length,
      completed: 0,
      review: 0,
      failed: 0,
      aiReviews: 0,
    }
    state.runs.push(run)
    saveState(paths.statePath, state)

    for (const queueItem of runnable) {
      const previousAttempts = queueItem.reason === 'input_changed' ? 0 : queueItem.previous?.attempts ?? 0
      state.entities[queueItem.key] = {
        ...(queueItem.previous ?? {}),
        key: queueItem.key,
        inputFingerprint: queueItem.fingerprint,
        status: 'running',
        attempts: previousAttempts + 1,
        startedAt: new Date().toISOString(),
        runId,
        lastError: null,
      }
      saveState(paths.statePath, state)
      console.log(`[${run.completed + run.review + run.failed + 1}/${runnable.length}] ${queueItem.key}`)

      try {
        const result = await adapter.process({
          root: ROOT,
          queueItem,
          runId,
          workDir,
          options,
          aiReviewAllowed: options.ai !== 'never' && run.aiReviews < options.maxAiReviews,
        })
        const outputPath = path.join(paths.recordsDir, `${queueItem.key}.json`)
        writeJsonAtomic(outputPath, result.output)
        const completedAt = new Date().toISOString()
        state.entities[queueItem.key] = {
          ...state.entities[queueItem.key],
          status: result.status,
          completedAt,
          output: path.relative(ROOT, outputPath).replace(/\\/g, '/'),
          nextRetryAt: null,
        }
        run[result.status] += 1
        if (result.usedAi) run.aiReviews += 1
      } catch (error) {
        const entity = state.entities[queueItem.key]
        entity.status = 'failed'
        entity.lastError = error instanceof Error ? error.message : String(error)
        entity.nextRetryAt = retryAt(entity.attempts)
        run.failed += 1
        console.error(`Failed ${queueItem.key}: ${entity.lastError}`)
      }
      saveState(paths.statePath, state)
    }

    run.status = run.failed === runnable.length ? 'failed' : 'completed'
    run.finishedAt = new Date().toISOString()
    rebuildAggregate({ adapter, recordsDir: paths.recordsDir, aggregatePath: paths.aggregatePath })
    saveState(paths.statePath, state)
    console.log(JSON.stringify(run, null, 2))
  } finally {
    releaseLock()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
