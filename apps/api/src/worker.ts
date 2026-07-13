import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  backgroundJobs, clientEvents, contentItemVersions, contentQualityIssues, contentRevisions, createDatabase,
  pipelineRunItems, pipelineRuns, playerProfiles, session, user, walletAccounts,
} from '@shoditsa/database'
import { buildWorkspaceRevision, validateContentPayload } from './modules/admin/content-service.js'
import { loadAdminTimeline } from './modules/admin/timeline-service.js'
import type { AdminEventsQuery } from '@shoditsa/contracts'
import { loadIntegrationEnvironment } from './modules/admin/integration-secrets.js'
import { collectMusicRecordUsage } from './modules/admin/pipeline-cost.js'
import { loadPipelineResultManifest } from './modules/admin/pipeline-manifest.js'
import { probeMusicSourceHealth } from './modules/admin/music-source-health.js'

type Json = Record<string, unknown>
const config = loadConfig()
const database = createDatabase(config)
const db = database.db
const root = process.cwd()
let stopping = false
let musicHealthCache: { signature: string; expiresAt: number; result: Awaited<ReturnType<typeof probeMusicSourceHealth>> } | null = null

const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const primary = (value: unknown) => record(value).primaryValue
const strings = (value: unknown) => Array.isArray(value) ? value.flatMap((entry) => typeof entry === 'string' ? [entry.trim()] : []).filter(Boolean) : []
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const objectValues = (value: unknown, key: string) => Array.isArray(value) ? value.map((entry) => text(record(entry)[key])).filter(Boolean) : []
const fieldStrings = (value: unknown) => Array.isArray(value) ? strings(value) : [text(value)].filter(Boolean)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
const redactSecrets = (value: string) => value
  .replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+)/gi, '[redacted]')
  .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
const safeError = (error: unknown) => redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 1_000)

const addMusicSourceHealth = async (environment: Record<string, string>) => {
  environment.MUSICBRAINZ_USER_AGENT ||= 'Shoditsa/1.0 (https://shoditsa.ru; mailto:breneize@yandex.ru)'
  const signature = hash(['LASTFM_API_KEY', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'THEAUDIODB_API_KEY', 'MUSICBRAINZ_USER_AGENT', 'MUSIC_OUTBOUND_PROXY_URL'].map((key) => `${key}:${environment[key] ?? ''}`).join('|'))
  if (!musicHealthCache || musicHealthCache.signature !== signature || musicHealthCache.expiresAt <= Date.now()) {
    musicHealthCache = { signature, expiresAt: Date.now() + 15 * 60_000, result: await probeMusicSourceHealth(environment) }
  }
  environment.MUSIC_PIPELINE_DISABLED_SOURCES = musicHealthCache.result.disabledSources.join(',')
  environment.MUSIC_PIPELINE_SOURCE_HEALTH = JSON.stringify(musicHealthCache.result.sources)
  return musicHealthCache.result
}

const claim = async () => {
  const claimed = await db.execute(sql`
    update background_jobs set status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now(), worker_id = ${config.workerId}, attempts = attempts + 1
    where id = (
      select id from background_jobs
      where status = 'queued' and (next_retry_at is null or next_retry_at <= now())
      order by "createdAt" for update skip locked limit 1
    ) returning id
  `)
  const id = Array.from(claimed as Iterable<{ id: string }>)[0]?.id
  return id ? (await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).limit(1))[0] : null
}

const runCommand = async (args: string[], runId: string, jobId: string, integrationEnv: Record<string, string>) => {
  const allowed = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'NODE_ENV']
  const env = Object.fromEntries(allowed.flatMap((key) => process.env[key] == null ? [] : [[key, process.env[key]!]]))
  Object.assign(env, integrationEnv)
  env.ENRICHMENT_DATA_ROOT = resolve(config.enrichmentDataRoot)
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  const append = (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-12_000) }
  child.stdout.on('data', append); child.stderr.on('data', append)
  const heartbeat = setInterval(async () => {
    const cancellation = await db.select({ cancelRequestedAt: pipelineRuns.cancelRequestedAt }).from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1)
    if (cancellation[0]?.cancelRequestedAt) child.kill('SIGTERM')
    await Promise.all([
      db.update(backgroundJobs).set({ heartbeatAt: new Date(), progress: { message: output.split(/\r?\n/).filter(Boolean).at(-1) ?? 'Выполняется' } }).where(eq(backgroundJobs.id, jobId)),
      db.update(pipelineRuns).set({ heartbeatAt: new Date(), logExcerpt: redactSecrets(output) }).where(eq(pipelineRuns.id, runId)),
    ])
  }, config.workerHeartbeatIntervalMs)
  try {
    const exitCode = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit) })
    if (exitCode !== 0) throw new Error(output.split(/\r?\n/).filter(Boolean).slice(-8).join('\n') || `Pipeline worker exited with ${exitCode}`)
    return output
  } finally { clearInterval(heartbeat) }
}

const manifestFileFor = async (enrichmentRoot: string, domain: string, runId: string, jobId: string) => {
  const directory = join(enrichmentRoot, domain, 'worker-manifests')
  await mkdir(directory, { recursive: true })
  return join(directory, `${runId}-${jobId}.json`)
}

const loadManifestOutputs = async (enrichmentRoot: string, manifestFile: string, domain: string, expectedItems: number | null) => {
  const manifest = await loadPipelineResultManifest(enrichmentRoot, manifestFile, domain)
  if (expectedItems != null && manifest.length !== expectedItems) {
    throw new Error(`${domain} pipeline manifest has ${manifest.length} records, expected ${expectedItems}`)
  }
  const outputs: Array<{ file: string; raw: Json }> = []
  const failures: Array<{ key: string; error: string }> = []
  for (const entry of manifest) {
    if (!entry.file) failures.push({ key: entry.key, error: entry.error ?? 'Pipeline item failed' })
    else outputs.push({ file: entry.file, raw: JSON.parse(await readFile(entry.file, 'utf8')) as Json })
  }
  return { outputs, failures }
}

