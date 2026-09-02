import { createHash } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { ContentMode, TitleItem } from '@shoditsa/contracts'
import {
  auditLog, contentAliases, contentItems, contentItemVersions, contentPackEntries, contentPacks,
  contentRevisionModes, contentRevisions, contentWorkspaceChanges, contentWorkspaces, playerProfiles,
  type Database,
} from '@shoditsa/database'
import { compareTitles, isAllowedInRegularGame, normalize } from '@shoditsa/game-core'
import { contentPayloadsEqual, validateContentPayload } from './content-service.js'
import { EDITORIAL_MUSIC_COMPARISON_KEYS } from './music-editorial-catalog.js'
import { releaseAliasesFor, type ReleaseContentItem } from './release-content-loader.js'

type VersionRow = typeof contentItemVersions.$inferSelect
type Revision = Pick<typeof contentRevisions.$inferSelect, 'id' | 'version' | 'checksumSha256'>
const regularMusic = (row: Pick<VersionRow, 'mode' | 'payload'>) => row.mode === 'music' && (row.payload as TitleItem).cardType !== 'kpop_artist'
const chunks = <T,>(values: T[], size = 200) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size))
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const counts = (rows: Array<{ mode: ContentMode }>) => Object.fromEntries([...new Set(rows.map((row) => row.mode))].sort().map((mode) => [mode, rows.filter((row) => row.mode === mode).length]))

