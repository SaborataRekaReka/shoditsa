import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  appSettings,
  contentAliases,
  contentItemVersions,
  contentRevisionModes,
  contentRevisions,
  createDatabase,
  diagnosisVignettes,
} from '@shoditsa/database'
import { isAllowedInRegularGame } from '@shoditsa/game-core'
import { loadIntegrationEnvironment } from '../../apps/api/src/modules/admin/integration-secrets.js'
import { kinopoiskKeysFromEnvironment } from './season-sources.mjs'

type Json = Record<string, unknown>
type PlanUpdate = { itemId: string; versionId: string; kinopoiskId: number; seasonsCount: number }
type BackfillPlan = {
  schemaVersion: 1
  generatedAt: string
  activeRevision: { id: string; version: string; checksum: string }
  totalSeries: number
  missingBefore: number
  updates: PlanUpdate[]
  unresolved: Array<{ itemId: string; kinopoiskId: number; reason: string }>
  keyUsage: Array<{ slot: number; used: number; exhausted: boolean }>
}

const args = process.argv.slice(2)
const arg = (name: string) => {
  const exact = args.find((value) => value.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const hasArg = (name: string) => args.includes(name)
const planPath = resolve(arg('--plan') ?? './var/series-seasons-production-plan.json')
const apply = hasArg('--apply')
const activate = hasArg('--activate')
const delay = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds))
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const chunks = <T>(values: T[], size: number) => Array.from(
  { length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, (index + 1) * size),
)
const validSeasons = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0
const kinopoiskIdFrom = (itemId: string, payload: Json) => {
  const direct = Number(payload.kinopoiskId)
  if (Number.isInteger(direct) && direct > 0) return direct
  const match = itemId.match(/^kp_(\d+)$/)
  return match ? Number(match[1]) : null
}
const safeError = (value: unknown) => String(value instanceof Error ? value.message : value)
  .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
  .slice(0, 240)

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

const createKinopoiskClient = (keys: string[]) => {
  const state = keys.map((key, index) => ({ key, slot: index + 1, used: 0, exhausted: false, failures: 0 }))
  let pointer = 0

  const seasonCount = async (kinopoiskId: number) => {
    let lastError = 'request_failed'
    for (let attempt = 0; attempt < Math.max(8, keys.length * 8); attempt += 1) {
      const active = state.filter((entry) => !entry.exhausted)
      if (!active.length) return { seasonsCount: null, reason: 'all_keys_exhausted' }
      const selected = active[pointer++ % active.length]
      let response: Response
      try {
        response = await fetch(`https://kinopoiskapiunofficial.tech/api/v2.2/films/${kinopoiskId}/seasons`, {
          headers: {
            'X-API-KEY': selected.key,
            Accept: 'application/json',
          },
        })
      } catch (error) {
        selected.failures += 1
        lastError = safeError(error)
        await delay(Math.min(5_000, 350 * selected.failures))
        continue
      }

      if (response.ok) {
        selected.used += 1
        selected.failures = 0
        const payload = await response.json() as { total?: unknown; items?: unknown[] }
        const count = Number.isFinite(Number(payload.total))
          ? Number(payload.total)
          : Array.isArray(payload.items) ? payload.items.length : null
        return validSeasons(count)
          ? { seasonsCount: Number(count), reason: null }
          : { seasonsCount: null, reason: 'no_positive_season_count' }
      }

      const body = await response.text().catch(() => '')
      lastError = `http_${response.status}:${safeError(body)}`
      if ([401, 402, 403].includes(response.status) || /quota|daily|exceeded|limit/i.test(body)) {
        selected.exhausted = true
        continue
      }
      if (response.status === 404 || (response.status >= 400 && response.status < 429)) {
        return { seasonsCount: null, reason: `http_${response.status}` }
      }
      selected.failures += 1
      await delay(Math.min(8_000, 400 * selected.failures))
    }
    return { seasonsCount: null, reason: lastError }
  }

  return {
    seasonCount,
    usage: () => state.map(({ slot, used, exhausted }) => ({ slot, used, exhausted })),
  }
}