const saveManifestFailures = async (runId: string, failures: Array<{ key: string; error: string }>) => {
  for (const failure of failures) {
    await db.insert(pipelineRunItems).values({
      runId, entityKey: failure.key, status: 'failed', proposedJson: null, warningsJson: [failure.error],
      idempotencyKey: `${runId}:${failure.key}`, errorCode: 'PIPELINE_ITEM_PROCESSING_FAILED', safeErrorMessage: safeError(failure.error),
    }).onConflictDoUpdate({
      target: pipelineRunItems.idempotencyKey,
      set: { proposedJson: null, warningsJson: [failure.error], updatedAt: new Date(), status: 'failed', errorCode: 'PIPELINE_ITEM_PROCESSING_FAILED', safeErrorMessage: safeError(failure.error) },
    })
  }
}

const saveProcessingFailure = async (runId: string, entityKey: string, error: unknown, warnings: unknown[] = []) => {
  const message = safeError(error)
  await db.insert(pipelineRunItems).values({
    runId, entityKey, status: 'failed', proposedJson: null, warningsJson: [...warnings, message],
    idempotencyKey: `${runId}:${entityKey}`, errorCode: 'PIPELINE_ITEM_MAPPING_FAILED', safeErrorMessage: message,
  }).onConflictDoUpdate({
    target: pipelineRunItems.idempotencyKey,
    set: { proposedJson: null, warningsJson: [...warnings, message], updatedAt: new Date(), status: 'failed', errorCode: 'PIPELINE_ITEM_MAPPING_FAILED', safeErrorMessage: message },
  })
}

const loadRunMetrics = async (runId: string) => {
  const rows = await db.select({ status: pipelineRunItems.status, confidence: pipelineRunItems.confidenceJson }).from(pipelineRunItems).where(eq(pipelineRunItems.runId, runId))
  const failedStatuses = new Set(['failed', 'rejected', 'conflict'])
  const responses = new Map<string, Json>()
  for (const row of rows) {
    const usage = record(record(row.confidence).usage)
    for (const raw of Array.isArray(usage.responses) ? usage.responses : []) {
      const response = record(raw)
      const identity = text(response.responseId) || hash(JSON.stringify(response))
      if (!responses.has(identity)) responses.set(identity, response)
    }
  }
  const actualCost = Number([...responses.values()].reduce((sum, response) => sum + Number(response.costUsd ?? 0), 0).toFixed(8))
  const itemsFailed = rows.filter((row) => failedStatuses.has(row.status)).length
  return { itemsProcessed: rows.length, itemsSucceeded: rows.length - itemsFailed, itemsFailed, actualCost }
}

const mapMusicRecord = (raw: Json) => {
  const source = record(raw.record)
  const artistKey = text(source.artistKey) || text(raw.entityKey)
  const canonical = text(primary(source.canonicalName)) || text(record(source.input).artist) || artistKey
  const titleRu = /[а-яё]/i.test(canonical) ? canonical : text(primary(source.displayNameRu)) || canonical
  const titleOriginal = text(primary(source.displayNameEn)) || canonical
  const aliases = strings(primary(source.aliases)).filter((entry) => entry !== titleRu && entry !== titleOriginal)
  const genres = [...new Set([...strings(primary(source.genres)), ...strings(primary(source.styles)), ...strings(primary(source.moods))])]
  const imageCandidates = [...strings(primary(source.imageCandidates)), ...objectValues(primary(source.imageCandidates), 'url')]
  const topTracks = Array.isArray(primary(source.topTracks)) ? primary(source.topTracks) as unknown[] : []
  const topAlbums = Array.isArray(primary(source.topAlbums)) ? primary(source.topAlbums) as unknown[] : []
  const hint = text(record(source.agentHint).text)
  return {
    id: `music:${artistKey}`, mode: 'music', titleRu, titleOriginal, alternativeTitles: aliases,
    year: Number(primary(source.beginYear)) || undefined, endYear: Number(primary(source.endYear)) || undefined,
    countries: [...fieldStrings(primary(source.country)), ...fieldStrings(primary(source.area))], genres,
    popularityScore: Number(primary(record(source.popularityMetrics).listeners)) || 0,
    posterUrl: imageCandidates[0] ?? null, headerUrl: imageCandidates[1] ?? null, backdropUrl: imageCandidates[2] ?? null,
    screenshots: imageCandidates.slice(0, 6), description: text(primary(source.biography)) || `Музыкальный исполнитель${genres.length ? ` · жанры: ${genres.slice(0, 3).join(', ')}` : ''}`,
    plotHint: hint || null, slogan: text(record(topTracks[0]).title) || null,
    facts: [...topTracks.slice(0, 3).map((entry) => `Трек: ${text(record(entry).title)}`).filter(Boolean), ...topAlbums.slice(0, 2).map((entry) => `Альбом: ${text(record(entry).title)}`).filter(Boolean)],
    aliases, artistType: primary(source.artistType) ?? null, activeState: primary(source.isActive) ?? null,
    topTracks, topAlbums, members: primary(source.members) ?? [], associatedActs: primary(source.associatedActs) ?? [],
    musicLinks: [...strings(primary(source.officialLinks)), ...objectValues(primary(source.officialLinks), 'url'), ...strings(primary(source.socialLinks)), ...objectValues(primary(source.socialLinks), 'url')],
    allowedInGame: false, contentStatus: 'review', dataQuality: { assessment: raw.assessment, hintValidation: raw.hintValidation, sourceStatus: record(source.pipeline).sourceStatus },
  }
}