export const planMusicCatalogReplacement = (revision: Revision, rows: VersionRow[], items: TitleItem[]) => {
  if (!items.length || new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Music replacement must be non-empty and have unique runtime IDs')
  if (new Set(items.map((item) => item.musicCatalog?.sourceId)).size !== items.length) throw new Error('Music replacement must have unique source IDs')
  const source = items[0].musicCatalog
  if (!source?.sourceChecksum || !source.dataset || !source.version) throw new Error('Music replacement requires source provenance')
  const aliasOwners = new Map<string, string>()
  for (const item of items) {
    if (item.mode !== 'music' || item.cardType || !isAllowedInRegularGame(item)) throw new Error(`${item.id}: replacement contains a special, foreign-mode or unplayable card`)
    if (!item.musicCatalog?.sourceId || item.musicCatalog.sourceChecksum !== source.sourceChecksum || item.musicCatalog.version !== source.version || item.musicCatalog.dataset !== source.dataset) throw new Error(`${item.id}: mixed music sources`)
    const issues = validateContentPayload(item as unknown as Record<string, unknown>, 'music').filter((issue) => issue.level === 'error')
    const hints = compareTitles(item, item)
    if (issues.length || EDITORIAL_MUSIC_COMPARISON_KEYS.some((key) => !hints.some((hint) => hint.key === key)) || hints.some((hint) => hint.status !== 'match' || hint.direction != null)) throw new Error(`${item.id}: invalid gameplay payload (${JSON.stringify(issues)})`)
    for (const alias of releaseAliasesFor(item as ReleaseContentItem)) {
      const owner = aliasOwners.get(alias.normalizedAlias)
      if (owner && owner !== item.id) throw new Error(`Ambiguous music alias: ${alias.alias}`)
      aliasOwners.set(alias.normalizedAlias, item.id)
    }
  }
  const oldMusic = rows.filter(regularMusic)
  const preserved = rows.filter((row) => !regularMusic(row))
  const preservedIds = new Set(preserved.map((row) => row.itemId))
  if (items.some((item) => preservedIds.has(item.id))) throw new Error('A replacement ID collides with another mode or a special card')
  const oldById = new Map(oldMusic.map((row) => [row.itemId, row]))
  const nextIds = new Set(items.map((item) => item.id))
  const orderedPayloads = [...preserved.map((row) => ({ id: row.itemId, payload: row.payload })), ...items.map((item) => ({ id: item.id, payload: item }))].sort((a, b) => a.id.localeCompare(b.id))
  return {
    baseRevisionId: revision.id,
    baseVersion: revision.version,
    baseChecksum: revision.checksumSha256,
    source: { dataset: source.dataset, version: source.version, sourceChecksum: source.sourceChecksum },
    catalogChecksum: digest(items),
    revisionChecksum: digest(orderedPayloads),
    before: { ordinaryMusic: oldMusic.length, kpop: rows.filter((row) => row.mode === 'music' && !regularMusic(row)).length, modes: counts(rows) },
    after: { ordinaryMusic: items.length, modes: counts([...preserved, ...items]) },
    removedIds: oldMusic.map((row) => row.itemId).filter((id) => !nextIds.has(id)).sort(),
    addedIds: items.map((item) => item.id).filter((id) => !oldById.has(id)).sort(),
    preservedItems: preserved.length,
    unchanged: oldMusic.length === items.length && items.every((item) => {
      const previous = oldById.get(item.id)
      return previous?.allowedInGame === true && contentPayloadsEqual(previous.payload as Record<string, unknown>, item as unknown as Record<string, unknown>)
    }),
    historyPolicy: 'Existing revisions, sessions, attempts, rooms and daily challenges are retained unchanged.',
  }
}

export const inspectMusicCatalogReplacement = async (db: Database, items: TitleItem[]) => {
  const revision = (await db.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!revision) throw new Error('No active content revision')
  const rows = await db.select().from(contentItemVersions).where(eq(contentItemVersions.revisionId, revision.id))
  return planMusicCatalogReplacement(revision, rows, items)
}

/** Creates a complete immutable revision. Activation is a separate guarded operation. */
export const stageMusicCatalogReplacement = async (db: Database, items: TitleItem[], expectedRevisionId: string, actorId: string) => db.transaction(async (tx) => {
  const actor = (await tx.select({ role: playerProfiles.role }).from(playerProfiles).where(eq(playerProfiles.userId, actorId)).limit(1))[0]
  if (actor?.role !== 'admin') throw new Error('An existing admin actor is required')
  const revision = (await tx.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).for('update').limit(1))[0]
  if (!revision || revision.id !== expectedRevisionId) throw new Error('Active revision changed; review a fresh replacement plan before applying')
  const rows = await tx.select().from(contentItemVersions).where(eq(contentItemVersions.revisionId, revision.id))
  const plan = planMusicCatalogReplacement(revision, rows, items)
  if (plan.unchanged) return { revisionId: revision.id, created: false, plan }
  const workspace = (await tx.select().from(contentWorkspaces).where(sql`${contentWorkspaces.status} in ('open','building','ready')`).for('update').limit(1))[0]
  if (workspace) {
    const pending = (await tx.select({ count: sql<number>`count(*)::int` }).from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId, workspace.id)))[0].count
    if (pending) throw new Error('Content workspace has unpublished edits; replacement was not staged')
  }
  if (plan.removedIds.length) {
    const affectedPacks = await tx.select({ pack: contentPacks.id, itemId: contentPackEntries.answerItemId }).from(contentPackEntries)
      .innerJoin(contentPacks, eq(contentPacks.id, contentPackEntries.packId))
      .where(and(inArray(contentPackEntries.answerItemId, plan.removedIds), eq(contentPackEntries.enabled, true)))
    if (affectedPacks.length) throw new Error(`Replacement would orphan enabled special-pack entries: ${JSON.stringify(affectedPacks)}`)
  }
  const existing = (await tx.select().from(contentRevisions).where(eq(contentRevisions.checksumSha256, plan.revisionChecksum)).limit(1))[0]
  if (existing) {
    if (existing.status !== 'ready' || (existing.sourceManifest as Record<string, unknown>).baseRevisionId !== revision.id) throw new Error('Matching revision exists but is not a ready replacement of the current base')
    return { revisionId: existing.id, created: false, plan }
  }
  const target = (await tx.insert(contentRevisions).values({
    version: `music-editorial-${plan.source.version}-${new Date().toISOString().replace(/[-:.]/g, '')}-${plan.revisionChecksum.slice(0, 8)}`,
    checksumSha256: plan.revisionChecksum,
    status: 'importing', createdBy: actorId,
    sourceManifest: { ...(revision.sourceManifest as Record<string, unknown>), baseRevisionId: revision.id, musicCatalogReplacement: { ...plan, generatedAt: new Date().toISOString() } },
  }).returning({ id: contentRevisions.id }))[0]

  // Preserve every non-music row and K-pop payload/flags byte-for-byte at the JSON value level.
  await tx.execute(sql`insert into content_item_versions (item_id,revision_id,mode,title_ru,title_original,normalized_title,year,end_year,popularity_score,top_rank,sort_order,allowed_in_game,content_status,payload)
    select item_id,${target.id}::uuid,mode,title_ru,title_original,normalized_title,year,end_year,popularity_score,top_rank,sort_order,allowed_in_game,content_status,payload
    from content_item_versions where revision_id=${revision.id}::uuid and (mode <> 'music' or payload->>'cardType' = 'kpop_artist')`)
  for (const batch of chunks(items)) {
    const identities = await tx.select().from(contentItems).where(inArray(contentItems.id, batch.map((item) => item.id)))
    if (identities.some((item) => item.mode !== 'music')) throw new Error('Stable identity belongs to another mode')
    await tx.insert(contentItems).values(batch.map((item) => ({ id: item.id, mode: 'music' as const }))).onConflictDoNothing()
    await tx.insert(contentItemVersions).values(batch.map((item) => ({
      itemId: item.id, revisionId: target.id, mode: 'music' as const,
      titleRu: item.titleRu, titleOriginal: item.titleOriginal, normalizedTitle: normalize(item.titleRu),
      year: null, endYear: null, topRank: null, popularityScore: item.popularityScore ?? 0,
      sortOrder: items.indexOf(item), allowedInGame: true, contentStatus: item.contentStatus ?? 'ready', payload: item,
    })))
  }
  await tx.execute(sql`insert into content_aliases (item_version_id,alias,normalized_alias,kind)
    select nv.id,a.alias,a.normalized_alias,a.kind from content_aliases a
    join content_item_versions ov on ov.id=a.item_version_id
    join content_item_versions nv on nv.item_id=ov.item_id and nv.revision_id=${target.id}::uuid
    where ov.revision_id=${revision.id}::uuid and (ov.mode <> 'music' or ov.payload->>'cardType' = 'kpop_artist')`)
  const newRows = await tx.select().from(contentItemVersions).where(eq(contentItemVersions.revisionId, target.id))
  const versionIds = new Map(newRows.map((row) => [row.itemId, row.id]))
  const aliases = items.flatMap((item) => releaseAliasesFor(item as ReleaseContentItem).map((alias) => ({ ...alias, itemVersionId: versionIds.get(item.id)! })))
  for (const batch of chunks(aliases, 500)) await tx.insert(contentAliases).values(batch)
  await tx.execute(sql`insert into diagnosis_vignettes (id,item_version_id,text,sort_order)
    select nv.id::text || ':' || v.sort_order::text,nv.id,v.text,v.sort_order from diagnosis_vignettes v
    join content_item_versions ov on ov.id=v.item_version_id
    join content_item_versions nv on nv.item_id=ov.item_id and nv.revision_id=${target.id}::uuid
    where ov.revision_id=${revision.id}::uuid`)
  await tx.execute(sql`insert into content_final_choice_candidates (revision_id,answer_item_version_id,candidate_item_version_id,role,score,match_keys,mismatch_keys,rank,algorithm_version)
    select ${target.id}::uuid,na.id,nc.id,f.role,f.score,f.match_keys,f.mismatch_keys,f.rank,f.algorithm_version
    from content_final_choice_candidates f
    join content_item_versions oa on oa.id=f.answer_item_version_id
    join content_item_versions oc on oc.id=f.candidate_item_version_id
    join content_item_versions na on na.item_id=oa.item_id and na.revision_id=${target.id}::uuid
    join content_item_versions nc on nc.item_id=oc.item_id and nc.revision_id=${target.id}::uuid
    where f.revision_id=${revision.id}::uuid and oa.mode <> 'music' and oc.mode <> 'music'`)
  const previousModes = await tx.select().from(contentRevisionModes).where(eq(contentRevisionModes.revisionId, revision.id))
  const nextCounts = counts(newRows)
  await tx.insert(contentRevisionModes).values(Object.entries(nextCounts).map(([mode, count]) => ({
    revisionId: target.id, mode: mode as ContentMode, itemsCount: count,
    sourceChecksum: mode === 'music' ? digest(newRows.filter((row) => row.mode === 'music').sort((a, b) => a.itemId.localeCompare(b.itemId)).map((row) => row.payload))
      : previousModes.find((entry) => entry.mode === mode)?.sourceChecksum ?? digest(newRows.filter((row) => row.mode === mode).map((row) => row.payload)),
  })))
  if (JSON.stringify(nextCounts) !== JSON.stringify(plan.after.modes)) throw new Error('Replacement mode counts do not match the plan')
  const preserved = rows.filter((row) => !regularMusic(row))
  const newById = new Map(newRows.map((row) => [row.itemId, row]))
  for (const old of preserved) {
    const next = newById.get(old.itemId)
    const comparable = ({ id: _id, revisionId: _revisionId, createdAt: _createdAt, ...rest }: VersionRow) => rest
    if (!next || digest(comparable(old)) !== digest(comparable(next))) throw new Error(`Preserved row changed: ${old.itemId}`)
  }
  if (!planMusicCatalogReplacement({ ...revision, id: target.id }, newRows, items).unchanged) throw new Error('Materialized music does not exactly match the replacement catalog')
  await tx.update(contentRevisions).set({ status: 'ready' }).where(eq(contentRevisions.id, target.id))
  await tx.insert(auditLog).values({ actorUserId: actorId, action: 'content.music_catalog.replace.stage', entityType: 'content_revision', entityId: target.id, before: plan.before, after: plan.after, reason: `Replace regular music with ${plan.source.dataset}@${plan.source.version}; preserve other modes, K-pop and history`, requestId: `music-replacement:${target.id}` })
  return { revisionId: target.id, created: true, plan }
})
