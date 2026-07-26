import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  appSettings,
  auditLog,
  contentAliases,
  contentItemVersions,
  contentRevisionModes,
  contentRevisions,
  createDatabase,
  diagnosisVignettes,
} from '@shoditsa/database'
import type { TitleItem } from '@shoditsa/contracts'
import { validateCatalogInvariants } from '../../apps/api/src/modules/admin/content-service.js'
import { loadIntegrationEnvironment } from '../../apps/api/src/modules/admin/integration-secrets.js'
import {
  applySeriesProfileChanges,
  buildSeriesProfileChanges,
  isSeriesDetails,
  needsSupportingCast,
  sameJsonValue,
  summarizeSeriesProfileUpdates,
} from './profile-enrichment.mjs'
import { kinopoiskKeysFromEnvironment } from './season-sources.mjs'

type Json = Record<string, unknown>
type VersionRow = typeof contentItemVersions.$inferSelect
type FieldChange = {
  field: string
  before: unknown
  after: unknown
  source: 'kinopoisk_seasons' | 'kinopoisk_details' | 'kinopoisk_staff'
}
type PlanUpdate = {
  itemId: string
  versionId: string
  kinopoiskId: number
  changes: FieldChange[]
}
type EnrichmentPlan = {
  schemaVersion: 1
  generatedAt: string
  activeRevision: { id: string; version: string; checksum: string }
  totalSeries: number
  requests: {
    planned: number
    completed: number
    failed: number
    quotaBefore: Array<{ slot: number; limit: number; used: number; remaining: number }>
    keyUsage: Array<{ slot: number; planned: number; used: number; errors: number }>
  }
  updates: PlanUpdate[]
  summary: Record<string, number>
  unresolved: Array<{ itemId: string; kinopoiskId: number; field: string; reason: string }>
}

type RequestKind = 'details' | 'seasons' | 'staff'
type RequestTask = { itemId: string; kind: RequestKind; path: string }
type KeyState = {
  key: string
  slot: number
  limit: number
  quotaUsed: number
  remaining: number
  planned: number
  used: number
  errors: number
}

const args = process.argv.slice(2)
const hasArg = (name: string) => args.includes(name)
const arg = (name: string) => {
  const direct = args.find((value) => value.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const apply = hasArg('--apply')
const activate = hasArg('--activate')
const planPath = resolve(arg('--plan') ?? './var/series-profile-production-plan.json')
const resultPath = resolve(arg('--result') ?? `${planPath}.result.json`)
const requestDelayMs = Math.max(260, Number(arg('--request-delay-ms') ?? 280))
const apiBase = 'https://kinopoiskapiunofficial.tech'

const object = (value: unknown): Json => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
)
const chunks = <T,>(values: T[], size: number) => Array.from(
  { length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, (index + 1) * size),
)
const delay = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds))
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const safeError = (value: unknown) => String(value instanceof Error ? value.message : value)
  .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
  .slice(0, 240)
const positiveInteger = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0
const kinopoiskIdFrom = (itemId: string, payload: Json) => {
  const direct = Number(payload.kinopoiskId)
  if (Number.isInteger(direct) && direct > 0) return direct
  const match = itemId.match(/^kp_(\d+)$/)
  return match ? Number(match[1]) : null
}
const resultKey = (itemId: string, kind: RequestKind) => `${itemId}:${kind}`
const currentField = (payload: Json, field: string) => payload[field] ?? null
const same = (left: unknown, right: unknown) => sameJsonValue(left, right)

const config = loadConfig()
const { db, client } = createDatabase(config)

const activeRevision = async () => {
  const rows = await db.select({
    id: contentRevisions.id,
    version: contentRevisions.version,
    checksum: contentRevisions.checksumSha256,
    sourceManifest: contentRevisions.sourceManifest,
  }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!rows[0]) throw new Error('Active content revision was not found')
  return rows[0]
}