const handleMusic = async (job: typeof backgroundJobs.$inferSelect) => {
  if (!job.pipelineRunId) throw new Error('music_pipeline job has no pipelineRunId')
  const run = (await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, job.pipelineRunId)).limit(1))[0]
  if (!run) throw new Error('Pipeline run not found')
  if (run.cancelRequestedAt) {
    await db.update(pipelineRuns).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(pipelineRuns.id, run.id))
    return { runId: run.id, cancelled: true }
  }
  const input = record(run.inputDefinitionJson); const settings = record(run.settingsJson); const jobPayload = record(job.payload)
  const scenario = text(input.scenario) || 'discover'; const maxItems = Number(settings.maxItems) || run.itemsTotal || 5
  await db.update(pipelineRuns).set({ status: 'running', startedAt: run.startedAt ?? new Date(), heartbeatAt: new Date(), workerId: config.workerId }).where(eq(pipelineRuns.id, run.id))
  const enrichmentRoot = resolve(config.enrichmentDataRoot)
  await mkdir(join(enrichmentRoot, 'music'), { recursive: true })
  const integrationEnv = await loadIntegrationEnvironment(db, config)
  await addMusicSourceHealth(integrationEnv)
  const manifestFile = await manifestFileFor(enrichmentRoot, 'music', run.id, job.id)
  const common = [`--max-items=${maxItems}`, `--ai=${text(settings.aiMode) || 'auto'}`, `--model=${text(settings.model) || config.musicPipelineModel}`, `--result-manifest=${manifestFile}`]
  if (settings.webSearch === false) common.push('--no-ai-web-search')
  let command: string[]
  let manualBatchSize = 0
  let manualNextOffset = 0
  if (scenario === 'manual') {
    const artists = Array.isArray(input.artists) ? input.artists.map(record).filter((entry) => text(entry.artist)) : []
    const offset = Math.max(0, Number(jobPayload.offset) || 0)
    const batch = artists.slice(offset, offset + maxItems)
    if (!batch.length) throw new Error('Manual music pipeline has no artists left to process')
    manualBatchSize = batch.length
    manualNextOffset = offset + batch.length
    const seed = batch.map((entry, index) => ({
      artist: text(entry.artist), rank: offset + index + 1,
      ...(text(entry.country) ? { country: text(entry.country) } : {}),
      ...(text(entry.hint) ? { provenance: { reason: text(entry.hint), source: 'admin_manual_list' } } : {}),
    }))
    const seedFile = join(enrichmentRoot, 'music', `admin-${run.id}-batch-${offset}.json`)
    await writeFile(seedFile, JSON.stringify(seed, null, 2), 'utf8')
    command = ['scripts/enrichment-agent/run.mjs', 'music', 'run', `--source=${seedFile}`, `--max-items=${batch.length}`, '--include-existing-results', ...common.filter((entry) => !entry.startsWith('--max-items='))]
  }
  else if (scenario === 'discover') command = ['scripts/music/run-agent-cycle.mjs', ...common]
  else if (scenario === 'review') command = ['scripts/enrichment-agent/run.mjs', 'music', 'run', '--retry-review', '--ai=always', ...common.filter((entry) => !entry.startsWith('--ai='))]
  else if (scenario === 'selected') {
    const ids = Array.isArray(input.itemIds) ? input.itemIds.map(String) : []
    const active = await db.select({ payload: contentItemVersions.payload }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId)).where(and(eq(contentRevisions.status, 'active'), inArray(contentItemVersions.itemId, ids)))
    const seed = active.map((entry, index) => ({ artist: text(record(entry.payload).titleOriginal) || text(record(entry.payload).titleRu), rank: index + 1 }))
    const seedFile = join(enrichmentRoot, 'music', `admin-${run.id}-seed.json`); await writeFile(seedFile, JSON.stringify(seed, null, 2), 'utf8')
    command = ['scripts/enrichment-agent/run.mjs', 'music', 'run', `--source=${seedFile}`, ...common]
  } else command = ['scripts/enrichment-agent/run.mjs', 'music', 'run', `--source=${join(enrichmentRoot, 'music', 'discovery', 'discovered-candidates.json')}`, ...common]
  const output = await runCommand(command, run.id, job.id, integrationEnv as Record<string, string>)
  const manifest = await loadManifestOutputs(enrichmentRoot, manifestFile, 'music', scenario === 'manual' ? manualBatchSize : null)
  const selectedFresh = manifest.outputs
  const usage = collectMusicRecordUsage(selectedFresh.map((entry) => entry.raw))
  await saveManifestFailures(run.id, manifest.failures)
  let failed = manifest.failures.length
  let succeeded = 0
  for (const entry of selectedFresh) {
    const warnings = [...(Array.isArray(record(entry.raw.assessment).reviewReasons) ? record(entry.raw.assessment).reviewReasons as unknown[] : []), ...(entry.raw.aiError ? [entry.raw.aiError] : [])]
    const entityKey = text(entry.raw.entityKey) || basename(entry.file, '.json')
    const rejected = entry.raw.disposition === 'rejected' || record(entry.raw.assessment).hardFailure === true
    if (rejected) {
      await db.insert(pipelineRunItems).values({
        runId: run.id, entityKey, status: 'failed', proposedJson: null, warningsJson: warnings,
        sourcesJson: record(record(entry.raw.record).pipeline).sourceStatus ?? null,
        confidenceJson: { assessment: entry.raw.assessment, aiReview: entry.raw.aiReview, hintValidation: entry.raw.hintValidation, usage },
        rawResultRef: relative(enrichmentRoot, entry.file).replaceAll('\\', '/'), idempotencyKey: `${run.id}:${entityKey}`,
        errorCode: 'PIPELINE_IDENTITY_REJECTED', safeErrorMessage: 'Результат отклонён: личность исполнителя или обязательные данные не подтверждены',
      }).onConflictDoUpdate({ target: pipelineRunItems.idempotencyKey, set: { proposedJson: null, warningsJson: warnings, updatedAt: new Date(), status: 'failed', errorCode: 'PIPELINE_IDENTITY_REJECTED' } })
      failed += 1
      continue
    }
    try {
      const mapped = mapMusicRecord(entry.raw); const itemId = text(mapped.id)
      const before = await db.select({ id: contentItemVersions.id, payload: contentItemVersions.payload }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId)).where(and(eq(contentRevisions.status, 'active'), eq(contentItemVersions.itemId, itemId))).limit(1)
      const beforePayload = record(before[0]?.payload)
      const proposed = before[0] ? { ...beforePayload, ...mapped, allowedInGame: beforePayload.allowedInGame ?? mapped.allowedInGame } : mapped
      await db.insert(pipelineRunItems).values({
        runId: run.id, entityKey, cardId: before[0] ? itemId : null,
        inputItemVersionId: before[0]?.id ?? null, status: 'review_required', beforeJson: before[0]?.payload ?? null, proposedJson: proposed,
        warningsJson: warnings, sourcesJson: record(record(entry.raw.record).pipeline).sourceStatus ?? null,
        confidenceJson: { assessment: entry.raw.assessment, aiReview: entry.raw.aiReview, hintValidation: entry.raw.hintValidation, usage },
        rawResultRef: relative(enrichmentRoot, entry.file).replaceAll('\\', '/'), idempotencyKey: `${run.id}:${text(entry.raw.entityKey) || basename(entry.file)}`,
      }).onConflictDoUpdate({ target: pipelineRunItems.idempotencyKey, set: { proposedJson: proposed, warningsJson: warnings, updatedAt: new Date(), status: 'review_required' } })
      succeeded += 1
    } catch (error) { await saveProcessingFailure(run.id, entityKey, error, warnings); failed += 1 }
  }
  const metrics = await loadRunMetrics(run.id)
  if (scenario === 'manual') {
    const artists = Array.isArray(input.artists) ? input.artists : []
    const { itemsProcessed, itemsSucceeded, itemsFailed, actualCost } = metrics
    const hasMore = manualNextOffset < artists.length
    await db.update(pipelineRuns).set({
      status: hasMore ? 'queued' : itemsSucceeded ? itemsFailed ? 'partially_failed' : 'review_required' : 'failed',
      itemsProcessed, itemsSucceeded, itemsFailed, actualCost: String(actualCost), heartbeatAt: new Date(),
      ...(hasMore ? {} : { finishedAt: new Date() }),
      logExcerpt: output.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]').slice(-8_000),
      ...(!hasMore && !itemsSucceeded ? { errorCode: 'NO_REVIEWABLE_RESULTS', safeErrorMessage: 'Пайплайн не создал результатов для проверки' } : {}),
    }).where(eq(pipelineRuns.id, run.id))
    if (hasMore) {
      await db.insert(backgroundJobs).values({
        type: 'music_pipeline', idempotencyKey: `${run.id}:manual:${manualNextOffset}`, createdBy: run.createdBy,
        pipelineRunId: run.id, payload: { runId: run.id, offset: manualNextOffset },
      }).onConflictDoNothing()
    }
    return { runId: run.id, batch: manualBatchSize, offset: manualNextOffset, hasMore, succeeded, failed, usage }
  }
  await db.update(pipelineRuns).set({
    status: metrics.itemsSucceeded ? metrics.itemsFailed ? 'partially_failed' : 'review_required' : 'failed', itemsTotal: metrics.itemsProcessed || run.itemsTotal,
    ...metrics, actualCost: String(metrics.actualCost), finishedAt: new Date(), heartbeatAt: new Date(),
    logExcerpt: output.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]').slice(-8_000),
    ...(!metrics.itemsSucceeded ? { errorCode: 'NO_REVIEWABLE_RESULTS', safeErrorMessage: 'Пайплайн не создал результатов для проверки' } : {}),
  }).where(eq(pipelineRuns.id, run.id))
  return { runId: run.id, items: selectedFresh.length, succeeded, failed, usage }
}

