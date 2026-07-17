import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  backgroundJobs,
  contentItemVersions,
  contentRevisions,
  contentWorkspaceChanges,
  contentWorkspaces,
  createDatabase,
  pipelineRunItems,
  pipelineRuns,
  playerProfiles,
} from '@shoditsa/database'
import type { ContentMode } from '@shoditsa/contracts'
import {
  activateWorkspaceRevision,
  buildWorkspaceRevision,
  getOrCreateWorkspace,
  loadWorkspaceChanges,
  saveWorkspaceItem,
} from '../../apps/api/src/modules/admin/content-service.js'
import { loadIntegrationEnvironment } from '../../apps/api/src/modules/admin/integration-secrets.js'

const ACTIONS = ['prepare', 'enqueue', 'status', 'retry', 'publish'] as const
type Action = typeof ACTIONS[number]

const action = process.argv[2] as Action | undefined
if (!action || !ACTIONS.includes(action)) {
  throw new Error(`Usage: city-hints <${ACTIONS.join('|')}> [run-id]`)
}

const config = loadConfig()
const { db, client } = createDatabase(config)
const requestId = `city-hints:${action}:${randomUUID()}`

const PROMPT = [
  'Напиши одну атмосферную игровую подсказку на русском языке для угадывания этого города.',
  'Дай 1–2 коротких предложения (примерно 90–190 знаков) и используй два характерных ориентира: географию, городской ритм, архитектурную деталь, местную традицию или культурный образ.',
  'Подсказка должна уверенно вести к нужному объекту, но не называть город, его варианты написания, страну, столичный статус, координаты, флаг или герб.',
  'Не перечисляй сухие факты, не используй рейтинги из карточки и не начинай со слов «этот город».',
  'Если один знаменитый объект мгновенно раскрывает ответ, опиши его образ косвенно, без собственного названия.',
  'Верни decision=update и только законченную, естественную подсказку без кавычек и пояснений.',
].join(' ')

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const normalized = (value: unknown) => text(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim()

const actor = async () => {
  const rows = await db.select({ id: playerProfiles.userId }).from(playerProfiles)
    .where(eq(playerProfiles.role, 'admin')).orderBy(asc(playerProfiles.createdAt)).limit(1)
  if (!rows[0]) throw new Error('Production admin actor was not found')
  return rows[0]
}

const activeCityCards = async () => {
  const active = (await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!active) throw new Error('Active content revision was not found')
  const cards = await db.select({ itemId: contentItemVersions.itemId, versionId: contentItemVersions.id, payload: contentItemVersions.payload })
    .from(contentItemVersions)
    .where(and(eq(contentItemVersions.revisionId, active.id), eq(contentItemVersions.mode, 'city')))
    .orderBy(asc(contentItemVersions.itemId))
  return { active, cards }
}

const runIdFromArgs = async () => {
  if (process.argv[3]) return process.argv[3]
  const latest = (await db.select({ id: pipelineRuns.id }).from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineKey, 'normalization')).orderBy(sql`${pipelineRuns.createdAt} desc`).limit(1))[0]
  if (!latest) throw new Error('City hint pipeline run was not found')
  return latest.id
}

const invalidHintReason = (beforeValue: unknown, proposedValue: unknown) => {
  const before = record(beforeValue)
  const proposed = record(proposedValue)
  const hint = text(proposed.plotHint)
  if (hint.length < 70 || hint.length > 260) return `hint length ${hint.length}`
  const normalizedHint = normalized(hint)
  const forbidden = [before.titleRu, before.titleOriginal, before.country, ...(Array.isArray(before.alternativeTitles) ? before.alternativeTitles : [])]
    .map(normalized).filter((value) => value.length >= 4)
  const leak = forbidden.find((value) => normalizedHint.includes(value))
  return leak ? `answer leak: ${leak}` : null
}

