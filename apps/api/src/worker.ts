import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  backgroundJobs, clientEvents, contentItemVersions, contentQualityIssues, contentRevisions, createDatabase,
  pipelineRunItems, pipelineRuns, playerProfiles, session, user, walletAccounts,
} from '@shoditsa/database'
import { buildWorkspaceRevision, validateContentPayload } from './modules/admin/content-service.js'

type Json = Record<string, unknown>
const config = loadConfig()
const database = createDatabase(config)
const db = database.db
const root = process.cwd()
let stopping = false

const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const primary = (value: unknown) => record(value).primaryValue
const strings = (value: unknown) => Array.isArray(value) ? value.flatMap((entry) => typeof entry === 'string' ? [entry.trim()] : []).filter(Boolean) : []
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
const safeError = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+)/gi, '[redacted]').slice(0, 1_000)

const claim = async () => {
  const claimed = await db.execute(sql`
    update background_jobs set status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now(), worker_id = ${config.workerId}, attempts = attempts + 1
    where id = (
      select id from background_jobs
      where status = 'queued' and (next_retry_at is null or next_retry_at <= now())
      order by created_at for update skip locked limit 1
    ) returning id
  `)
  const id = Array.from(claimed as Iterable<{ id: string }>)[0]?.id
  return id ? (await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).limit(1))[0] : null
}

const runCommand = async (args: string[], runId: string, jobId: string) => {
  const allowed = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'NODE_ENV', 'OPENAI_API_KEY', 'LASTFM_API_KEY', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'THEAUDIODB_API_KEY', 'MUSICBRAINZ_USER_AGENT']
  const env = Object.fromEntries(allowed.flatMap((key) => process.env[key] == null ? [] : [[key, process.env[key]!]]))
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
      db.update(pipelineRuns).set({ heartbeatAt: new Date(), logExcerpt: output.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]') }).where(eq(pipelineRuns.id, runId)),
    ])
  }, config.workerHeartbeatIntervalMs)
  try {
    const exitCode = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit) })
    if (exitCode !== 0) throw new Error(output.split(/\r?\n/).filter(Boolean).slice(-8).join('\n') || `Music worker exited with ${exitCode}`)
    return output
  } finally { clearInterval(heartbeat) }
}

const listFiles = async (directory: string): Promise<string[]> => {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await listFiles(file))
    else result.push(file)
  }
  return result
}

const mapMusicRecord = (raw: Json) => {
  const source = record(raw.record)
  const artistKey = text(source.artistKey) || text(raw.entityKey)
  const canonical = text(primary(source.canonicalName)) || text(record(source.input).artist) || artistKey
  const titleRu = text(primary(source.displayNameRu)) || canonical
  const titleOriginal = text(primary(source.displayNameEn)) || canonical
  const aliases = strings(primary(source.aliases)).filter((entry) => entry !== titleRu && entry !== titleOriginal)
  const genres = [...new Set([...strings(primary(source.genres)), ...strings(primary(source.styles)), ...strings(primary(source.moods))])]
  const imageCandidates = strings(primary(source.imageCandidates))
  const topTracks = Array.isArray(primary(source.topTracks)) ? primary(source.topTracks) as unknown[] : []
  const topAlbums = Array.isArray(primary(source.topAlbums)) ? primary(source.topAlbums) as unknown[] : []
  const hint = text(record(source.agentHint).text)
  return {
    id: `music:${artistKey}`, mode: 'music', titleRu, titleOriginal, alternativeTitles: aliases,
    year: Number(primary(source.beginYear)) || undefined, endYear: Number(primary(source.endYear)) || undefined,
    countries: [primary(source.country), primary(source.area), primary(source.city)].flatMap(strings), genres,
    popularityScore: Number(primary(record(source.popularityMetrics).listeners)) || 0,
    posterUrl: imageCandidates[0] ?? null, headerUrl: imageCandidates[1] ?? null, backdropUrl: imageCandidates[2] ?? null,
    screenshots: imageCandidates.slice(0, 6), description: `Музыкальный артист: ${canonical}${genres.length ? ` · жанры: ${genres.slice(0, 3).join(', ')}` : ''}`,
    plotHint: hint || `Музыкальный артист: ${canonical}`, slogan: text(record(topTracks[0]).title) || null,
    facts: [...topTracks.slice(0, 3).map((entry) => `Трек: ${text(record(entry).title)}`).filter(Boolean), ...topAlbums.slice(0, 2).map((entry) => `Альбом: ${text(record(entry).title)}`).filter(Boolean)],
    aliases, artistType: primary(source.artistType) ?? null, activeState: primary(source.isActive) ?? null,
    topTracks, topAlbums, members: primary(source.members) ?? [], associatedActs: primary(source.associatedActs) ?? [],
    musicLinks: [...strings(primary(source.officialLinks)), ...strings(primary(source.socialLinks))],
    allowedInGame: false, contentStatus: 'review', dataQuality: { assessment: raw.assessment, hintValidation: raw.hintValidation, sourceStatus: record(source.pipeline).sourceStatus },
  }
}