const mapMovieRecord = (raw: Json) => {
  const source = record(raw.record)
  const kinopoiskId = Number(source.kinopoiskId)
  if (!Number.isInteger(kinopoiskId) || kinopoiskId <= 0) throw new Error('Movie record has no valid kinopoiskId')
  return {
    ...source,
    id: text(source.id) || `kp_${kinopoiskId}`,
    mode: 'movie',
    titleRu: text(source.titleRu) || `Кинопоиск #${kinopoiskId}`,
    titleOriginal: typeof source.titleOriginal === 'string' ? source.titleOriginal : '',
    alternativeTitles: Array.isArray(source.alternativeTitles) ? source.alternativeTitles : [],
    allowedInGame: false,
    contentStatus: 'review',
  }
}

const handleMovie = async (job: typeof backgroundJobs.$inferSelect) => {
  if (!job.pipelineRunId) throw new Error('movie_pipeline job has no pipelineRunId')
  const run = (await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, job.pipelineRunId)).limit(1))[0]
  if (!run) throw new Error('Pipeline run not found')
  if (run.cancelRequestedAt) {
    await db.update(pipelineRuns).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(pipelineRuns.id, run.id))
    return { runId: run.id, cancelled: true }
  }
  const input = record(run.inputDefinitionJson); const settings = record(run.settingsJson); const jobPayload = record(job.payload)
  const scenario = text(input.scenario) || 'discover'; const maxItems = Number(settings.maxItems) || run.itemsTotal || 5
  await db.update(pipelineRuns).set({ status: 'running', startedAt: run.startedAt ?? new Date(), heartbeatAt: new Date(), workerId: config.workerId }).where(eq(pipelineRuns.id, run.id))
  const enrichmentRoot = resolve(config.enrichmentDataRoot)
  await mkdir(join(enrichmentRoot, 'movie'), { recursive: true })
  const integrationEnv = await loadIntegrationEnvironment(db, config)
  if (!integrationEnv.KINOPOISK_API_KEYS) throw new Error('Kinopoisk API key is not configured')
  const manifestFile = await manifestFileFor(enrichmentRoot, 'movie', run.id, job.id)
  const common = [`--max-items=${maxItems}`, `--ai=${text(settings.aiMode) || 'auto'}`, `--model=${text(settings.model) || config.musicPipelineModel}`, `--result-manifest=${manifestFile}`]
  if (settings.webSearch === false) common.push('--no-ai-web-search')
  let command: string[]; let manualBatchSize = 0; let manualNextOffset = 0
  if (scenario === 'manual') {
    const movies = Array.isArray(input.movies) ? input.movies.map(record).filter((entry) => Number.isInteger(Number(entry.kinopoiskId))) : []
    const offset = Math.max(0, Number(jobPayload.offset) || 0)
    const batch = movies.slice(offset, offset + maxItems)
    if (!batch.length) throw new Error('Manual movie pipeline has no movies left to process')
    manualBatchSize = batch.length; manualNextOffset = offset + batch.length
    const seed = batch.map((entry, index) => ({
      kinopoiskId: Number(entry.kinopoiskId), rank: offset + index + 1,
      ...(text(entry.hint) ? { hint: text(entry.hint) } : {}),
    }))
    const seedFile = join(enrichmentRoot, 'movie', `admin-${run.id}-batch-${offset}.json`)
    await writeFile(seedFile, JSON.stringify(seed, null, 2), 'utf8')
    command = ['scripts/enrichment-agent/run.mjs', 'movie', 'run', `--source=${seedFile}`, `--max-items=${batch.length}`, '--include-existing-results', ...common.filter((entry) => !entry.startsWith('--max-items='))]
  } else if (scenario === 'discover') {
    command = ['scripts/movies/run-agent-cycle.mjs', ...common]
  } else if (scenario === 'review') {
    command = ['scripts/enrichment-agent/run.mjs', 'movie', 'run', `--source=${join(enrichmentRoot, 'movie', 'discovery', 'discovered-candidates.json')}`, '--retry-review', '--ai=always', ...common.filter((entry) => !entry.startsWith('--ai='))]
  } else if (scenario === 'selected') {
    const ids = Array.isArray(input.itemIds) ? input.itemIds.map(String) : []
    const active = await db.select({ payload: contentItemVersions.payload }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId)).where(and(eq(contentRevisions.status, 'active'), inArray(contentItemVersions.itemId, ids)))
    const seed = active.map((entry, index) => ({ kinopoiskId: Number(record(entry.payload).kinopoiskId), rank: index + 1 })).filter((entry) => Number.isInteger(entry.kinopoiskId) && entry.kinopoiskId > 0)
    if (!seed.length) throw new Error('Selected cards have no Kinopoisk IDs')
    const seedFile = join(enrichmentRoot, 'movie', `admin-${run.id}-seed.json`)
    await writeFile(seedFile, JSON.stringify(seed, null, 2), 'utf8')
    command = ['scripts/enrichment-agent/run.mjs', 'movie', 'run', `--source=${seedFile}`, ...common]
  } else {
    command = ['scripts/enrichment-agent/run.mjs', 'movie', 'run', `--source=${join(enrichmentRoot, 'movie', 'discovery', 'discovered-candidates.json')}`, ...common]
  }
  const output = await runCommand(command, run.id, job.id, integrationEnv as Record<string, string>)
  const manifest = await loadManifestOutputs(enrichmentRoot, manifestFile, 'movie', scenario === 'manual' ? manualBatchSize : null)
  const selectedFresh = manifest.outputs
  const usage = collectMusicRecordUsage(selectedFresh.map((entry) => entry.raw))
  await saveManifestFailures(run.id, manifest.failures)
  let failed = manifest.failures.length; let succeeded = 0
  for (const entry of selectedFresh) {
    const warnings = [...(Array.isArray(record(entry.raw.assessment).reviewReasons) ? record(entry.raw.assessment).reviewReasons as unknown[] : []), ...(entry.raw.aiError ? [entry.raw.aiError] : [])]
    const entityKey = text(entry.raw.entityKey) || basename(entry.file, '.json')
    const rejected = entry.raw.disposition === 'rejected' || record(entry.raw.assessment).hardFailure === true
    if (rejected) {
      await db.insert(pipelineRunItems).values({
        runId: run.id, entityKey, status: 'failed', proposedJson: null, warningsJson: warnings,
        sourcesJson: record(record(entry.raw.record).dataQuality), confidenceJson: { assessment: entry.raw.assessment, aiReview: entry.raw.aiReview, hintValidation: entry.raw.hintValidation, usage },
        rawResultRef: relative(enrichmentRoot, entry.file).replaceAll('\\', '/'), idempotencyKey: `${run.id}:${entityKey}`,
        errorCode: 'PIPELINE_MOVIE_REJECTED', safeErrorMessage: 'Результат отклонён: тип фильма или обязательные данные не подтверждены',
      }).onConflictDoUpdate({ target: pipelineRunItems.idempotencyKey, set: { proposedJson: null, warningsJson: warnings, updatedAt: new Date(), status: 'failed', errorCode: 'PIPELINE_MOVIE_REJECTED' } })
      failed += 1; continue
    }
    try {
      const mapped = mapMovieRecord(entry.raw); const itemId = text(mapped.id)
      const before = await db.select({ id: contentItemVersions.id, payload: contentItemVersions.payload }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId)).where(and(eq(contentRevisions.status, 'active'), eq(contentItemVersions.itemId, itemId))).limit(1)
      const beforePayload = record(before[0]?.payload)
      const proposed = before[0] ? { ...beforePayload, ...mapped, allowedInGame: beforePayload.allowedInGame ?? mapped.allowedInGame } : mapped
      await db.insert(pipelineRunItems).values({
        runId: run.id, entityKey, cardId: before[0] ? itemId : null, inputItemVersionId: before[0]?.id ?? null,
        status: 'review_required', beforeJson: before[0]?.payload ?? null, proposedJson: proposed, warningsJson: warnings,
        sourcesJson: record(record(entry.raw.record).dataQuality), confidenceJson: { assessment: entry.raw.assessment, aiReview: entry.raw.aiReview, hintValidation: entry.raw.hintValidation, usage },
        rawResultRef: relative(enrichmentRoot, entry.file).replaceAll('\\', '/'), idempotencyKey: `${run.id}:${entityKey}`,
      }).onConflictDoUpdate({ target: pipelineRunItems.idempotencyKey, set: { proposedJson: proposed, warningsJson: warnings, updatedAt: new Date(), status: 'review_required' } })
      succeeded += 1
    } catch (error) { await saveProcessingFailure(run.id, entityKey, error, warnings); failed += 1 }
  }
  const metrics = await loadRunMetrics(run.id)
  if (scenario === 'manual') {
    const movies = Array.isArray(input.movies) ? input.movies : []
    const { itemsProcessed, itemsSucceeded, itemsFailed, actualCost } = metrics
    const hasMore = manualNextOffset < movies.length
    await db.update(pipelineRuns).set({
      status: hasMore ? 'queued' : itemsSucceeded ? itemsFailed ? 'partially_failed' : 'review_required' : 'failed',
      itemsProcessed, itemsSucceeded, itemsFailed, actualCost: String(actualCost), heartbeatAt: new Date(), ...(hasMore ? {} : { finishedAt: new Date() }),
      logExcerpt: output.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]').slice(-8_000),
      ...(!hasMore && !itemsSucceeded ? { errorCode: 'NO_REVIEWABLE_RESULTS', safeErrorMessage: 'Пайплайн не создал результатов для проверки' } : {}),
    }).where(eq(pipelineRuns.id, run.id))
    if (hasMore) await db.insert(backgroundJobs).values({ type: 'movie_pipeline', idempotencyKey: `${run.id}:manual:${manualNextOffset}`, createdBy: run.createdBy, pipelineRunId: run.id, payload: { runId: run.id, offset: manualNextOffset } }).onConflictDoNothing()
    return { runId: run.id, batch: manualBatchSize, offset: manualNextOffset, hasMore, succeeded, failed, usage }
  }
  await db.update(pipelineRuns).set({
    status: metrics.itemsSucceeded ? metrics.itemsFailed ? 'partially_failed' : 'review_required' : 'failed', itemsTotal: metrics.itemsProcessed || run.itemsTotal,
    ...metrics, actualCost: String(metrics.actualCost), finishedAt: new Date(), heartbeatAt: new Date(),
    logExcerpt: output.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]').slice(-8_000),
    ...(!metrics.itemsSucceeded ? { errorCode: 'NO_REVIEWABLE_RESULTS', safeErrorMessage: 'Пайплайн не создал результатов для проверки' } : {}),
  }).where(eq(pipelineRuns.id, run.id))
  return { runId: run.id, items: selectedFresh.length, succeeded, failed, usage }
}