const buildPlan = async (): Promise<BackfillPlan> => {
  const revision = await activeRevision()
  const rows = await db.select({
    versionId: contentItemVersions.id,
    itemId: contentItemVersions.itemId,
    payload: contentItemVersions.payload,
  }).from(contentItemVersions).where(and(
    eq(contentItemVersions.revisionId, revision.id),
    eq(contentItemVersions.mode, 'series'),
  ))
  const missing = rows.filter((row) => !validSeasons(object(row.payload).seasonsCount))
  const environment = await loadIntegrationEnvironment(db, config)
  const keys = kinopoiskKeysFromEnvironment(environment)
  if (!keys.length) throw new Error('No Kinopoisk keys were loaded from admin integrations')

  const api = createKinopoiskClient(keys)
  const updates: PlanUpdate[] = []
  const unresolved: BackfillPlan['unresolved'] = []

  for (let index = 0; index < missing.length; index += 1) {
    const row = missing[index]
    const kinopoiskId = kinopoiskIdFrom(row.itemId, object(row.payload))
    if (kinopoiskId == null) {
      unresolved.push({ itemId: row.itemId, kinopoiskId: 0, reason: 'kinopoisk_id_missing' })
      continue
    }
    const result = await api.seasonCount(kinopoiskId)
    if (result.seasonsCount == null) {
      unresolved.push({ itemId: row.itemId, kinopoiskId, reason: result.reason ?? 'season_count_missing' })
    } else {
      updates.push({ itemId: row.itemId, versionId: row.versionId, kinopoiskId, seasonsCount: result.seasonsCount })
    }
    if ((index + 1) % 20 === 0 || index + 1 === missing.length) {
      console.log(`planned=${index + 1}/${missing.length} resolved=${updates.length} unresolved=${unresolved.length}`)
    }
    await delay(120)
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    activeRevision: { id: revision.id, version: revision.version, checksum: revision.checksum },
    totalSeries: rows.length,
    missingBefore: missing.length,
    updates,
    unresolved,
    keyUsage: api.usage(),
  }
}

const payloadWithSeasons = (value: unknown, seasonsCount: number) => {
  const payload = object(value)
  const quality = object(payload.dataQuality)
  const sources = Array.isArray(quality.source)
    ? quality.source.filter((entry): entry is string => typeof entry === 'string')
    : []
  return {
    ...payload,
    seasonsCount,
    dataQuality: {
      ...quality,
      source: [...new Set([...sources.filter((source) => source !== 'series_meta_conflict'), 'series_meta_kinopoisk'])],
    },
  }
}