const handleMusic = async (job: typeof backgroundJobs.$inferSelect) => {
  if (!job.pipelineRunId) throw new Error('music_pipeline job has no pipelineRunId')
  const run = (await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, job.pipelineRunId)).limit(1))[0]
  if (!run) throw new Error('Pipeline run not found')
  const input = record(run.inputDefinitionJson); const settings = record(run.settingsJson); const scenario = text(input.scenario) || 'discover'; const maxItems = Number(settings.maxItems) || run.itemsTotal || 5
  await db.update(pipelineRuns).set({ status: 'running', startedAt: run.startedAt ?? new Date(), heartbeatAt: new Date(), workerId: config.workerId }).where(eq(pipelineRuns.id, run.id))
  const enrichmentRoot = resolve(config.enrichmentDataRoot)
  const common = [`--max-items=${maxItems}`, `--ai=${text(settings.aiMode) || 'auto'}`, `--model=${text(settings.model) || config.musicPipelineModel}`]
  if (settings.webSearch === false) common.push('--no-ai-web-search')
  let command: string[]
  if (scenario === 'discover') command = ['scripts/music/run-agent-cycle.mjs', ...common]
  else if (scenario === 'review') command = ['scripts/enrichment-agent/run.mjs', 'music', 'run', '--retry-review', '--ai=always', ...common.filter((entry) => !entry.startsWith('--ai='))]
  else if (scenario === 'selected') {
    const ids = Array.isArray(input.itemIds) ? input.itemIds.map(String) : []
    const active = await db.select({ payload: contentItemVersions.payload }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId)).where(and(eq(contentRevisions.status, 'active'), inArray(contentItemVersions.itemId, ids)))
    const seed = active.map((entry, index) => ({ artist: text(record(entry.payload).titleOriginal) || text(record(entry.payload).titleRu), rank: index + 1 }))
    const seedFile = join(enrichmentRoot, 'music', `admin-${run.id}-seed.json`); await writeFile(seedFile, JSON.stringify(seed, null, 2), 'utf8')
    command = ['scripts/enrichment-agent/run.mjs', 'music', 'run', `--source=${seedFile}`, ...common]
  } else command = ['scripts/enrichment-agent/run.mjs', 'music', 'run', `--source=${join(enrichmentRoot, 'music', 'discovery', 'discovered-candidates.json')}`, ...common]
  const started = Date.now(); const output = await runCommand(command, run.id, job.id)
  const files = (await listFiles(join(enrichmentRoot, 'music'))).filter((file) => file.includes(`${join('', 'records', '')}`) && file.endsWith('.json'))
  const fresh: Array<{ file: string; raw: Json }> = []
  for (const file of files) if ((await stat(file)).mtimeMs >= started - 2_000) fresh.push({ file, raw: JSON.parse(await readFile(file, 'utf8')) as Json })
  let failed = 0
  for (const entry of fresh.slice(0, maxItems)) {
    const proposed = mapMusicRecord(entry.raw); const itemId = text(proposed.id)
    const before = await db.select({ id: contentItemVersions.id, payload: contentItemVersions.payload }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId)).where(and(eq(contentRevisions.status, 'active'), eq(contentItemVersions.itemId, itemId))).limit(1)
    const warnings = [...(Array.isArray(record(entry.raw.assessment).reviewReasons) ? record(entry.raw.assessment).reviewReasons as unknown[] : []), ...(entry.raw.aiError ? [entry.raw.aiError] : [])]
    try {
      await db.insert(pipelineRunItems).values({
        runId: run.id, entityKey: text(entry.raw.entityKey) || basename(entry.file, '.json'), cardId: before[0] ? itemId : null,
        inputItemVersionId: before[0]?.id ?? null, status: 'review_required', beforeJson: before[0]?.payload ?? null, proposedJson: proposed,
        warningsJson: warnings, sourcesJson: record(record(entry.raw.record).pipeline).sourceStatus ?? null,
        confidenceJson: { assessment: entry.raw.assessment, aiReview: entry.raw.aiReview, hintValidation: entry.raw.hintValidation },
        rawResultRef: relative(enrichmentRoot, entry.file).replaceAll('\\', '/'), idempotencyKey: `${run.id}:${text(entry.raw.entityKey) || basename(entry.file)}`,
      }).onConflictDoUpdate({ target: pipelineRunItems.idempotencyKey, set: { proposedJson: proposed, warningsJson: warnings, updatedAt: new Date(), status: 'review_required' } })
    } catch { failed += 1 }
  }
  const succeeded = Math.max(0, fresh.length - failed)
  await db.update(pipelineRuns).set({
    status: succeeded ? failed ? 'partially_failed' : 'review_required' : 'failed', itemsTotal: fresh.length || run.itemsTotal,
    itemsProcessed: fresh.length, itemsSucceeded: succeeded, itemsFailed: failed, finishedAt: new Date(), heartbeatAt: new Date(),
    logExcerpt: output.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]').slice(-8_000),
    ...(!succeeded ? { errorCode: 'NO_REVIEWABLE_RESULTS', safeErrorMessage: 'Пайплайн не создал результатов для проверки' } : {}),
  }).where(eq(pipelineRuns.id, run.id))
  return { runId: run.id, items: fresh.length, succeeded, failed }
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
        .onConflictDoUpdate({ target: contentQualityIssues.fingerprint, set: { status: 'open', resolvedAt: null, message: issue.message, severity: issue.level === 'error' ? 'critical' : 'warning' } })
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
  if (job.type === 'user_export') return handleUserExport(job)
  if (job.type === 'event_export') {
    const events = await db.select().from(clientEvents).orderBy(desc(clientEvents.occurredAt)).limit(1_000)
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
      const message = safeError(error); const exhausted = job.attempts + 1 >= job.maxAttempts
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