const mapAnimeRecord = (raw: Json) => {
  const source = record(raw.record)
  const shikimoriId = Number(source.shikimoriId)
  if (!Number.isInteger(shikimoriId) || shikimoriId <= 0) throw new Error('Anime record has no valid shikimoriId')
  return {
    ...source,
    id: text(source.id) || `shiki_${shikimoriId}`,
    mode: 'anime',
    titleRu: text(source.titleRu) || `Shikimori #${shikimoriId}`,
    titleOriginal: typeof source.titleOriginal === 'string' ? source.titleOriginal : '',
    alternativeTitles: Array.isArray(source.alternativeTitles) ? source.alternativeTitles : [],
    allowedInGame: false,
    contentStatus: 'review',
  }
}

const handleAnime = async (job: typeof backgroundJobs.$inferSelect) => {
  if (!job.pipelineRunId) throw new Error('anime_pipeline job has no pipelineRunId')
  const run = (await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, job.pipelineRunId)).limit(1))[0]
  if (!run) throw new Error('Pipeline run not found')
  if (run.cancelRequestedAt) {
    await db.update(pipelineRuns).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(pipelineRuns.id, run.id))
    return { runId: run.id, cancelled: true }
  }
  const input = record(run.inputDefinitionJson); const settings = record(run.settingsJson); const jobPayload = record(job.payload)
  const scenario = text(input.scenario) || 'discover'; const maxItems = Number(settings.maxItems) || run.itemsTotal || 5
  await db.update(pipelineRuns).set({ status: 'running', startedAt: run.startedAt ?? new Date(), heartbeatAt: new Date(), workerId: config.workerId }).where(eq(pipelineRuns.id, run.id))
  const enrichmentRoot = resolve(config.enrichmentDataRoot)
  await mkdir(join(enrichmentRoot, 'anime'), { recursive: true })
  const integrationEnv = await loadIntegrationEnvironment(db, config)
  if (!integrationEnv.SHIKIMORI_USER_AGENT) throw new Error('Shikimori User-Agent is not configured')
  const manifestFile = await manifestFileFor(enrichmentRoot, 'anime', run.id, job.id)
  const common = [`--max-items=${maxItems}`, `--ai=${text(settings.aiMode) || 'auto'}`, `--model=${text(settings.model) || config.musicPipelineModel}`, `--result-manifest=${manifestFile}`]
  if (settings.webSearch === false) common.push('--no-ai-web-search')
  let command: string[]; let manualBatchSize = 0; let manualNextOffset = 0
  if (scenario === 'manual') {
    const anime = Array.isArray(input.anime) ? input.anime.map(record).filter((entry) => Number.isInteger(Number(entry.shikimoriId))) : []
    const offset = Math.max(0, Number(jobPayload.offset) || 0)
    const batch = anime.slice(offset, offset + maxItems)
    if (!batch.length) throw new Error('Manual anime pipeline has no titles left to process')
    manualBatchSize = batch.length; manualNextOffset = offset + batch.length
    const seed = batch.map((entry, index) => ({
      shikimoriId: Number(entry.shikimoriId), rank: offset + index + 1,
      ...(text(entry.hint) ? { hint: text(entry.hint) } : {}),
    }))
    const seedFile = join(enrichmentRoot, 'anime', `admin-${run.id}-batch-${offset}.json`)
    await writeFile(seedFile, JSON.stringify(seed, null, 2), 'utf8')
    command = ['scripts/enrichment-agent/run.mjs', 'anime', 'run', `--source=${seedFile}`, `--max-items=${batch.length}`, '--include-existing-results', ...common.filter((entry) => !entry.startsWith('--max-items='))]
  } else if (scenario === 'discover') {
    command = ['scripts/anime/run-agent-cycle.mjs', ...common]
  } else if (scenario === 'review') {
    command = ['scripts/enrichment-agent/run.mjs', 'anime', 'run', `--source=${join(enrichmentRoot, 'anime', 'discovery', 'discovered-candidates.json')}`, '--retry-review', '--ai=always', ...common.filter((entry) => !entry.startsWith('--ai='))]
  } else if (scenario === 'selected') {
    const ids = Array.isArray(input.itemIds) ? input.itemIds.map(String) : []
    const active = await db.select({ payload: contentItemVersions.payload }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId)).where(and(eq(contentRevisions.status, 'active'), inArray(contentItemVersions.itemId, ids)))
    const seed = active.map((entry, index) => ({ shikimoriId: Number(record(entry.payload).shikimoriId), rank: index + 1 })).filter((entry) => Number.isInteger(entry.shikimoriId) && entry.shikimoriId > 0)
    if (!seed.length) throw new Error('Selected cards have no Shikimori IDs')
    const seedFile = join(enrichmentRoot, 'anime', `admin-${run.id}-seed.json`)
    await writeFile(seedFile, JSON.stringify(seed, null, 2), 'utf8')
    command = ['scripts/enrichment-agent/run.mjs', 'anime', 'run', `--source=${seedFile}`, ...common]
  } else {
    command = ['scripts/enrichment-agent/run.mjs', 'anime', 'run', `--source=${join(enrichmentRoot, 'anime', 'discovery', 'discovered-candidates.json')}`, ...common]
  }
  const output = await runCommand(command, run.id, job.id, integrationEnv as Record<string, string>)
  const manifest = await loadManifestOutputs(enrichmentRoot, manifestFile, 'anime', scenario === 'manual' ? manualBatchSize : null)
  const selectedFresh = manifest.outputs
  const usage = collectMusicRecordUsage(selectedFresh.map((entry) => entry.raw))
  await saveManifestFailures(run.id, manifest.failures)
  let failed = manifest.failures.length; let succeeded = 0
  for (const entry of selectedFresh) {
    const warnings = [...(Array.isArray(record(entry.raw.assessment).reviewReasons) ? record(entry.raw.assessment).reviewReasons as unknown[] : []), ...(entry.raw.aiError ? [entry.raw.aiError] : [])]
    const entityKey = text(entry.raw.entityKey) || basename(entry.file, '.json')
    const rejected = entry.raw.disposition === 'rejected' || record(entry.raw.assessment).hardFailure === true
    if (rejected) {
      await db.insert(pipelineRunItems).values({
        runId: run.id, entityKey, status: 'failed', proposedJson: null, warningsJson: warnings,
        sourcesJson: record(record(entry.raw.record).dataQuality), confidenceJson: { assessment: entry.raw.assessment, aiReview: entry.raw.aiReview, hintValidation: entry.raw.hintValidation, usage },
        rawResultRef: relative(enrichmentRoot, entry.file).replaceAll('\\', '/'), idempotencyKey: `${run.id}:${entityKey}`,
        errorCode: 'PIPELINE_ANIME_REJECTED', safeErrorMessage: 'Результат отклонён: тип, возрастной рейтинг или обязательные данные аниме не подтверждены',
      }).onConflictDoUpdate({ target: pipelineRunItems.idempotencyKey, set: { proposedJson: null, warningsJson: warnings, updatedAt: new Date(), status: 'failed', errorCode: 'PIPELINE_ANIME_REJECTED' } })
      failed += 1; continue
    }
    try {
      const mapped = mapAnimeRecord(entry.raw); const itemId = text(mapped.id)
      const before = await db.select({ id: contentItemVersions.id, payload: contentItemVersions.payload }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId)).where(and(eq(contentRevisions.status, 'active'), eq(contentItemVersions.itemId, itemId))).limit(1)
      const beforePayload = record(before[0]?.payload)
      const proposed = before[0] ? { ...beforePayload, ...mapped, allowedInGame: beforePayload.allowedInGame ?? mapped.allowedInGame } : mapped
      await db.insert(pipelineRunItems).values({
        runId: run.id, entityKey, cardId: before[0] ? itemId : null, inputItemVersionId: before[0]?.id ?? null,
        status: 'review_required', beforeJson: before[0]?.payload ?? null, proposedJson: proposed, warningsJson: warnings,
        sourcesJson: record(record(entry.raw.record).dataQuality), confidenceJson: { assessment: entry.raw.assessment, aiReview: entry.raw.aiReview, hintValidation: entry.raw.hintValidation, usage },
        rawResultRef: relative(enrichmentRoot, entry.file).replaceAll('\\', '/'), idempotencyKey: `${run.id}:${entityKey}`,
      }).onConflictDoUpdate({ target: pipelineRunItems.idempotencyKey, set: { proposedJson: proposed, warningsJson: warnings, updatedAt: new Date(), status: 'review_required' } })
      succeeded += 1
    } catch (error) { await saveProcessingFailure(run.id, entityKey, error, warnings); failed += 1 }
  }
  const metrics = await loadRunMetrics(run.id)
  if (scenario === 'manual') {
    const anime = Array.isArray(input.anime) ? input.anime : []
    const { itemsProcessed, itemsSucceeded, itemsFailed, actualCost } = metrics
    const hasMore = manualNextOffset < anime.length
    await db.update(pipelineRuns).set({
      status: hasMore ? 'queued' : itemsSucceeded ? itemsFailed ? 'partially_failed' : 'review_required' : 'failed',
      itemsProcessed, itemsSucceeded, itemsFailed, actualCost: String(actualCost), heartbeatAt: new Date(), ...(hasMore ? {} : { finishedAt: new Date() }),
      logExcerpt: output.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]').slice(-8_000),
      ...(!hasMore && !itemsSucceeded ? { errorCode: 'NO_REVIEWABLE_RESULTS', safeErrorMessage: 'Пайплайн не создал результатов для проверки' } : {}),
    }).where(eq(pipelineRuns.id, run.id))
    if (hasMore) await db.insert(backgroundJobs).values({ type: 'anime_pipeline', idempotencyKey: `${run.id}:manual:${manualNextOffset}`, createdBy: run.createdBy, pipelineRunId: run.id, payload: { runId: run.id, offset: manualNextOffset } }).onConflictDoNothing()
    return { runId: run.id, batch: manualBatchSize, offset: manualNextOffset, hasMore, succeeded, failed, usage }
  }
  await db.update(pipelineRuns).set({
    status: metrics.itemsSucceeded ? metrics.itemsFailed ? 'partially_failed' : 'review_required' : 'failed', itemsTotal: metrics.itemsProcessed || run.itemsTotal,
    ...metrics, actualCost: String(metrics.actualCost), finishedAt: new Date(), heartbeatAt: new Date(),
    logExcerpt: output.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]').slice(-8_000),
    ...(!metrics.itemsSucceeded ? { errorCode: 'NO_REVIEWABLE_RESULTS', safeErrorMessage: 'Пайплайн не создал результатов для проверки' } : {}),
  }).where(eq(pipelineRuns.id, run.id))
  return { runId: run.id, items: selectedFresh.length, succeeded, failed, usage }
}

