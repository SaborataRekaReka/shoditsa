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
import {
  applyMovieHistoryChanges,
  buildMovieHistoryChanges,
  sameJsonValue,
  summarizeMovieHistoryUpdates,
  validPeople,
} from './history-repair.mjs'

type Json = Record<string, unknown>
type VersionRow = typeof contentItemVersions.$inferSelect
type HistorySource = {
  revisionId: string
  version: string
  createdAt: string
}
type FieldChange = {
  field: string
  operation: 'set' | 'delete'
  before: unknown
  after: unknown
  source: HistorySource | 'movie_mode_cleanup'
}
type PlanUpdate = {
  itemId: string
  versionId: string
  changes: FieldChange[]
}
type LocalSyncItem = {
  itemId: string
  sortOrder: number
  payload: Json
}
type MovieRepairPlan = {
  schemaVersion: 1
  generatedAt: string
  activeRevision: { id: string; version: string; checksum: string }
  apiRequests: 0
  totalMovies: number
  updates: PlanUpdate[]
  summary: Record<string, number>
  historicalSources: Array<{ field: 'directors' | 'writers'; revisionId: string; version: string; items: number }>
  localSync: {
    localItemsBefore: number
    productionItems: number
    productionOnlyItems: LocalSyncItem[]
    localOnlyItemIds: string[]
    productionOrder: string[]
  }
}
type HistoricalRow = {
  itemId: string
  value: unknown
  sourceRevisionId: string
  sourceVersion: string
  sourceCreatedAt: Date | string
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
const planPath = resolve(arg('--plan') ?? './var/movie-history-repair-plan.json')
const resultPath = resolve(arg('--result') ?? `${planPath}.result.json`)
const localLibraryPath = resolve(arg('--local-library') ?? './public/data/libraries/movies/items.json')

const config = loadConfig()
const { db, client } = createDatabase(config)

const object = (value: unknown): Json => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
)
const chunks = <T,>(values: T[], size: number) => Array.from(
  { length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, (index + 1) * size),
)
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const currentField = (payload: Json, field: string) => (
  Object.hasOwn(payload, field) ? payload[field] : null
)

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

const historicalPeople = async (
  field: 'directors' | 'writers',
  itemIds: string[],
): Promise<Map<string, { value: unknown; source: HistorySource }>> => {
  if (!itemIds.length) return new Map()
  const ids = sql.join(itemIds.map((itemId) => sql`${itemId}`), sql`, `)
  const rows = Array.from(await db.execute(sql`
    select distinct on (v.item_id)
      v.item_id as "itemId",
      v.payload -> ${field} as "value",
      r.id as "sourceRevisionId",
      r.version as "sourceVersion",
      r."createdAt" as "sourceCreatedAt"
    from content_item_versions v
    inner join content_revisions r on r.id = v.revision_id
    where v.item_id in (${ids})
      and v.mode = 'movie'
      and jsonb_typeof(v.payload -> ${field}) = 'array'
      and jsonb_array_length(v.payload -> ${field}) > 0
    order by v.item_id, r."createdAt" desc
  `)) as unknown as HistoricalRow[]

  return new Map(rows.map((row) => [row.itemId, {
    value: row.value,
    source: {
      revisionId: row.sourceRevisionId,
      version: row.sourceVersion,
      createdAt: new Date(row.sourceCreatedAt).toISOString(),
    },
  }]))
}

const sourceSummary = (
  field: 'directors' | 'writers',
  values: Map<string, { value: unknown; source: HistorySource }>,
) => {
  const grouped = new Map<string, { field: 'directors' | 'writers'; revisionId: string; version: string; items: number }>()
  for (const { source } of values.values()) {
    const current = grouped.get(source.revisionId)
    if (current) current.items += 1
    else grouped.set(source.revisionId, {
      field,
      revisionId: source.revisionId,
      version: source.version,
      items: 1,
    })
  }
  return [...grouped.values()].sort((left, right) => (
    left.field.localeCompare(right.field) || left.version.localeCompare(right.version)
  ))
}