const prepare = async () => {
  const admin = await actor()
  const current = await activeCityCards()
  if (current.cards.length === 980) return { skipped: true, revisionId: current.active.id, cityCount: 980 }
  if (current.cards.length) throw new Error(`Expected no cities before import, found ${current.cards.length}`)
  const releaseItems = JSON.parse(await readFile(join(config.contentReleaseRoot, 'cities', 'items.json'), 'utf8')) as Array<Record<string, unknown>>
  if (!Array.isArray(releaseItems) || releaseItems.length !== 980) throw new Error(`Expected 980 bundled cities, found ${releaseItems.length}`)
  const workspace = await getOrCreateWorkspace(db, admin)
  const existingChanges = await db.select({ itemId: contentWorkspaceChanges.itemId, mode: contentWorkspaceChanges.mode, source: contentWorkspaceChanges.source, reason: contentWorkspaceChanges.reason })
    .from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId, workspace.id))
  const unrelated = existingChanges.filter((change) => change.mode !== 'city' || change.source !== 'import' || change.reason !== 'Import bundled city library')
  if (unrelated.length) throw new Error(`Workspace ${workspace.id} contains ${unrelated.length} unrelated changes`)
  const importedIds = new Set(existingChanges.map((change) => change.itemId))
  for (const payload of releaseItems) {
    const itemId = text(payload.id)
    if (!itemId) throw new Error('Bundled city has no id')
    if (importedIds.has(itemId)) continue
    await saveWorkspaceItem(db, admin, itemId, {
      mode: 'city', payload: { ...payload, id: itemId, mode: 'city' }, expectedVersion: 0, source: 'import', reason: 'Import bundled city library',
    }, requestId)
  }
  const built = await buildWorkspaceRevision(db, admin, workspace.id, requestId)
  const activated = await activateWorkspaceRevision(db, admin, workspace.id, requestId)
  const next = await activeCityCards()
  if (next.cards.length !== 980) throw new Error(`Expected 980 active cities after release import, found ${next.cards.length}`)
  return { skipped: false, revisionId: activated.revision.id, builtRevisionId: built.revisionId, cityCount: next.cards.length }
}

const enqueue = async () => {
  const admin = await actor()
  const integrations = await loadIntegrationEnvironment(db, config)
  if (!integrations.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured in production integrations')
  const { cards } = await activeCityCards()
  if (cards.length !== 980) throw new Error(`Expected 980 active cities, found ${cards.length}`)
  const existing = await db.select({ id: pipelineRuns.id, status: pipelineRuns.status }).from(pipelineRuns)
    .where(and(eq(pipelineRuns.pipelineKey, 'normalization'), sql`${pipelineRuns.inputDefinitionJson}->>'operation' = 'city-hints-v1'`))
    .orderBy(sql`${pipelineRuns.createdAt} desc`).limit(1)
  if (existing[0] && !['failed', 'cancelled', 'published', 'partially_published'].includes(existing[0].status)) {
    return { skipped: true, runId: existing[0].id, status: existing[0].status }
  }
  const itemIds = cards.map((card) => card.itemId)
  const run = (await db.insert(pipelineRuns).values({
    pipelineKey: 'normalization', pipelineVersion: 'city-hints-v1', status: 'queued', createdBy: admin.id, itemsTotal: itemIds.length,
    inputDefinitionJson: {
      operation: 'city-hints-v1', scenario: 'normalize', mode: 'city', field: 'plotHint', prompt: PROMPT,
      contextFields: ['country', 'continent', 'languages', 'capital', 'popular', 'population', 'timezone'],
      availableFields: [], scope: 'all', query: '', includeTagIds: [], excludeTagIds: [], tagMatch: 'all', itemIds,
    },
    settingsJson: { maxItems: itemIds.length, model: 'gpt-5-mini', webSearch: true, concurrency: Math.min(6, config.normalizationConcurrency) },
    estimatedCost: String((itemIds.length * 0.02).toFixed(6)), resultExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  }).returning())[0]
  const job = (await db.insert(backgroundJobs).values({
    type: 'normalization_pipeline', idempotencyKey: `city-hints-v1:${run.id}`, createdBy: admin.id, pipelineRunId: run.id, payload: { runId: run.id },
  }).returning())[0]
  return { skipped: false, runId: run.id, jobId: job.id, items: itemIds.length, estimatedUpperBoundUsd: 19.6 }
}

const status = async () => {
  const runId = await runIdFromArgs()
  const run = (await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1))[0]
  if (!run) throw new Error(`Pipeline run ${runId} was not found`)
  const grouped = await db.select({ status: pipelineRunItems.status, count: sql<number>`count(*)::int` }).from(pipelineRunItems)
    .where(eq(pipelineRunItems.runId, runId)).groupBy(pipelineRunItems.status)
  const invalid = await db.select({ before: pipelineRunItems.beforeJson, proposed: pipelineRunItems.proposedJson }).from(pipelineRunItems)
    .where(and(eq(pipelineRunItems.runId, runId), eq(pipelineRunItems.status, 'review_required')))
  return {
    runId, status: run.status, itemsTotal: run.itemsTotal, processed: run.itemsProcessed, succeeded: run.itemsSucceeded, failed: run.itemsFailed,
    actualCost: run.actualCost, heartbeatAt: run.heartbeatAt, log: run.logExcerpt, grouped: Object.fromEntries(grouped.map((row) => [row.status, row.count])),
    invalidHints: invalid.filter((item) => invalidHintReason(item.before, item.proposed)).length,
  }
}