const handleQuality = async () => {
  const active = (await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!active) throw new Error('Active revision not found')
  const items = await db.select().from(contentItemVersions).where(eq(contentItemVersions.revisionId, active.id))
  await db.update(contentQualityIssues).set({ status: 'resolved', resolvedAt: new Date() }).where(eq(contentQualityIssues.status, 'open'))
  let created = 0
  for (const item of items) {
    for (const issue of validateContentPayload(record(item.payload), item.mode)) {
      const fingerprint = hash(`${item.id}:${issue.code}:${issue.field}`)
      await db.insert(contentQualityIssues).values({ ruleKey: issue.code, severity: issue.level === 'error' ? 'critical' : 'warning', mode: item.mode, itemId: item.itemId, itemVersionId: item.id, field: issue.field, message: issue.message, fingerprint })
        .onConflictDoUpdate({ target: contentQualityIssues.fingerprint, set: {
          status: sql`case when ${contentQualityIssues.status} = 'accepted' and (${contentQualityIssues.acceptedUntil} is null or ${contentQualityIssues.acceptedUntil} > now()) then 'accepted' else 'open' end`,
          resolvedAt: null, message: issue.message, severity: issue.level === 'error' ? 'critical' : 'warning',
        } })
      created += 1
    }
  }
  const duplicates = await db.execute(sql`select mode::text, normalized_title, array_agg(item_id) ids from content_item_versions where revision_id = ${active.id} group by mode, normalized_title having count(*) > 1`)
  for (const duplicate of Array.from(duplicates as Iterable<{ mode: typeof items[number]['mode']; normalized_title: string; ids: string[] }>)) {
    for (const itemId of duplicate.ids) {
      const fingerprint = hash(`duplicate:${duplicate.mode}:${duplicate.normalized_title}:${itemId}`)
      await db.insert(contentQualityIssues).values({ ruleKey: 'duplicate_title', severity: 'warning', mode: duplicate.mode, itemId, field: 'titleRu', message: `Возможный дубликат названия: ${duplicate.ids.join(', ')}`, fingerprint }).onConflictDoNothing()
      created += 1
    }
  }
  return { checked: items.length, issues: created }
}