const quotaForKey = async (key: string, slot: number) => {
  const response = await fetch(`${apiBase}/api/v1/api_keys/${encodeURIComponent(key)}`, {
    headers: { 'X-API-KEY': key, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Could not read Kinopoisk quota for slot ${slot}: HTTP ${response.status}`)
  const body = object(await response.json())
  const daily = object(body.dailyQuota)
  const limit = Number(daily.value)
  const used = Number(daily.used)
  if (!Number.isInteger(limit) || !Number.isInteger(used) || limit <= 0 || used < 0) {
    throw new Error(`Kinopoisk quota response is invalid for slot ${slot}`)
  }
  return { limit, used, remaining: Math.max(0, limit - used) }
}

const loadKeys = async () => {
  const environment = await loadIntegrationEnvironment(db, config)
  const keys = kinopoiskKeysFromEnvironment(environment)
  if (!keys.length) throw new Error('No Kinopoisk keys were loaded from admin integrations')
  const quotas = await Promise.all(keys.map((key, index) => quotaForKey(key, index + 1)))
  return keys.map((key, index): KeyState => ({
    key,
    slot: index + 1,
    limit: quotas[index].limit,
    quotaUsed: quotas[index].used,
    remaining: quotas[index].remaining,
    planned: 0,
    used: 0,
    errors: 0,
  }))
}

const executeTasks = async (tasks: RequestTask[], keys: KeyState[]) => {
  const buckets = keys.map(() => [] as RequestTask[])
  for (let index = 0; index < tasks.length; index += 1) buckets[index % keys.length].push(tasks[index])
  for (let index = 0; index < keys.length; index += 1) {
    keys[index].planned = buckets[index].length
    if (buckets[index].length > keys[index].remaining) {
      throw new Error(`Kinopoisk slot ${keys[index].slot} needs ${buckets[index].length} requests but only ${keys[index].remaining} remain`)
    }
  }

  const results = new Map<string, unknown>()
  const failures = new Map<string, string>()
  let completed = 0
  await Promise.all(keys.map(async (state, keyIndex) => {
    for (const task of buckets[keyIndex]) {
      let success = false
      let lastError = 'request_failed'
      for (let attempt = 0; attempt < 5 && !success; attempt += 1) {
        try {
          const response = await fetch(apiBase + task.path, {
            headers: { 'X-API-KEY': state.key, Accept: 'application/json' },
          })
          state.used += 1
          if (response.ok) {
            results.set(resultKey(task.itemId, task.kind), await response.json())
            success = true
            continue
          }
          const body = await response.text().catch(() => '')
          lastError = `http_${response.status}:${safeError(body)}`
          if ([401, 402, 403, 404].includes(response.status)) break
          if (response.status === 429 || response.status >= 500) {
            await delay(Math.min(8_000, 500 * (attempt + 1)))
            continue
          }
          break
        } catch (error) {
          lastError = safeError(error)
          await delay(Math.min(5_000, 400 * (attempt + 1)))
        }
      }
      if (!success) {
        state.errors += 1
        failures.set(resultKey(task.itemId, task.kind), lastError)
      }
      completed += 1
      if (completed % 100 === 0 || completed === tasks.length) {
        console.log(`requests=${completed}/${tasks.length} failed=${failures.size}`)
      }
      await delay(requestDelayMs)
    }
  }))
  return { results, failures, completed }
}

const buildPlan = async (): Promise<EnrichmentPlan> => {
  const revision = await activeRevision()
  const rows = await db.select({
    versionId: contentItemVersions.id,
    itemId: contentItemVersions.itemId,
    payload: contentItemVersions.payload,
  }).from(contentItemVersions).where(and(
    eq(contentItemVersions.revisionId, revision.id),
    eq(contentItemVersions.mode, 'series'),
  )).orderBy(contentItemVersions.itemId)
  if (rows.length !== 791) throw new Error(`Expected 791 active series, found ${rows.length}`)

  const keys = await loadKeys()
  const tasks: RequestTask[] = []
  for (const row of rows) {
    const payload = object(row.payload)
    const kinopoiskId = kinopoiskIdFrom(row.itemId, payload)
    if (kinopoiskId == null) continue
    tasks.push(
      { itemId: row.itemId, kind: 'details', path: `/api/v2.2/films/${kinopoiskId}` },
      { itemId: row.itemId, kind: 'seasons', path: `/api/v2.2/films/${kinopoiskId}/seasons` },
    )
    if (needsSupportingCast(payload)) {
      tasks.push({ itemId: row.itemId, kind: 'staff', path: `/api/v1/staff?filmId=${kinopoiskId}` })
    }
  }

  const { results, failures, completed } = await executeTasks(tasks, keys)
  const updates: PlanUpdate[] = []
  const unresolved: EnrichmentPlan['unresolved'] = []

  for (const row of rows) {
    const payload = object(row.payload)
    const kinopoiskId = kinopoiskIdFrom(row.itemId, payload)
    if (kinopoiskId == null) {
      unresolved.push({ itemId: row.itemId, kinopoiskId: 0, field: 'kinopoiskId', reason: 'kinopoisk_id_missing' })
      continue
    }
    const detailsError = failures.get(resultKey(row.itemId, 'details'))
    const seasonsError = failures.get(resultKey(row.itemId, 'seasons'))
    const staffError = failures.get(resultKey(row.itemId, 'staff'))
    const details = results.get(resultKey(row.itemId, 'details'))
    const seasons = results.get(resultKey(row.itemId, 'seasons'))
    const staff = results.get(resultKey(row.itemId, 'staff'))

    if (detailsError) unresolved.push({ itemId: row.itemId, kinopoiskId, field: 'details', reason: detailsError })
    if (seasonsError) unresolved.push({ itemId: row.itemId, kinopoiskId, field: 'seasons', reason: seasonsError })
    if (staffError) unresolved.push({ itemId: row.itemId, kinopoiskId, field: 'supportingCast', reason: staffError })
    if (details && !isSeriesDetails(details)) {
      unresolved.push({
        itemId: row.itemId,
        kinopoiskId,
        field: 'mode',
        reason: `kinopoisk_type_mismatch:${String(object(details).type ?? 'unknown')}`,
      })
      continue
    }

    const changes = buildSeriesProfileChanges({ payload, details, seasons, staff }) as FieldChange[]
    if (!changes.some((change) => change.field === 'episodes') && !positiveInteger(payload.episodes)) {
      unresolved.push({ itemId: row.itemId, kinopoiskId, field: 'episodes', reason: 'no_positive_episode_count' })
    }
    if (changes.length) updates.push({ itemId: row.itemId, versionId: row.versionId, kinopoiskId, changes })
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    activeRevision: { id: revision.id, version: revision.version, checksum: revision.checksum },
    totalSeries: rows.length,
    requests: {
      planned: tasks.length,
      completed,
      failed: failures.size,
      quotaBefore: keys.map(({ slot, limit, quotaUsed: used, remaining }) => ({ slot, limit, used, remaining })),
      keyUsage: keys.map(({ slot, planned, used, errors }) => ({ slot, planned, used, errors })),
    },
    updates,
    summary: summarizeSeriesProfileUpdates(updates),
    unresolved,
  }
}

const payloadsForPlan = (rows: VersionRow[], plan: EnrichmentPlan) => {
  const updateByVersion = new Map(plan.updates.map((update) => [update.versionId, update]))
  return new Map(rows.map((row) => {
    const update = updateByVersion.get(row.id)
    return [row.id, update ? applySeriesProfileChanges(row.payload, update.changes) : object(row.payload)]
  }))
}

const persistedVersionSnapshot = (row: VersionRow) => ({
  itemId: row.itemId,
  mode: row.mode,
  titleRu: row.titleRu,
  titleOriginal: row.titleOriginal,
  normalizedTitle: row.normalizedTitle,
  year: row.year,
  endYear: row.endYear,
  popularityScore: row.popularityScore,
  topRank: row.topRank,
  sortOrder: row.sortOrder,
  allowedInGame: row.allowedInGame,
  contentStatus: row.contentStatus,
  payload: row.payload,
})

const applyPlan = async (plan: EnrichmentPlan) => {
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.updates)) throw new Error('Unsupported plan format')
  if (plan.requests.failed !== 0) throw new Error('Cannot apply a plan with failed Kinopoisk requests')
  const revision = await activeRevision()
  if (revision.id !== plan.activeRevision.id || revision.checksum !== plan.activeRevision.checksum) {
    throw new Error('Active revision changed after the enrichment plan was generated')
  }

  const rows = await db.select().from(contentItemVersions)
    .where(eq(contentItemVersions.revisionId, revision.id))
  const rowByVersion = new Map(rows.map((row) => [row.id, row]))
  for (const update of plan.updates) {
    const row = rowByVersion.get(update.versionId)
    if (!row || row.itemId !== update.itemId || row.mode !== 'series') {
      throw new Error(`Planned version is no longer available: ${update.itemId}`)
    }
    if (kinopoiskIdFrom(row.itemId, object(row.payload)) !== update.kinopoiskId) {
      throw new Error(`Kinopoisk identity changed after planning: ${update.itemId}`)
    }
    for (const change of update.changes) {
      if (!same(currentField(object(row.payload), change.field), change.before)) {
        throw new Error(`Field ${change.field} changed after planning: ${update.itemId}`)
      }
    }
  }

  const payloadByVersion = payloadsForPlan(rows, plan)
  const updateByVersion = new Map(plan.updates.map((update) => [update.versionId, update]))
  const materialByVersion = new Map(rows.map((row) => {
    const payload = payloadByVersion.get(row.id)!
    const endYearChange = updateByVersion.get(row.id)?.changes.find((change) => change.field === 'endYear')
    return [row.id, {
      ...persistedVersionSnapshot(row),
      endYear: endYearChange ? Number(endYearChange.after) : row.endYear,
      payload,
    }]
  }))
  const aliases = await db.select({
    oldVersionId: contentAliases.itemVersionId,
    alias: contentAliases.alias,
    normalizedAlias: contentAliases.normalizedAlias,
    kind: contentAliases.kind,
  }).from(contentAliases).innerJoin(
    contentItemVersions,
    eq(contentItemVersions.id, contentAliases.itemVersionId),
  ).where(eq(contentItemVersions.revisionId, revision.id))
  const vignettes = await db.select({
    id: diagnosisVignettes.id,
    oldVersionId: diagnosisVignettes.itemVersionId,
    text: diagnosisVignettes.text,
    sortOrder: diagnosisVignettes.sortOrder,
  }).from(diagnosisVignettes).innerJoin(
    contentItemVersions,
    eq(contentItemVersions.id, diagnosisVignettes.itemVersionId),
  ).where(eq(contentItemVersions.revisionId, revision.id))
  const modes = await db.select().from(contentRevisionModes)
    .where(eq(contentRevisionModes.revisionId, revision.id))

  const generatedAt = new Date().toISOString()
  const orderedMaterial = [...rows]
    .sort((left, right) => left.mode.localeCompare(right.mode) || left.sortOrder - right.sortOrder)
    .map((row) => materialByVersion.get(row.id))
  const checksum = digest(orderedMaterial)
  const planDigest = digest({ updates: plan.updates, summary: plan.summary, unresolved: plan.unresolved })
  const version = `${generatedAt.replace(/[-:.]/g, '')}-series-profile-${checksum.slice(0, 8)}`

  const matchingRevisions = await db.select({
    id: contentRevisions.id,
    status: contentRevisions.status,
    sourceManifest: contentRevisions.sourceManifest,
  }).from(contentRevisions).where(eq(contentRevisions.checksumSha256, checksum)).limit(1)
  const matchingRevision = matchingRevisions[0]
  if (matchingRevision) {
    const enrichment = object(object(matchingRevision.sourceManifest).seriesProfileEnrichment)
    if (
      matchingRevision.status !== 'ready'
      || object(matchingRevision.sourceManifest).parentRevisionId !== revision.id
      || enrichment.planDigest !== planDigest
    ) {
      throw new Error(`Checksum ${checksum} already belongs to an incompatible revision`)
    }
  }

  const newRevisionId = matchingRevision?.id ?? await db.transaction(async (tx) => {
    const insertedRevision = (await tx.insert(contentRevisions).values({
      version,
      checksumSha256: checksum,
      sourceManifest: {
        ...object(revision.sourceManifest),
        parentRevisionId: revision.id,
        seriesProfileEnrichment: {
          generatedAt,
          source: 'kinopoisk_unofficial_admin_key_pool',
          updatedItems: plan.updates.length,
          summary: plan.summary,
          unresolved: plan.unresolved,
          planDigest,
        },
      },
      status: 'importing',
    }).returning({ id: contentRevisions.id }))[0]

    const newVersionIdByOld = new Map<string, string>()
    for (const batch of chunks(rows, 200)) {
      const inserted = await tx.insert(contentItemVersions).values(batch.map((row) => {
        const material = materialByVersion.get(row.id)!
        return {
          itemId: material.itemId,
          revisionId: insertedRevision.id,
          mode: material.mode,
          titleRu: material.titleRu,
          titleOriginal: material.titleOriginal,
          normalizedTitle: material.normalizedTitle,
          year: material.year,
          endYear: material.endYear,
          popularityScore: material.popularityScore,
          topRank: material.topRank,
          sortOrder: material.sortOrder,
          allowedInGame: material.allowedInGame,
          contentStatus: material.contentStatus,
          payload: material.payload,
        }
      })).returning({ id: contentItemVersions.id, itemId: contentItemVersions.itemId })
      const oldIdByItem = new Map(batch.map((row) => [row.itemId, row.id]))
      for (const insertedRow of inserted) {
        newVersionIdByOld.set(oldIdByItem.get(insertedRow.itemId)!, insertedRow.id)
      }
    }

    for (const batch of chunks(aliases, 500)) {
      await tx.insert(contentAliases).values(batch.map((row) => ({
        itemVersionId: newVersionIdByOld.get(row.oldVersionId)!,
        alias: row.alias,
        normalizedAlias: row.normalizedAlias,
        kind: row.kind,
      })))
    }
    for (const batch of chunks(vignettes, 500)) {
      await tx.insert(diagnosisVignettes).values(batch.map((row) => ({
        id: `${insertedRevision.id.slice(0, 8)}:${row.id}`,
        itemVersionId: newVersionIdByOld.get(row.oldVersionId)!,
        text: row.text,
        sortOrder: row.sortOrder,
      })))
    }
    await tx.insert(contentRevisionModes).values(modes.map((mode) => {
      const modeRows = rows.filter((row) => row.mode === mode.mode)
      return {
        revisionId: insertedRevision.id,
        mode: mode.mode,
        itemsCount: modeRows.length,
        sourceChecksum: mode.mode === 'series'
          ? digest(modeRows.map((row) => payloadByVersion.get(row.id)))
          : mode.sourceChecksum,
      }
    }))
    await tx.update(contentRevisions).set({ status: 'ready' })
      .where(eq(contentRevisions.id, insertedRevision.id))
    return insertedRevision.id
  })

  const verification = await db.select().from(contentItemVersions)
    .where(eq(contentItemVersions.revisionId, newRevisionId))
  if (verification.length !== rows.length) throw new Error('Cloned revision item count does not match the active revision')
  const issues = validateCatalogInvariants(verification
    .filter((row) => row.mode !== 'danetki')
    .map((row) => row.payload as TitleItem))
  if (issues.length) throw new Error(`Cloned revision violates catalog invariants: ${JSON.stringify(issues.slice(0, 25))}`)

  const verificationByItem = new Map(verification.map((row) => [row.itemId, row]))
  for (const original of rows.filter((row) => row.mode !== 'series')) {
    const cloned = verificationByItem.get(original.itemId)
    if (!cloned || !same(persistedVersionSnapshot(cloned), persistedVersionSnapshot(original))) {
      throw new Error(`Non-series item changed during scoped clone: ${original.itemId}`)
    }
  }
  for (const update of plan.updates) {
    const row = verificationByItem.get(update.itemId)
    if (!row) throw new Error(`Updated item is missing from cloned revision: ${update.itemId}`)
    for (const change of update.changes) {
      if (!same(currentField(object(row.payload), change.field), change.after)) {
        throw new Error(`Updated field failed verification: ${update.itemId}.${change.field}`)
      }
    }
  }

  const series = verification.filter((row) => row.mode === 'series')
  const modePostcheck = [...new Set(rows.map((row) => row.mode))].map((mode) => ({
    mode,
    expectedItems: rows.filter((row) => row.mode === mode).length,
    actualItems: verification.filter((row) => row.mode === mode).length,
    expectedAllowed: rows.filter((row) => row.mode === mode && row.allowedInGame).length,
    actualAllowed: verification.filter((row) => row.mode === mode && row.allowedInGame).length,
  }))
  const postcheck = {
    totalItems: verification.length,
    totalSeries: series.length,
    allowedSeries: series.filter((row) => row.allowedInGame).length,
    withEpisodes: series.filter((row) => positiveInteger(object(row.payload).episodes)).length,
    withoutEpisodes: series.filter((row) => !positiveInteger(object(row.payload).episodes))
      .map((row) => ({ itemId: row.itemId, title: row.titleRu })),
    modes: modePostcheck,
  }
  if (
    postcheck.totalSeries !== plan.totalSeries
    || postcheck.allowedSeries !== plan.totalSeries
    || modePostcheck.some((mode) => (
      mode.expectedItems !== mode.actualItems || mode.expectedAllowed !== mode.actualAllowed
    ))
  ) {
    throw new Error(`Series postcheck failed: ${JSON.stringify(postcheck)}`)
  }

  if (activate) {
    await db.transaction(async (tx) => {
      const current = (await tx.select({ id: contentRevisions.id }).from(contentRevisions)
        .where(eq(contentRevisions.status, 'active')).for('update').limit(1))[0]
      if (current?.id !== revision.id) throw new Error('Active revision changed before activation')
      await tx.update(contentRevisions).set({ status: 'retired' }).where(eq(contentRevisions.id, revision.id))
      await tx.update(contentRevisions).set({ status: 'active', activatedAt: new Date() })
        .where(eq(contentRevisions.id, newRevisionId))
      await tx.insert(appSettings).values({
        key: 'active_content_revision_id',
        value: newRevisionId,
        updatedBy: config.adminUserIds[0],
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: sql`${JSON.stringify(newRevisionId)}::jsonb`,
          version: sql`${appSettings.version} + 1`,
          updatedBy: config.adminUserIds[0],
          updatedAt: new Date(),
        },
      })
      await tx.insert(auditLog).values({
        actorUserId: config.adminUserIds[0],
        action: 'content.series.kinopoisk_profile_enrich',
        entityType: 'content_revision',
        entityId: newRevisionId,
        before: { revisionId: revision.id },
        after: { revisionId: newRevisionId, summary: plan.summary, postcheck },
        reason: 'Backfill verified series episodes and refresh Kinopoisk-backed series profile fields',
        requestId: `series-profile-enrich:${newRevisionId}`,
      })
    })
  }

  return {
    previousRevisionId: revision.id,
    newRevisionId,
    activated: activate,
    updatedItems: plan.updates.length,
    summary: plan.summary,
    unresolved: plan.unresolved,
    postcheck,
  }
}

try {
  await mkdir(dirname(planPath), { recursive: true })
  if (!apply) {
    const plan = await buildPlan()
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({
      planPath,
      activeRevision: plan.activeRevision,
      totalSeries: plan.totalSeries,
      requests: plan.requests,
      updatedItems: plan.updates.length,
      summary: plan.summary,
      unresolved: plan.unresolved,
    }, null, 2))
  } else {
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as EnrichmentPlan
    const result = await applyPlan(plan)
    await mkdir(dirname(resultPath), { recursive: true })
    await writeFile(resultPath, `${JSON.stringify({ ...result, appliedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ ...result, resultPath }, null, 2))
  }
} finally {
  await client.end()
}
