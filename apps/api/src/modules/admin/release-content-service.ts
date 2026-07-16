import { eq, sql } from 'drizzle-orm'
import type { ContentMode } from '@shoditsa/contracts'
import {
  auditLog, contentAliases, contentItems, contentItemVersions, contentRevisionModes, contentRevisions,
  diagnosisVignettes, type Database,
} from '@shoditsa/database'
import { isAllowedInRegularGame, normalize } from '@shoditsa/game-core'
import { ApiError } from '../../lib/errors.js'
import { loadReleaseLibraries, releaseAliasesFor } from './release-content-loader.js'
import { buildReleaseMergePlan, releaseMergeChecksum, releaseMergeModeChecksum, type ActiveReleaseRow, type ReleaseMergeEntry } from './release-content-merge.js'

type Actor = { id: string }
type LoadedRelease = Awaited<ReturnType<typeof loadReleaseLibraries>>

const releaseCache = new Map<string, Promise<LoadedRelease>>()

const loadRelease = (sourceRoot: string) => {
  let pending = releaseCache.get(sourceRoot)
  if (!pending) {
    pending = loadReleaseLibraries(sourceRoot).catch((error) => {
      releaseCache.delete(sourceRoot)
      throw error
    })
    releaseCache.set(sourceRoot, pending)
  }
  return pending
}

const loadActiveContent = async (db: Database) => {
  const activeRevision = (await db.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!activeRevision) throw new ApiError(409, 'ACTIVE_REVISION_REQUIRED', 'Активная ревизия контента не найдена')
  const activeRows = await db.select({
    id: contentItemVersions.id,
    itemId: contentItemVersions.itemId,
    mode: contentItemVersions.mode,
    payload: contentItemVersions.payload,
    sortOrder: contentItemVersions.sortOrder,
  }).from(contentItemVersions).where(eq(contentItemVersions.revisionId, activeRevision.id))
  return { activeRevision, activeRows: activeRows as ActiveReleaseRow[] }
}

const releaseManifest = (loaded: LoadedRelease, gitSha: string, baseRevisionId: string, finalChecksumSha256: string, preview: ReturnType<typeof buildReleaseMergePlan>['preview']) => ({
  source: 'release_catalog_merge',
  strategy: 'overlay_preserve_active_only',
  gitSha,
  generatedAt: loaded.manifest.generatedAt,
  releaseChecksumSha256: loaded.manifest.checksumSha256,
  finalChecksumSha256,
  baseRevisionId,
  sourceItems: loaded.manifest.totalItems,
  finalItems: preview.finalItems,
  preview,
  modes: Object.fromEntries(Object.entries(loaded.manifest.modes).map(([mode, entry]) => [mode, {
    count: entry.count,
    checksumSha256: entry.checksumSha256,
  }])),
  warnings: loaded.manifest.warnings,
})

export const inspectReleaseContent = async (db: Database, sourceRoot: string, gitSha: string) => {
  const loaded = await loadRelease(sourceRoot)
  const { activeRevision, activeRows } = await loadActiveContent(db)
  const plan = buildReleaseMergePlan(activeRows, loaded.libraries)
  const finalChecksumSha256 = releaseMergeChecksum(plan.entries)
  const matchingRevision = (await db.select({
    id: contentRevisions.id, version: contentRevisions.version, checksumSha256: contentRevisions.checksumSha256,
    status: contentRevisions.status, createdAt: contentRevisions.createdAt, activatedAt: contentRevisions.activatedAt,
  }).from(contentRevisions).where(eq(contentRevisions.checksumSha256, finalChecksumSha256)).limit(1))[0] ?? null
  const state = activeRevision.checksumSha256 === finalChecksumSha256
    ? 'active'
    : matchingRevision?.status === 'ready' || matchingRevision?.status === 'retired'
      ? 'ready'
      : matchingRevision?.status === 'importing'
        ? 'building'
        : matchingRevision?.status === 'failed'
          ? 'failed'
          : 'update_available'
  return {
    state,
    updateAvailable: state === 'update_available' || state === 'failed',
    strategy: 'overlay_preserve_active_only' as const,
    release: {
      ...releaseManifest(loaded, gitSha, activeRevision.id, finalChecksumSha256, plan.preview),
      checksumSha256: loaded.manifest.checksumSha256,
      totalItems: loaded.manifest.totalItems,
    },
    preview: plan.preview,
    activeRevision: {
      id: activeRevision.id, version: activeRevision.version, checksumSha256: activeRevision.checksumSha256,
      status: activeRevision.status, createdAt: activeRevision.createdAt, activatedAt: activeRevision.activatedAt,
    },
    matchingRevision,
  }
}

const insertContentVersions = async (tx: Parameters<Parameters<Database['transaction']>[0]>[0], revisionId: string, entries: ReleaseMergeEntry[]) => {
  const sortOrders = new Map<ContentMode, number>()
  const versionByItem = new Map<string, string>()
  for (let offset = 0; offset < entries.length; offset += 200) {
    const chunk = entries.slice(offset, offset + 200)
    await tx.insert(contentItems).values(chunk.map((entry) => ({ id: entry.itemId, mode: entry.mode })))
      .onConflictDoUpdate({ target: contentItems.id, set: { mode: sql`excluded.mode`, updatedAt: new Date() } })
    const versions = await tx.insert(contentItemVersions).values(chunk.map((entry) => {
      const item = entry.payload
      const sortOrder = sortOrders.get(entry.mode) ?? 0
      sortOrders.set(entry.mode, sortOrder + 1)
      return {
        itemId: entry.itemId,
        revisionId,
        mode: entry.mode,
        titleRu: item.titleRu,
        titleOriginal: item.titleOriginal ?? '',
        normalizedTitle: normalize(item.titleRu),
        year: item.year,
        endYear: item.endYear ?? null,
        popularityScore: Number.isFinite(item.popularityScore) ? item.popularityScore : 0,
        topRank: item.topRank ?? null,
        sortOrder,
        allowedInGame: isAllowedInRegularGame(item),
        contentStatus: item.contentStatus ?? null,
        payload: item,
      }
    })).returning({ id: contentItemVersions.id, itemId: contentItemVersions.itemId })
    const itemById = new Map(chunk.map((entry) => [entry.itemId, entry.payload]))
    const aliasRows = versions.flatMap((row) => releaseAliasesFor(itemById.get(row.itemId)!)
      .map((entry) => ({ itemVersionId: row.id, ...entry })))
    if (aliasRows.length) await tx.insert(contentAliases).values(aliasRows)
    for (const version of versions) versionByItem.set(version.itemId, version.id)
  }
  return versionByItem
}