const applyPlan = async (plan: BackfillPlan) => {
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.updates)) throw new Error('Unsupported plan format')
  const revision = await activeRevision()
  if (revision.id !== plan.activeRevision.id || revision.checksum !== plan.activeRevision.checksum) {
    throw new Error('Active revision changed after the plan was generated')
  }

  const allVersions = await db.select().from(contentItemVersions)
    .where(eq(contentItemVersions.revisionId, revision.id))
  const currentById = new Map(allVersions.map((row) => [row.id, row]))
  const updateByVersion = new Map(plan.updates.map((entry) => [entry.versionId, entry]))

  for (const update of plan.updates) {
    const current = currentById.get(update.versionId)
    if (!current || current.itemId !== update.itemId || current.mode !== 'series') {
      throw new Error(`Planned version is no longer available: ${update.itemId}`)
    }
    if (validSeasons(object(current.payload).seasonsCount)) {
      throw new Error(`Season count was already changed after planning: ${update.itemId}`)
    }
    if (kinopoiskIdFrom(current.itemId, object(current.payload)) !== update.kinopoiskId) {
      throw new Error(`Kinopoisk identity changed after planning: ${update.itemId}`)
    }
  }

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
  const updateDigest = createHash('sha256').update(JSON.stringify(plan.updates)).digest('hex')
  const checksum = createHash('sha256')
    .update(`${revision.checksum}:series-seasons:${updateDigest}`)
    .digest('hex')
  const version = `${generatedAt.replace(/[-:.]/g, '')}-series-seasons-${updateDigest.slice(0, 8)}`
  const newRevisionId = await db.transaction(async (tx) => {
    const insertedRevision = (await tx.insert(contentRevisions).values({
      version,
      checksumSha256: checksum,
      sourceManifest: {
        ...object(revision.sourceManifest),
        parentRevisionId: revision.id,
        seriesSeasonBackfill: {
          generatedAt,
          source: 'kinopoisk_unofficial_admin_key_pool',
          updated: plan.updates.length,
          unresolved: plan.unresolved.length,
          planDigest: updateDigest,
        },
      },
      status: 'importing',
    }).returning({ id: contentRevisions.id }))[0]

    const newVersionIdByOld = new Map<string, string>()
    for (const batch of chunks(allVersions, 200)) {
      const inserted = await tx.insert(contentItemVersions).values(batch.map((row) => {
        const update = updateByVersion.get(row.id)
        const payload = update ? payloadWithSeasons(row.payload, update.seasonsCount) : row.payload
        return {
          itemId: row.itemId,
          revisionId: insertedRevision.id,
          mode: row.mode,
          titleRu: row.titleRu,
          titleOriginal: row.titleOriginal,
          normalizedTitle: row.normalizedTitle,
          year: row.year,
          endYear: row.endYear,
          popularityScore: row.popularityScore,
          topRank: row.topRank,
          sortOrder: row.sortOrder,
          allowedInGame: update
            ? isAllowedInRegularGame(payload as Parameters<typeof isAllowedInRegularGame>[0])
            : row.allowedInGame,
          contentStatus: row.contentStatus,
          payload,
        }
      })).returning({ id: contentItemVersions.id, itemId: contentItemVersions.itemId })
      const oldByItemId = new Map(batch.map((row) => [row.itemId, row.id]))
      for (const row of inserted) newVersionIdByOld.set(oldByItemId.get(row.itemId)!, row.id)
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
    await tx.insert(contentRevisionModes).values(modes.map((mode) => ({
      revisionId: insertedRevision.id,
      mode: mode.mode,
      itemsCount: mode.itemsCount,
      sourceChecksum: mode.mode === 'series'
        ? createHash('sha256').update(`${mode.sourceChecksum}:${updateDigest}`).digest('hex')
        : mode.sourceChecksum,
    })))
    await tx.update(contentRevisions).set({ status: 'ready' })
      .where(eq(contentRevisions.id, insertedRevision.id))
    return insertedRevision.id
  })

  const verification = (await db.select({
    id: contentItemVersions.id,
    mode: contentItemVersions.mode,
    allowedInGame: contentItemVersions.allowedInGame,
    payload: contentItemVersions.payload,
  }).from(contentItemVersions).where(eq(contentItemVersions.revisionId, newRevisionId)))
  const oldSeries = allVersions.filter((row) => row.mode === 'series')
  const newSeries = verification.filter((row) => row.mode === 'series')
  const missingAfter = newSeries.filter((row) => !validSeasons(object(row.payload).seasonsCount)).length
  if (verification.length !== allVersions.length || newSeries.length !== oldSeries.length) {
    throw new Error('Cloned revision item counts do not match the active revision')
  }
  if (missingAfter !== plan.missingBefore - plan.updates.length) {
    throw new Error(`Unexpected missing-series count after clone: ${missingAfter}`)
  }

  if (activate) {
    await db.transaction(async (tx) => {
      const active = await tx.select({ id: contentRevisions.id }).from(contentRevisions)
        .where(eq(contentRevisions.status, 'active')).limit(1)
      if (active[0]?.id !== revision.id) throw new Error('Active revision changed before activation')
      await tx.update(contentRevisions).set({ status: 'retired' })
        .where(eq(contentRevisions.id, revision.id))
      await tx.update(contentRevisions).set({ status: 'active', activatedAt: new Date() })
        .where(eq(contentRevisions.id, newRevisionId))
      await tx.insert(appSettings).values({ key: 'active_content_revision_id', value: newRevisionId })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: {
            value: sql`${JSON.stringify(newRevisionId)}::jsonb`,
            version: sql`${appSettings.version} + 1`,
            updatedAt: new Date(),
          },
        })
    })
  }

  return {
    oldRevisionId: revision.id,
    newRevisionId,
    activated: activate,
    totalItems: verification.length,
    totalSeries: newSeries.length,
    updated: plan.updates.length,
    missingBefore: plan.missingBefore,
    missingAfter,
    allowedSeriesAfter: newSeries.filter((row) => row.allowedInGame).length,
  }
}

try {
  await mkdir(dirname(planPath), { recursive: true })
  if (!apply) {
    const plan = await buildPlan()
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({
      planPath,
      activeRevisionId: plan.activeRevision.id,
      totalSeries: plan.totalSeries,
      missingBefore: plan.missingBefore,
      resolved: plan.updates.length,
      unresolved: plan.unresolved.length,
      keyUsage: plan.keyUsage,
    }, null, 2))
  } else {
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as BackfillPlan
    const result = await applyPlan(plan)
    const resultPath = resolve(arg('--result') ?? `${planPath}.result.json`)
    await writeFile(resultPath, `${JSON.stringify({ ...result, appliedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ ...result, resultPath }, null, 2))
  }
} finally {
  await client.end()
}
