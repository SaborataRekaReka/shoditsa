#!/usr/bin/env tsx
/**
 * Stage the normalized K-pop artist cards into an admin content workspace,
 * optionally activate the resulting revision, and create the club-only daily
 * special catalog.
 *
 * Validate source only:
 *   npm run content:import:kpop-special
 *
 * Stage and activate:
 *   npm run content:import:kpop-special -- --apply --activate --actor-id=<admin UUID>
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { KPOP_ARTISTS_PACK_ID, type TitleItem } from '@shoditsa/contracts'
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
  buildWorkspaceRevision,
  contentPayloadsEqual,
  getOrCreateWorkspace,
  saveWorkspaceItem,
  validateWorkspace,
} from '../../apps/api/src/modules/admin/content-service.js'

type KpopPackDocument = {
  schemaVersion: number
  source: string
  generationRules: Array<{ generation: number; from: number; to: number | null }>
  pack: {
    id: string
    slug: string
    mode: 'music'
    title: string
    subtitle: string
    description: string
    coverUrl: string
    titlePosterUrl: string
    status: 'draft'
    accessModel: 'club'
    adminOnly: false
    cadence: 'daily'
    maxAttempts: number
  }
  counts: Record<string, unknown>
  items: TitleItem[]
}

const args = process.argv.slice(2)
const hasFlag = (name: string) => args.includes(`--${name}`)
const argValue = (name: string, fallback = '') => {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback
}

const sourcePath = resolve(process.cwd(), argValue('source', 'data/kpop/kpop-artists-admin-v1.json'))
const reportPath = resolve(process.cwd(), argValue('report', 'var/kpop-artists-admin-v1-import-report.json'))
const apply = hasFlag('apply')
const activate = hasFlag('activate')
const actorId = argValue('actor-id').trim()
if (activate && !apply) throw new Error('--activate requires --apply')

const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const assertDocument = (document: KpopPackDocument) => {
  if (document.schemaVersion !== 1) throw new Error(`Unsupported schemaVersion: ${document.schemaVersion}`)
  if (document.pack.id !== KPOP_ARTISTS_PACK_ID || document.pack.mode !== 'music' || document.pack.adminOnly !== false || document.pack.cadence !== 'daily') {
    throw new Error('The source is not the expected club-only daily K-pop special')
  }
  if (!document.items.length || document.items.some((item) => (
    item.mode !== 'music'
    || item.cardType !== 'kpop_artist'
    || item.allowedInGame !== false
    || !item.id.startsWith('kpop:')
  ))) {
    throw new Error('Every K-pop item must be a disabled regular-pool music card with cardType=kpop_artist')
  }
  if (new Set(document.items.map((item) => item.id)).size !== document.items.length) {
    throw new Error('Duplicate K-pop item IDs')
  }
}

const loadActivePayloads = async (
  db: ReturnType<typeof createDatabase>['db'],
  revisionId: string,
  itemIds: string[],
) => {
  const rows: Array<{ itemId: string; payload: unknown }> = []
  for (let offset = 0; offset < itemIds.length; offset += 400) {
    rows.push(...await db.select({
      itemId: contentItemVersions.itemId,
      payload: contentItemVersions.payload,
    }).from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, revisionId),
      inArray(contentItemVersions.itemId, itemIds.slice(offset, offset + 400)),
    )))
  }
  return new Map(rows.map((row) => [row.itemId, row.payload]))
}

const persistPack = async (
  db: ReturnType<typeof createDatabase>['db'],
  document: KpopPackDocument,
) => db.transaction(async (tx) => {
  await tx.insert(contentPacks).values({
    id: document.pack.id,
    slug: document.pack.slug,
    mode: document.pack.mode,
    title: document.pack.title,
    subtitle: document.pack.subtitle,
    description: document.pack.description,
    coverUrl: document.pack.coverUrl,
    status: 'draft',
    accessModel: 'club',
    productId: null,
    includedInClub: true,
    previewItems: 0,
    manifestVersion: document.schemaVersion,
    metadata: {
      source: document.source,
      adminOnly: false,
      cardType: 'kpop_artist',
      titlePosterUrl: document.pack.titlePosterUrl,
      maxAttempts: document.pack.maxAttempts,
      generationRules: document.generationRules,
      counts: document.counts,
    },
  }).onConflictDoUpdate({
    target: contentPacks.id,
    set: {
      slug: document.pack.slug,
      mode: document.pack.mode,
      title: document.pack.title,
      subtitle: document.pack.subtitle,
      description: document.pack.description,
      coverUrl: document.pack.coverUrl,
      status: 'draft',
      accessModel: 'club',
      productId: null,
      includedInClub: true,
      previewItems: 0,
      manifestVersion: document.schemaVersion,
      metadata: {
        source: document.source,
        adminOnly: false,
        cardType: 'kpop_artist',
        titlePosterUrl: document.pack.titlePosterUrl,
        maxAttempts: document.pack.maxAttempts,
        generationRules: document.generationRules,
        counts: document.counts,
      },
      updatedAt: new Date(),
    },
  })
  await tx.delete(contentPackEntries).where(eq(contentPackEntries.packId, document.pack.id))
  for (let offset = 0; offset < document.items.length; offset += 400) {
    const chunk = document.items.slice(offset, offset + 400)
    await tx.insert(contentPackEntries).values(chunk.map((item, index) => ({
      packId: document.pack.id,
      position: offset + index + 1,
      answerItemId: item.id,
      promptPayload: {
        schemaVersion: 1,
        cardType: 'kpop_artist',
        maxAttempts: document.pack.maxAttempts,
      },
    })))
  }
})

const main = async () => {
  const document = JSON.parse(await readFile(sourcePath, 'utf8')) as KpopPackDocument
  assertDocument(document)
  const baseReport = {
    generatedAt: new Date().toISOString(),
    sourcePath,
    packId: document.pack.id,
    items: document.items.length,
    generationRules: document.generationRules,
    counts: document.counts,
  }

  if (!apply) {
    const report = { ...baseReport, imported: false, dryRun: true }
    await writeJson(reportPath, report)
    console.log(JSON.stringify({ ...report, reportPath }, null, 2))
    return
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)) {
    throw new Error('--actor-id with a valid admin user UUID is required for --apply')
  }

  const { db, client } = createDatabase(loadConfig())
  try {
    const actor = (await db.select({ id: user.id, role: playerProfiles.role }).from(user)
      .innerJoin(playerProfiles, eq(playerProfiles.userId, user.id))
      .where(eq(user.id, actorId))
      .limit(1))[0]
    if (!actor || actor.role !== 'admin') throw new Error('--actor-id must identify an admin user')

    const active = (await db.select({ id: contentRevisions.id, version: contentRevisions.version })
      .from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
    if (!active) throw new Error('Active content revision is required')

    const workspace = await getOrCreateWorkspace(db, actor)
    if (workspace.status !== 'open') throw new Error(`Content workspace ${workspace.id} is ${workspace.status}, expected open`)
    if (workspace.baseRevisionId !== active.id) throw new Error('Content workspace must be rebased onto the active revision')

    const intendedById = new Map(document.items.map((item) => [item.id, item]))
    const activeById = await loadActivePayloads(db, active.id, [...intendedById.keys()])
    const existingChanges = await db.select().from(contentWorkspaceChanges)
      .where(eq(contentWorkspaceChanges.workspaceId, workspace.id))
    const conflicting = existingChanges.filter((change) => (
      change.source !== 'import'
      || !intendedById.has(change.itemId)
      || !contentPayloadsEqual(change.afterPayload, intendedById.get(change.itemId))
    ))
    if (conflicting.length) {
      throw new Error(`Content workspace ${workspace.id} contains ${conflicting.length} unrelated or conflicting change(s)`)
    }

    const stagedIds = new Set(existingChanges.map((change) => change.itemId))
    const changedItems = document.items.filter((item) => (
      !activeById.has(item.id) || !contentPayloadsEqual(activeById.get(item.id), item)
    ))
    const requestId = `kpop-special-import:${randomUUID()}`
    for (const item of changedItems) {
      if (stagedIds.has(item.id)) continue
      await saveWorkspaceItem(db, actor, item.id, {
        mode: 'music',
        payload: item as unknown as Record<string, unknown>,
        expectedVersion: 0,
        source: 'import',
        reason: `Import ${KPOP_ARTISTS_PACK_ID}`,
      }, requestId)
    }

    const validation = changedItems.length
      ? await validateWorkspace(db, actor)
      : { checked: 0, errors: 0, warnings: 0, issues: [], validatedAt: new Date().toISOString() }
    let activatedRevision: { id: string; version: string } | null = null
    if (activate && changedItems.length) {
      const built = await buildWorkspaceRevision(db, actor, workspace.id, requestId)
      const activated = await activateWorkspaceRevision(db, actor, workspace.id, requestId)
      activatedRevision = { id: activated.revision.id, version: built.version }
    } else if (!changedItems.length) {
      activatedRevision = active
    }

    const packReady = Boolean(activatedRevision)
    if (packReady) await persistPack(db, document)
    const report = {
      ...baseReport,
      imported: true,
      workspaceId: workspace.id,
      stagedItems: changedItems.length,
      validation,
      activatedRevision,
      packUpdated: packReady,
      packStatus: packReady ? 'draft_club_only' : 'not_created',
      nextStep: packReady ? null : 'Review and activate the staged content workspace, then rerun this command.',
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