export const buildReleaseContentRevision = async (db: Database, actor: Actor, sourceRoot: string, gitSha: string, requestId: string) => {
  const loaded = await loadRelease(sourceRoot)
  const { activeRevision, activeRows } = await loadActiveContent(db)
  const plan = buildReleaseMergePlan(activeRows, loaded.libraries)
  const finalChecksumSha256 = releaseMergeChecksum(plan.entries)
  const manifest = releaseManifest(loaded, gitSha, activeRevision.id, finalChecksumSha256, plan.preview)

  const existing = (await db.select().from(contentRevisions)
    .where(eq(contentRevisions.checksumSha256, finalChecksumSha256)).limit(1))[0]
  if (existing && existing.status !== 'failed') {
    return { revisionId: existing.id, version: existing.version, status: existing.status, existing: true, preview: plan.preview }
  }

  const version = existing?.version ?? `release-${gitSha.slice(0, 12)}-${finalChecksumSha256.slice(0, 8)}`
  const revision = existing
    ? (await db.update(contentRevisions).set({ status: 'importing', sourceManifest: manifest, createdBy: actor.id })
      .where(eq(contentRevisions.id, existing.id)).returning())[0]
    : (await db.insert(contentRevisions).values({
      version, checksumSha256: finalChecksumSha256, sourceManifest: manifest, status: 'importing', createdBy: actor.id,
    }).returning())[0]

  try {
    await db.transaction(async (tx) => {
      const currentActive = (await tx.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).for('update').limit(1))[0]
      if (!currentActive || currentActive.id !== activeRevision.id) throw new ApiError(409, 'ACTIVE_REVISION_CHANGED', 'Активная ревизия изменилась во время сборки; запустите синхронизацию заново')

      const versionByItem = await insertContentVersions(tx, revision.id, plan.entries)
      const activeVignettes = await tx.select({
        itemId: contentItemVersions.itemId,
        id: diagnosisVignettes.id,
        text: diagnosisVignettes.text,
        sortOrder: diagnosisVignettes.sortOrder,
      }).from(diagnosisVignettes).innerJoin(contentItemVersions, eq(contentItemVersions.id, diagnosisVignettes.itemVersionId))
        .where(eq(contentItemVersions.revisionId, activeRevision.id))
      const activeVignettesByItem = new Map<string, typeof activeVignettes>()
      for (const vignette of activeVignettes) activeVignettesByItem.set(vignette.itemId, [...(activeVignettesByItem.get(vignette.itemId) ?? []), vignette])
      const releaseVignettesByItem = new Map(loaded.vignettes.map((group) => [group.diagnosisId, group.caseVignettes]))
      const vignetteRows = plan.entries.filter((entry) => entry.mode === 'diagnosis').flatMap((entry) => {
        const values = entry.source === 'release' ? releaseVignettesByItem.get(entry.itemId) ?? [] : activeVignettesByItem.get(entry.itemId) ?? []
        return values.map((value, sortOrder) => ({
          id: `${revision.id.slice(0, 8)}:${value.id}`,
          itemVersionId: versionByItem.get(entry.itemId)!,
          text: value.text,
          sortOrder: 'sortOrder' in value && typeof value.sortOrder === 'number' ? value.sortOrder : sortOrder,
        }))
      })
      for (let offset = 0; offset < vignetteRows.length; offset += 500) await tx.insert(diagnosisVignettes).values(vignetteRows.slice(offset, offset + 500))

      for (const mode of Object.keys(plan.preview.modes) as ContentMode[]) {
        await tx.insert(contentRevisionModes).values({
          revisionId: revision.id,
          mode,
          itemsCount: plan.preview.modes[mode].final,
          sourceChecksum: releaseMergeModeChecksum(plan.entries, mode),
        })
      }
      await tx.update(contentRevisions).set({ status: 'ready' }).where(eq(contentRevisions.id, revision.id))
      await tx.insert(auditLog).values({
        actorUserId: actor.id,
        action: 'content.release.merge.build',
        entityType: 'content_revision',
        entityId: revision.id,
        before: { baseRevisionId: activeRevision.id, activeItems: plan.preview.activeItems },
        after: { version, checksumSha256: finalChecksumSha256, strategy: 'overlay_preserve_active_only', preview: plan.preview },
        requestId,
      })
    })
    return { revisionId: revision.id, version, status: 'ready', existing: false, counts: Object.fromEntries(Object.entries(plan.preview.modes).map(([mode, value]) => [mode, value.final])), preview: plan.preview }
  } catch (error) {
    await db.update(contentRevisions).set({
      status: 'failed',
      sourceManifest: { ...manifest, error: error instanceof Error ? error.message : String(error) },
    }).where(eq(contentRevisions.id, revision.id))
    throw error
  }
}