const buildPlan = async (): Promise<MovieRepairPlan> => {
  const revision = await activeRevision()
  const rows = await db.select({
    versionId: contentItemVersions.id,
    itemId: contentItemVersions.itemId,
    sortOrder: contentItemVersions.sortOrder,
    payload: contentItemVersions.payload,
  }).from(contentItemVersions).where(and(
    eq(contentItemVersions.revisionId, revision.id),
    eq(contentItemVersions.mode, 'movie'),
  )).orderBy(contentItemVersions.sortOrder)
  if (rows.length !== 1295) throw new Error(`Expected 1295 active movies, found ${rows.length}`)

  const localLibrary = JSON.parse(await readFile(localLibraryPath, 'utf8')) as unknown
  if (!Array.isArray(localLibrary)) throw new Error('Local movie library must be an array')
  const localIds = localLibrary.map((entry) => String(object(entry).id ?? ''))
  if (new Set(localIds).size !== localIds.length || localIds.some((itemId) => !itemId)) {
    throw new Error('Local movie library contains missing or duplicate IDs')
  }
  const localIdSet = new Set(localIds)
  const productionIdSet = new Set(rows.map((row) => row.itemId))
  const localOnlyItemIds = localIds.filter((itemId) => !productionIdSet.has(itemId))
  const productionOnlyRows = rows.filter((row) => !localIdSet.has(row.itemId))
  if (localLibrary.length !== 1246 || localOnlyItemIds.length !== 0 || productionOnlyRows.length !== 49) {
    throw new Error(`Unexpected local/production drift: ${JSON.stringify({
      local: localLibrary.length,
      production: rows.length,
      productionOnly: productionOnlyRows.length,
      localOnly: localOnlyItemIds.length,
    })}`)
  }

  const missingDirectors = rows.filter((row) => !validPeople(object(row.payload).directors))
  const missingWriters = rows.filter((row) => !validPeople(object(row.payload).writers))
  const missingDirectorIds = missingDirectors.map((row) => row.itemId)
  const missingWriterIds = missingWriters.map((row) => row.itemId)
  if (
    missingDirectorIds.length !== 137
    || missingWriterIds.length !== 137
    || !sameJsonValue([...missingDirectorIds].sort(), [...missingWriterIds].sort())
  ) {
    throw new Error(`Unexpected historical restoration scope: directors=${missingDirectorIds.length}, writers=${missingWriterIds.length}`)
  }

  const [directorsByItem, writersByItem] = await Promise.all([
    historicalPeople('directors', missingDirectorIds),
    historicalPeople('writers', missingWriterIds),
  ])
  if (directorsByItem.size !== 137 || writersByItem.size !== 137) {
    throw new Error(`Historical people are incomplete: directors=${directorsByItem.size}, writers=${writersByItem.size}`)
  }
  for (const itemId of missingDirectorIds) {
    if (!validPeople(directorsByItem.get(itemId)?.value)) throw new Error(`Invalid historical directors: ${itemId}`)
    if (!validPeople(writersByItem.get(itemId)?.value)) throw new Error(`Invalid historical writers: ${itemId}`)
  }

  const updates: PlanUpdate[] = []
  for (const row of rows) {
    const directors = directorsByItem.get(row.itemId)
    const writers = writersByItem.get(row.itemId)
    const changes = buildMovieHistoryChanges({
      payload: row.payload,
      historicalDirectors: directors?.value,
      historicalWriters: writers?.value,
      directorSource: directors?.source,
      writerSource: writers?.source,
    }) as FieldChange[]
    if (changes.length) updates.push({ itemId: row.itemId, versionId: row.versionId, changes })
  }

  const summary = summarizeMovieHistoryUpdates(updates)
  const expectedSummary = {
    dataQuality: 20,
    directors: 137,
    'seriesStatus:delete': 20,
    showrunners: 20,
    writers: 137,
  }
  if (!sameJsonValue(summary, expectedSummary) || updates.length !== 157) {
    throw new Error(`Unexpected repair plan summary: ${JSON.stringify({ updates: updates.length, summary })}`)
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    activeRevision: { id: revision.id, version: revision.version, checksum: revision.checksum },
    apiRequests: 0,
    totalMovies: rows.length,
    updates,
    summary,
    historicalSources: [
      ...sourceSummary('directors', directorsByItem),
      ...sourceSummary('writers', writersByItem),
    ],
    localSync: {
      localItemsBefore: localLibrary.length,
      productionItems: rows.length,
      productionOnlyItems: productionOnlyRows.map((row) => ({
        itemId: row.itemId,
        sortOrder: row.sortOrder,
        payload: object(row.payload),
      })),
      localOnlyItemIds,
      productionOrder: rows.map((row) => row.itemId),
    },
  }
}

