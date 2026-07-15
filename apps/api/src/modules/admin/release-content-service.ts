import { and, eq } from 'drizzle-orm'
import {
  auditLog, contentAliases, contentItems, contentItemVersions, contentRevisionModes, contentRevisions,
  diagnosisVignettes, type Database,
} from '@shoditsa/database'
import { normalize } from '@shoditsa/game-core'
import { ApiError } from '../../lib/errors.js'
import { loadReleaseLibraries, releaseAliasesFor } from './release-content-loader.js'

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

const releaseManifest = (loaded: LoadedRelease, gitSha: string) => ({
  source: 'release_catalog',
  gitSha,
  generatedAt: loaded.manifest.generatedAt,
  checksumSha256: loaded.manifest.checksumSha256,
  totalItems: loaded.manifest.totalItems,
  modes: Object.fromEntries(Object.entries(loaded.manifest.modes).map(([mode, entry]) => [mode, {
    count: entry.count,
    checksumSha256: entry.checksumSha256,
  }])),
  warnings: loaded.manifest.warnings,
})

export const inspectReleaseContent = async (db: Database, sourceRoot: string, gitSha: string) => {
  const loaded = await loadRelease(sourceRoot)
  const [activeRows, matchingRows] = await Promise.all([
    db.select({
      id: contentRevisions.id, version: contentRevisions.version, checksumSha256: contentRevisions.checksumSha256,
      status: contentRevisions.status, createdAt: contentRevisions.createdAt, activatedAt: contentRevisions.activatedAt,
    }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1),
    db.select({
      id: contentRevisions.id, version: contentRevisions.version, checksumSha256: contentRevisions.checksumSha256,
      status: contentRevisions.status, createdAt: contentRevisions.createdAt, activatedAt: contentRevisions.activatedAt,
    }).from(contentRevisions).where(eq(contentRevisions.checksumSha256, loaded.manifest.checksumSha256)).limit(1),
  ])
  const activeRevision = activeRows[0] ?? null
  const matchingRevision = matchingRows[0] ?? null
  const state = activeRevision?.checksumSha256 === loaded.manifest.checksumSha256
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
    release: releaseManifest(loaded, gitSha),
    activeRevision,
    matchingRevision,
  }
}

export const buildReleaseContentRevision = async (db: Database, actor: Actor, sourceRoot: string, gitSha: string, requestId: string) => {
  const loaded = await loadRelease(sourceRoot)
  const manifest = releaseManifest(loaded, gitSha)
  const activeCounts = await db.select({ mode: contentRevisionModes.mode, count: contentRevisionModes.itemsCount })
    .from(contentRevisionModes).innerJoin(contentRevisions, eq(contentRevisions.id, contentRevisionModes.revisionId))
    .where(eq(contentRevisions.status, 'active'))
  const incoming = new Map(loaded.libraries.map((library) => [library.mode, library.items.length]))
  for (const current of activeCounts) {
    if ((incoming.get(current.mode) ?? 0) < current.count * .95) {
      throw new ApiError(409, 'CONTENT_MODE_COUNT_DROP_GUARD', `Защита от потери данных: в режиме ${current.mode} количество карточек уменьшилось более чем на 5%`, {
        mode: current.mode, before: current.count, after: incoming.get(current.mode) ?? 0,
      })
    }
  }

  const existing = (await db.select().from(contentRevisions)
    .where(eq(contentRevisions.checksumSha256, loaded.manifest.checksumSha256)).limit(1))[0]
  if (existing && existing.status !== 'failed') {
    return { revisionId: existing.id, version: existing.version, status: existing.status, existing: true }
  }

  const version = existing?.version ?? `release-${gitSha.slice(0, 12)}-${loaded.manifest.checksumSha256.slice(0, 8)}`
  const revision = existing
    ? (await db.update(contentRevisions).set({ status: 'importing', sourceManifest: manifest, createdBy: actor.id })
      .where(eq(contentRevisions.id, existing.id)).returning())[0]
    : (await db.insert(contentRevisions).values({
      version, checksumSha256: loaded.manifest.checksumSha256, sourceManifest: manifest, status: 'importing', createdBy: actor.id,
    }).returning())[0]

  try {
    await db.transaction(async (tx) => {
      for (const library of loaded.libraries) {
        await tx.insert(contentRevisionModes).values({
          revisionId: revision.id, mode: library.mode, itemsCount: library.items.length, sourceChecksum: library.checksum,
        })
        for (let offset = 0; offset < library.items.length; offset += 200) {
          const chunk = library.items.slice(offset, offset + 200)
          await tx.insert(contentItems).values(chunk.map((item) => ({ id: item.id, mode: library.mode })))
            .onConflictDoUpdate({ target: contentItems.id, set: { mode: library.mode, updatedAt: new Date() } })
          const versions = await tx.insert(contentItemVersions).values(chunk.map((item, index) => ({
            itemId: item.id,
            revisionId: revision.id,
            mode: library.mode,
            titleRu: item.titleRu,
            titleOriginal: item.titleOriginal ?? '',
            normalizedTitle: normalize(item.titleRu),
            year: item.year,
            endYear: item.endYear ?? null,
            popularityScore: Number.isFinite(item.popularityScore) ? item.popularityScore : 0,
            topRank: item.topRank ?? null,
            sortOrder: offset + index,
            allowedInGame: item.allowedInGame ?? true,
            contentStatus: item.contentStatus ?? null,
            payload: item,
          }))).returning({ id: contentItemVersions.id, itemId: contentItemVersions.itemId })
          const itemById = new Map(chunk.map((item) => [item.id, item]))
          const aliasRows = versions.flatMap((row) => releaseAliasesFor(itemById.get(row.itemId)!)
            .map((entry) => ({ itemVersionId: row.id, ...entry })))
          if (aliasRows.length) await tx.insert(contentAliases).values(aliasRows)
        }
      }

      const diagnosisVersions = await tx.select({ id: contentItemVersions.id, itemId: contentItemVersions.itemId })
        .from(contentItemVersions).where(and(
          eq(contentItemVersions.revisionId, revision.id), eq(contentItemVersions.mode, 'diagnosis'),
        ))
      const versionByItem = new Map(diagnosisVersions.map((row) => [row.itemId, row.id]))
      const vignetteRows = loaded.vignettes.flatMap((group) => group.caseVignettes.map((entry, sortOrder) => ({
        id: `${revision.id.slice(0, 8)}:${entry.id}`,
        itemVersionId: versionByItem.get(group.diagnosisId)!,
        text: entry.text,
        sortOrder,
      })))
      for (let offset = 0; offset < vignetteRows.length; offset += 500) {
        await tx.insert(diagnosisVignettes).values(vignetteRows.slice(offset, offset + 500))
      }
      await tx.update(contentRevisions).set({ status: 'ready' }).where(eq(contentRevisions.id, revision.id))
      await tx.insert(auditLog).values({
        actorUserId: actor.id,
        action: 'content.release.build',
        entityType: 'content_revision',
        entityId: revision.id,
        before: null,
        after: { version, checksumSha256: loaded.manifest.checksumSha256, totalItems: loaded.manifest.totalItems, counts: Object.fromEntries(incoming) },
        requestId,
      })
    })
    return { revisionId: revision.id, version, status: 'ready', existing: false, totalItems: loaded.manifest.totalItems, counts: Object.fromEntries(incoming) }
  } catch (error) {
    await db.update(contentRevisions).set({
      status: 'failed',
      sourceManifest: { ...manifest, error: error instanceof Error ? error.message : String(error) },
    }).where(eq(contentRevisions.id, revision.id))
    throw error
  }
}