const retry = async () => {
  const admin = await actor()
  const runId = await runIdFromArgs()
  const items = await db.select({ id: pipelineRunItems.id, status: pipelineRunItems.status, before: pipelineRunItems.beforeJson, proposed: pipelineRunItems.proposedJson })
    .from(pipelineRunItems).where(eq(pipelineRunItems.runId, runId))
  const invalidIds = items.filter((item) => item.status === 'failed' || invalidHintReason(item.before, item.proposed)).map((item) => item.id)
  if (!invalidIds.length) return { skipped: true, runId, invalid: 0 }
  await db.update(pipelineRunItems).set({ status: 'failed', errorCode: 'CITY_HINT_INVALID', safeErrorMessage: 'Подсказка не прошла автоматическую проверку', updatedAt: new Date() })
    .where(inArray(pipelineRunItems.id, invalidIds))
  await db.update(pipelineRuns).set({ status: 'queued', finishedAt: null, itemsFailed: invalidIds.length }).where(eq(pipelineRuns.id, runId))
  const job = (await db.insert(backgroundJobs).values({
    type: 'normalization_pipeline', idempotencyKey: `city-hints-retry:${runId}:${randomUUID()}`, createdBy: admin.id, pipelineRunId: runId,
    payload: { runId, retryFailed: true },
  }).returning())[0]
  return { skipped: false, runId, jobId: job.id, invalid: invalidIds.length }
}

const publish = async () => {
  const admin = await actor()
  const runId = await runIdFromArgs()
  const run = (await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1))[0]
  if (!run) throw new Error(`Pipeline run ${runId} was not found`)
  const items = await db.select().from(pipelineRunItems).where(eq(pipelineRunItems.runId, runId)).orderBy(asc(pipelineRunItems.entityKey))
  if (items.length !== 980) throw new Error(`Expected 980 pipeline results, found ${items.length}`)
  const invalid = items.flatMap((item) => {
    const reason = invalidHintReason(item.beforeJson, item.proposedJson)
    return item.status !== 'review_required' || reason ? [{ id: item.id, entityKey: item.entityKey, status: item.status, reason }] : []
  })
  if (invalid.length) throw new Error(`Cannot publish: ${invalid.length} results need retry or review`)

  const existingWorkspace = (await db.select({ id: contentWorkspaces.id }).from(contentWorkspaces)
    .where(sql`${contentWorkspaces.status} in ('open','building','ready')`).limit(1))[0]
  if (existingWorkspace) {
    const existingCount = (await db.select({ count: sql<number>`count(*)::int` }).from(contentWorkspaceChanges)
      .where(eq(contentWorkspaceChanges.workspaceId, existingWorkspace.id)))[0]?.count ?? 0
    if (existingCount) throw new Error(`Workspace ${existingWorkspace.id} already contains ${existingCount} unrelated changes`)
  }

  await db.update(pipelineRunItems).set({
    status: 'approved', fieldDecisionsJson: { plotHint: { action: 'accept' } }, approvedBy: admin.id, approvedAt: new Date(), updatedAt: new Date(),
  }).where(eq(pipelineRunItems.runId, runId))
  const workspace = await getOrCreateWorkspace(db, admin)
  const targetIds = items.map((item) => item.cardId ?? item.entityKey)
  const changes = await loadWorkspaceChanges(db, workspace.id, targetIds)
  const changesByItem = new Map(changes.map((change) => [change.itemId, change]))
  for (const item of items) {
    const before = record(item.beforeJson)
    const proposed = record(item.proposedJson)
    const itemId = item.cardId ?? item.entityKey
    const payload = { ...before, plotHint: proposed.plotHint, id: itemId, mode: 'city' }
    const change = await saveWorkspaceItem(db, admin, itemId, {
      mode: 'city' as ContentMode, payload, expectedVersion: changesByItem.get(itemId)?.version ?? 0, source: 'ai_pipeline',
      reason: `Pipeline ${runId}`, pipelineRunId: runId, pipelineRunItemId: item.id,
    }, requestId)
    await db.update(pipelineRunItems).set({ status: 'staged', workspaceChangeId: change.id, updatedAt: new Date() }).where(eq(pipelineRunItems.id, item.id))
  }
  await db.update(pipelineRuns).set({ status: 'staged' }).where(eq(pipelineRuns.id, runId))
  const built = await buildWorkspaceRevision(db, admin, workspace.id, requestId)
  const activated = await activateWorkspaceRevision(db, admin, workspace.id, requestId)
  await db.update(pipelineRunItems).set({ status: 'published', appliedRevisionId: activated.revision.id, updatedAt: new Date() }).where(eq(pipelineRunItems.runId, runId))
  await db.update(pipelineRuns).set({ status: 'published', finishedAt: new Date() }).where(eq(pipelineRuns.id, runId))
  return { runId, published: items.length, revisionId: activated.revision.id, builtRevisionId: built.revisionId }
}

try {
  const result = action === 'prepare' ? await prepare()
    : action === 'enqueue' ? await enqueue()
      : action === 'status' ? await status()
        : action === 'retry' ? await retry()
          : await publish()
  console.log(JSON.stringify(result, null, 2))
} finally {
  await client.end()
}