const handleUserExport = async (job: typeof backgroundJobs.$inferSelect) => {
  const userId = text(record(job.payload).userId)
  const [identity, profile, wallet, activeSessions] = await Promise.all([
    db.select({ id: user.id, email: user.email, name: user.name, isAnonymous: user.isAnonymous, createdAt: user.createdAt }).from(user).where(eq(user.id, userId)).limit(1),
    db.select().from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1),
    db.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).limit(1),
    db.select({ id: session.id, createdAt: session.createdAt, expiresAt: session.expiresAt }).from(session).where(eq(session.userId, userId)),
  ])
  return { exportedAt: new Date().toISOString(), user: identity[0] ?? null, profile: profile[0] ?? null, wallet: wallet[0] ?? null, authSessions: activeSessions }
}

const handleJob = async (job: typeof backgroundJobs.$inferSelect) => {
  if (job.type === 'content_revision_build') {
    const payload = record(job.payload); const workspaceId = text(payload.workspaceId)
    if (!job.createdBy || !workspaceId) throw new Error('Revision build job is incomplete')
    return buildWorkspaceRevision(db, { id: job.createdBy }, workspaceId, text(payload.requestId) || `job:${job.id}`)
  }
  if (job.type === 'content_quality_check' || job.type === 'media_check') return handleQuality()
  if (job.type === 'music_pipeline') return handleMusic(job)
  if (job.type === 'movie_pipeline') return handleMovie(job)
  if (job.type === 'anime_pipeline') return handleAnime(job)
  if (job.type === 'user_export') return handleUserExport(job)
  if (job.type === 'event_export') {
    const events = await loadAdminTimeline(db, { ...record(job.payload), limit: 10_000 } as AdminEventsQuery)
    return { exportedAt: new Date().toISOString(), items: events }
  }
  if (job.type === 'client_event_retention') {
    const removed = await db.delete(clientEvents).where(lt(clientEvents.occurredAt, new Date(Date.now() - 30 * 86_400_000))).returning({ id: clientEvents.id })
    return { removed: removed.length }
  }
  throw new Error(`Unsupported job type: ${job.type}`)
}

