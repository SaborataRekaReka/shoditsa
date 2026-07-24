#!/usr/bin/env tsx
/**
 * Merge curated DTF comments into canonical game cards and maintain the DTF
 * content pack as selection/order metadata.
 *
 * Dry run:
 *   npm run content:import:dtf-comments-pack
 *
 * Stage, build, activate and publish:
 *   npm run content:import:dtf-comments-pack -- --apply --activate --publish --actor-id=<admin UUID>
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { TitleItem } from '@shoditsa/contracts'
import { loadConfig } from '@shoditsa/config'
import {
  contentItemVersions,
  contentPackEntries,
  contentPacks,
  contentRevisions,
  contentWorkspaceChanges,
  createDatabase,
  playerProfiles,
  user,
} from '@shoditsa/database'
import {
  activateWorkspaceRevision,
  activateContentRevision,
  buildWorkspaceRevision,
  contentPayloadsEqual,
  getOrCreateWorkspace,
  saveWorkspaceItem,
  validateWorkspace,
} from '../../apps/api/src/modules/admin/content-service.js'
import {
  mergeDtfComments,
  removeUnverifiedPlayerComments,
  resolveDtfPack,
  type DtfCatalogGame,
  type DtfPackDocument,
} from '../../apps/api/src/modules/packs/dtf-comment-merge.js'

const args = process.argv.slice(2)
const hasFlag = (name: string) => args.includes(`--${name}`)
const argValue = (name: string, fallback = '') => {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback
}

const sourcePath = resolve(process.cwd(), argValue('source', 'data/promo/dtf-game-comments-25-v1.json'))
const reportPath = resolve(process.cwd(), argValue('report', 'var/dtf-game-comments-25-import-report.json'))
const apply = hasFlag('apply')
const activate = hasFlag('activate')
const publish = hasFlag('publish')
const actorId = argValue('actor-id').trim()
if (activate && !apply) throw new Error('--activate requires --apply')

const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const persistPack = async (
  db: ReturnType<typeof createDatabase>['db'],
  document: DtfPackDocument,
  bindings: Array<{ itemId: string; order: number }>,
) => db.transaction(async (tx) => {
  const status = publish ? 'published' : 'draft'
  const subtitle = document.pack.subtitle ?? `Спецпоказ DTF · ${bindings.length} игр`
  const metadata = {
    source: sourcePath,
    integrationStrategy: 'canonical_game_comments',
    commentsField: 'comments',
    recommendedMaxAttempts: document.pack.recommendedMaxAttempts,
    publicationStatus: document.pack.publicationStatus,
    rightsStatus: document.pack.rightsStatus,
    experience: document.pack.experience ?? {},
    playSets: document.pack.playSets ?? [],
    uiCopy: document.pack.uiCopy,
  }
  await tx.insert(contentPacks).values({
    id: document.pack.id,
    slug: document.pack.slug,
    mode: 'game',
    title: document.pack.title,
    subtitle,
    description: document.pack.description,
    status,
    accessModel: document.pack.accessModel,
    productId: null,
    includedInClub: true,
    previewItems: bindings.length,
    manifestVersion: document.schemaVersion,
    metadata,
  }).onConflictDoUpdate({
    target: contentPacks.id,
    set: {
      slug: document.pack.slug,
      title: document.pack.title,
      subtitle,
      description: document.pack.description,
      status,
      accessModel: document.pack.accessModel,
      productId: null,
      includedInClub: true,
      previewItems: bindings.length,
      manifestVersion: document.schemaVersion,
      metadata,
      updatedAt: new Date(),
    },
  })

  await tx.delete(contentPackEntries).where(eq(contentPackEntries.packId, document.pack.id))
  await tx.insert(contentPackEntries).values(bindings.map((binding, index) => ({
    packId: document.pack.id,
    position: index + 1,
    answerItemId: binding.itemId,
    promptPayload: {
      schemaVersion: 2,
      sourceOrder: binding.order,
      prompt: document.pack.uiCopy.prompt,
      disclaimer: document.pack.uiCopy.disclaimer,
      recommendedMaxAttempts: document.pack.recommendedMaxAttempts,
      rightsStatus: document.pack.rightsStatus,
      commentsSource: 'answer.comments',
    },
  })))
})

const main = async () => {
  const document = JSON.parse(await readFile(sourcePath, 'utf8')) as DtfPackDocument
  if (document.schemaVersion !== 1) throw new Error(`Unsupported schemaVersion: ${document.schemaVersion}`)
  if (document.items.length !== document.pack.itemCount) {
    throw new Error(`Pack declares ${document.pack.itemCount} items, got ${document.items.length}`)
  }

  const { db, client } = createDatabase(loadConfig())
  try {
    const active = (await db.select({
      id: contentRevisions.id,
      version: contentRevisions.version,
    }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
    if (!active) throw new Error('Active content revision is required')

    const rows = await db.select({
      itemVersionId: contentItemVersions.id,
      itemId: contentItemVersions.itemId,
      allowedInGame: contentItemVersions.allowedInGame,
      contentStatus: contentItemVersions.contentStatus,
      popularityScore: contentItemVersions.popularityScore,
      payload: contentItemVersions.payload,
    }).from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, active.id),
      eq(contentItemVersions.mode, 'game'),
    ))
    const games: DtfCatalogGame[] = rows.map((row) => ({
      ...row,
      payload: row.payload as TitleItem,
    }))
    const resolutions = resolveDtfPack(document, games)
    const unresolved = resolutions.filter((resolution) => !resolution.catalog)
    const canonicalIds = resolutions
      .map((resolution) => resolution.catalog?.itemId)
      .filter((value): value is string => Boolean(value))
    const duplicateCanonicalBindings = [...new Set(
      canonicalIds.filter((value, index) => canonicalIds.indexOf(value) !== index),
    )]
    const bindings = resolutions
      .filter((resolution) => resolution.catalog)
      .map((resolution) => ({
        itemId: resolution.catalog!.itemId,
        order: resolution.item.order,
      }))
    const incomingByItemId = new Map(resolutions
      .filter((resolution) => resolution.catalog)
      .map((resolution) => [resolution.catalog!.itemId, resolution.item.progressiveHints]))
    const merged = games.map((game) => {
      const before = game.payload
      const cleaned = removeUnverifiedPlayerComments(before)
      const incoming = incomingByItemId.get(game.itemId)
      return {
        itemId: game.itemId,
        before,
        after: incoming
          ? mergeDtfComments(cleaned, incoming, document.pack.id)
          : cleaned,
      }
    })
    const changed = merged.filter(({ before, after }) => !contentPayloadsEqual(before, after))
    const baseReport = {
      generatedAt: new Date().toISOString(),
      mode: apply ? activate ? 'apply-and-activate' : 'apply' : 'dry-run',
      sourcePath,
      packId: document.pack.id,
      activeRevision: active,
      counts: {
        requested: document.items.length,
        resolved: resolutions.length - unresolved.length,
        unresolved: unresolved.length,
        comments: document.items.reduce((total, item) => total + item.progressiveHints.length, 0),
        changedGames: changed.length,
      },
      duplicateCanonicalBindings,
      missingGames: unresolved.map(({ item }) => ({
        gameId: item.gameId,
        titleRu: item.answerRef.titleRu,
        titleOriginal: item.answerRef.titleOriginal,
        year: item.answerRef.year,
        steamAppIds: item.answerRef.steamAppIds,
        aliases: item.answerRef.aliases,
      })),
      resolutions: resolutions.map((resolution) => ({
        gameId: resolution.item.gameId,
        packItemId: resolution.item.id,
        status: resolution.status,
        method: resolution.method,
        itemId: resolution.catalog?.itemId ?? null,
        itemVersionId: resolution.catalog?.itemVersionId ?? null,
        matchedTitle: resolution.catalog?.payload.titleRu ?? null,
        matchedYear: resolution.catalog?.payload.year ?? null,
        comments: resolution.item.progressiveHints.length,
      })),
    }

    if (duplicateCanonicalBindings.length || unresolved.length) {
      await writeJson(reportPath, {
        ...baseReport,
        imported: false,
        error: duplicateCanonicalBindings.length
          ? 'DUPLICATE_CANONICAL_BINDING'
          : 'UNRESOLVED_CANONICAL_GAME',
      })
      throw new Error(duplicateCanonicalBindings.length
        ? `Several pack items resolved to the same card: ${duplicateCanonicalBindings.join(', ')}`
        : `${unresolved.length} DTF games are absent from the active catalog`)
    }

    if (!apply) {
      await writeJson(reportPath, { ...baseReport, imported: false, dryRun: true })
      console.log(JSON.stringify({ ...baseReport, reportPath }, null, 2))
      return
    }

    let workspaceId: string | null = null
    let activatedRevision: { id: string; version: string } | null = null
    let resumedWorkspace = false
    let validation: Awaited<ReturnType<typeof validateWorkspace>> | null = null
    if (changed.length) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)) {
        throw new Error('--actor-id with a valid admin user UUID is required for --apply')
      }
      const actor = (await db.select({ id: user.id, role: playerProfiles.role }).from(user)
        .innerJoin(playerProfiles, eq(playerProfiles.userId, user.id))
        .where(eq(user.id, actorId))
        .limit(1))[0]
      if (!actor || actor.role !== 'admin') throw new Error('--actor-id must identify an admin user')

      let workspace = await getOrCreateWorkspace(db, actor)
      workspaceId = workspace.id
      if (workspace.status !== 'open') throw new Error(`Content workspace ${workspace.id} is ${workspace.status}, expected open`)
      if (workspace.baseRevisionId !== active.id) {
        await activateContentRevision(
          db,
          actor,
          active.id,
          `dtf-comments-rebase:${randomUUID()}`,
          `Rebase empty workspace before importing ${document.pack.id}`,
        )
        workspace = await getOrCreateWorkspace(db, actor)
        workspaceId = workspace.id
      }
      const existingChanges = await db.select({
        itemId: contentWorkspaceChanges.itemId,
        afterPayload: contentWorkspaceChanges.afterPayload,
        source: contentWorkspaceChanges.source,
      }).from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId, workspace.id))
      const intendedByItem = new Map(changed.map((entry) => [entry.itemId, entry.after]))
      const canResume = existingChanges.length === changed.length
        && existingChanges.every((change) => change.source === 'import'
          && intendedByItem.has(change.itemId)
          && contentPayloadsEqual(change.afterPayload, intendedByItem.get(change.itemId)))
      if (existingChanges.length && !canResume) {
        throw new Error(`Content workspace ${workspace.id} already contains ${existingChanges.length} unrelated or conflicting change(s); publish or discard them before the DTF merge`)
      }
      resumedWorkspace = existingChanges.length > 0 && canResume

      const requestId = `dtf-comments-merge:${randomUUID()}`
      if (!canResume) {
        for (const { itemId, after } of changed) {
          await saveWorkspaceItem(db, actor, itemId, {
            mode: 'game',
            payload: after as unknown as Record<string, unknown>,
            expectedVersion: 0,
            source: 'import',
            reason: `Merge ${document.pack.id} comments into canonical game data`,
          }, requestId)
        }
      }
      validation = await validateWorkspace(db, actor)

      if (activate) {
        await buildWorkspaceRevision(db, actor, workspace.id, requestId)
        const activated = await activateWorkspaceRevision(db, actor, workspace.id, requestId)
        activatedRevision = {
          id: activated.revision.id,
          version: activated.revision.version,
        }
      }
    } else {
      activatedRevision = active
    }

    const packUpdated = Boolean(activate || !changed.length)
    if (packUpdated) await persistPack(db, document, bindings)
    const report = {
      ...baseReport,
      imported: true,
      workspaceId,
      activatedRevision,
      resumedWorkspace,
      validation,
      packUpdated,
      packStatus: packUpdated ? publish ? 'published' : 'draft' : 'unchanged',
      nextStep: !activate && changed.length
        ? 'Review and publish the staged workspace, then rerun with --apply to update pack metadata.'
        : null,
    }
    await writeJson(reportPath, report)
    console.log(JSON.stringify({ ...report, reportPath }, null, 2))
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