const payloadsForPlan = (rows: VersionRow[], plan: MovieRepairPlan) => {
  const updateByVersion = new Map(plan.updates.map((update) => [update.versionId, update]))
  return new Map(rows.map((row) => {
    const update = updateByVersion.get(row.id)
    return [row.id, update ? applyMovieHistoryChanges(row.payload, update.changes) : object(row.payload)]
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

const applyPlan = async (plan: MovieRepairPlan) => {
  if (plan.schemaVersion !== 1 || plan.apiRequests !== 0 || !Array.isArray(plan.updates)) {
    throw new Error('Unsupported movie repair plan')
  }
  const revision = await activeRevision()
  if (revision.id !== plan.activeRevision.id || revision.checksum !== plan.activeRevision.checksum) {
    throw new Error('Active revision changed after the movie repair plan was generated')
  }

  const rows = await db.select().from(contentItemVersions)
    .where(eq(contentItemVersions.revisionId, revision.id))
  const rowByVersion = new Map(rows.map((row) => [row.id, row]))
  for (const update of plan.updates) {
    const row = rowByVersion.get(update.versionId)
    if (!row || row.itemId !== update.itemId || row.mode !== 'movie') {
      throw new Error(`Planned movie version is no longer available: ${update.itemId}`)
    }
    for (const change of update.changes) {
      if (!sameJsonValue(currentField(object(row.payload), change.field), change.before)) {
        throw new Error(`Movie field changed after planning: ${update.itemId}.${change.field}`)
      }
    }
  }

  const payloadByVersion = payloadsForPlan(rows, plan)
  const materialByVersion = new Map(rows.map((row) => [row.id, {
    ...persistedVersionSnapshot(row),
    payload: payloadByVersion.get(row.id)!,
  }]))
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
  const planDigest = digest({
    updates: plan.updates,
    summary: plan.summary,
    localSyncItemIds: plan.localSync.productionOnlyItems.map((item) => item.itemId),
  })
  const version = `${generatedAt.replace(/[-:.]/g, '')}-movie-history-repair-${checksum.slice(0, 8)}`

  const matchingRevisions = await db.select({
    id: contentRevisions.id,
    status: contentRevisions.status,
    sourceManifest: contentRevisions.sourceManifest,
  }).from(contentRevisions).where(eq(contentRevisions.checksumSha256, checksum)).limit(1)
  const matchingRevision = matchingRevisions[0]
  if (matchingRevision) {
    const repair = object(object(matchingRevision.sourceManifest).movieHistoryRepair)
    if (
      matchingRevision.status !== 'ready'
      || object(matchingRevision.sourceManifest).parentRevisionId !== revision.id
      || repair.planDigest !== planDigest
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
        movieHistoryRepair: {
          generatedAt,
          source: 'verified_content_revision_history',
          apiRequests: 0,
          updatedItems: plan.updates.length,
          summary: plan.summary,
          localProductionOnlyItems: plan.localSync.productionOnlyItems.length,
          historicalSources: plan.historicalSources,
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
        sourceChecksum: mode.mode === 'movie'
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
  for (const original of rows) {
    const cloned = verificationByItem.get(original.itemId)
    const expected = materialByVersion.get(original.id)
    if (!cloned || !expected || !sameJsonValue(persistedVersionSnapshot(cloned), expected)) {
      throw new Error(`Cloned item differs from the exact repair material: ${original.itemId}`)
    }
  }

  const clonedAliases = await db.select({ itemVersionId: contentAliases.itemVersionId }).from(contentAliases).innerJoin(
    contentItemVersions,
    eq(contentItemVersions.id, contentAliases.itemVersionId),
  ).where(eq(contentItemVersions.revisionId, newRevisionId))
  const clonedVignettes = await db.select({ id: diagnosisVignettes.id }).from(diagnosisVignettes).innerJoin(
    contentItemVersions,
    eq(contentItemVersions.id, diagnosisVignettes.itemVersionId),
  ).where(eq(contentItemVersions.revisionId, newRevisionId))
  if (clonedAliases.length !== aliases.length || clonedVignettes.length !== vignettes.length) {
    throw new Error('Alias or diagnosis vignette counts changed during clone')
  }

  const movieRows = verification.filter((row) => row.mode === 'movie')
  const modePostcheck = [...new Set(rows.map((row) => row.mode))].map((mode) => ({
    mode,
    expectedItems: rows.filter((row) => row.mode === mode).length,
    actualItems: verification.filter((row) => row.mode === mode).length,
    expectedAllowed: rows.filter((row) => row.mode === mode && row.allowedInGame).length,
    actualAllowed: verification.filter((row) => row.mode === mode && row.allowedInGame).length,
  }))
  const postcheck = {
    totalItems: verification.length,
    totalMovies: movieRows.length,
    allowedMovies: movieRows.filter((row) => row.allowedInGame).length,
    withDirectors: movieRows.filter((row) => validPeople(object(row.payload).directors)).length,
    withWriters: movieRows.filter((row) => validPeople(object(row.payload).writers)).length,
    staleSeriesStatus: movieRows.filter((row) => Object.hasOwn(object(row.payload), 'seriesStatus')).length,
    nonemptyShowrunners: movieRows.filter((row) => validPeople(object(row.payload).showrunners)).length,
    staleSeriesSource: movieRows.filter((row) => {
      const source = object(object(row.payload).dataQuality).source
      return Array.isArray(source) && source.includes('series_status_fallback')
    }).length,
    productionOnlyItemsPresent: plan.localSync.productionOnlyItems.filter((item) => (
      verificationByItem.has(item.itemId)
    )).length,
    aliases: clonedAliases.length,
    vignettes: clonedVignettes.length,
    modes: modePostcheck,
  }
  if (
    postcheck.totalMovies !== 1295
    || postcheck.allowedMovies !== 1295
    || postcheck.withDirectors !== 1295
    || postcheck.withWriters !== 1295
    || postcheck.staleSeriesStatus !== 0
    || postcheck.nonemptyShowrunners !== 0
    || postcheck.staleSeriesSource !== 0
    || postcheck.productionOnlyItemsPresent !== 49
    || modePostcheck.some((mode) => (
      mode.expectedItems !== mode.actualItems || mode.expectedAllowed !== mode.actualAllowed
    ))
  ) {
    throw new Error(`Movie repair postcheck failed: ${JSON.stringify(postcheck)}`)
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
        action: 'content.movie.history_repair',
        entityType: 'content_revision',
        entityId: newRevisionId,
        before: { revisionId: revision.id },
        after: { revisionId: newRevisionId, summary: plan.summary, postcheck },
        reason: 'Restore verified movie directors and writers from revision history and remove stale series metadata',
        requestId: `movie-history-repair:${newRevisionId}`,
      })
    })
  }

  return {
    previousRevisionId: revision.id,
    newRevisionId,
    activated: activate,
    apiRequests: 0,
    updatedItems: plan.updates.length,
    summary: plan.summary,
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
      apiRequests: plan.apiRequests,
      totalMovies: plan.totalMovies,
      updatedItems: plan.updates.length,
      summary: plan.summary,
      historicalSources: plan.historicalSources,
      localSync: {
        localItemsBefore: plan.localSync.localItemsBefore,
        productionItems: plan.localSync.productionItems,
        productionOnlyItems: plan.localSync.productionOnlyItems.length,
        localOnlyItems: plan.localSync.localOnlyItemIds.length,
      },
    }, null, 2))
  } else {
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as MovieRepairPlan
    const result = await applyPlan(plan)
    await mkdir(dirname(resultPath), { recursive: true })
    await writeFile(resultPath, `${JSON.stringify({ ...result, appliedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ ...result, resultPath }, null, 2))
  }
} finally {
  await client.end()
}