const work = async () => {
  while (!stopping) {
    const job = await claim()
    if (!job) { await sleep(config.workerPollIntervalMs); continue }
    try {
      const result = await handleJob(job)
      await db.update(backgroundJobs).set({ status: 'completed', result, progress: { percent: 100 }, finishedAt: new Date(), heartbeatAt: new Date() }).where(eq(backgroundJobs.id, job.id))
    } catch (error) {
      const message = safeError(error); const exhausted = job.attempts >= job.maxAttempts
      await db.update(backgroundJobs).set({
        status: exhausted ? 'failed' : 'queued', errorCode: 'JOB_HANDLER_FAILED', safeErrorMessage: message,
        finishedAt: exhausted ? new Date() : null, nextRetryAt: exhausted ? null : new Date(Date.now() + Math.min(60_000, 2 ** job.attempts * 2_000)), heartbeatAt: new Date(),
      }).where(eq(backgroundJobs.id, job.id))
      if (job.pipelineRunId) await db.update(pipelineRuns).set({ status: exhausted ? 'failed' : 'queued', errorCode: 'PIPELINE_WORKER_FAILED', safeErrorMessage: message, finishedAt: exhausted ? new Date() : null }).where(eq(pipelineRuns.id, job.pipelineRunId))
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true })
work().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => database.client.end())
