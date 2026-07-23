#!/usr/bin/env tsx
/**
 * Persist approved game plot hints in the active content revision.
 *
 * Dry run:
 *   npm run content:import:game-hints
 *
 * Stage, build and activate:
 *   npm run content:import:game-hints -- --apply --activate --actor-id=<admin UUID>
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { TitleItem } from '@shoditsa/contracts'
import { loadConfig } from '@shoditsa/config'
import {
  contentItemVersions,
  contentRevisions,
  contentWorkspaceChanges,
  createDatabase,
  playerProfiles,
  user,
} from '@shoditsa/database'
import { isPlayableGamePlotHint } from '@shoditsa/game-core'
import {
  activateWorkspaceRevision,
  buildWorkspaceRevision,
  contentPayloadsEqual,
  discardWorkspaceItem,
  getOrCreateWorkspace,
  saveWorkspaceItem,
  validateWorkspace,
  workspaceContainsOnlyRedundantImports,
} from '../../apps/api/src/modules/admin/content-service.js'

type HintPatchDocument = {
  schemaVersion: number
  source?: Record<string, unknown>
  count?: number
  items: Array<{ id: string; plotHint: string }>
}

const args = process.argv.slice(2)
const hasFlag = (name: string) => args.includes(`--${name}`)
const argValue = (name: string, fallback = '') => {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback
}

const sourcePath = resolve(process.cwd(), argValue('source', 'data/games/manual/game-plot-hints-2026-07-17.json'))
const reportPath = resolve(process.cwd(), argValue('report', 'var/game-plot-hints-import-report.json'))
const apply = hasFlag('apply')
const activate = hasFlag('activate')
const actorId = argValue('actor-id').trim()
if (activate && !apply) throw new Error('--activate requires --apply')

const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const main = async () => {
  const document = JSON.parse(await readFile(sourcePath, 'utf8')) as HintPatchDocument
  if (document.schemaVersion !== 1) throw new Error(`Unsupported schemaVersion: ${document.schemaVersion}`)
  if (!Array.isArray(document.items) || !document.items.length) throw new Error('Hint patch is empty')
  if (document.count != null && document.count !== document.items.length) {
    throw new Error(`Hint patch declares ${document.count} items, got ${document.items.length}`)
  }
  const duplicateIds = document.items
    .map((item) => item.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index)
  if (duplicateIds.length) throw new Error(`Hint patch contains duplicate IDs: ${[...new Set(duplicateIds)].join(', ')}`)

  const { db, client } = createDatabase(loadConfig())
  try {
    const active = (await db.select({
      id: contentRevisions.id,
      version: contentRevisions.version,
    }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
    if (!active) throw new Error('Active content revision is required')

    const rows = await db.select({
      itemId: contentItemVersions.itemId,
      payload: contentItemVersions.payload,
    }).from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, active.id),
      eq(contentItemVersions.mode, 'game'),
    ))
    const activeById = new Map(rows.map((row) => [row.itemId, row.payload as TitleItem]))
    const missingIds: string[] = []
    const invalidIds: string[] = []
    const intended = document.items.flatMap((patch) => {
      const before = activeById.get(patch.id)
      if (!before) {
        missingIds.push(patch.id)
        return []
      }
      const after = { ...before, plotHint: patch.plotHint }
      if (!isPlayableGamePlotHint(after)) {
        invalidIds.push(patch.id)
        return []
      }
      return [{ itemId: patch.id, before, after }]
    })
    if (invalidIds.length) throw new Error(`Hint patch contains invalid approved hints: ${invalidIds.join(', ')}`)
    if (!intended.length) throw new Error('None of the approved hint IDs exist in the active revision')

    const changed = intended.filter(({ before, after }) => !contentPayloadsEqual(before, after))
    const baseReport = {
      generatedAt: new Date().toISOString(),
      mode: apply ? activate ? 'apply-and-activate' : 'apply' : 'dry-run',
      sourcePath,
      source: document.source ?? null,
      activeRevision: active,
      counts: {
        requested: document.items.length,
        resolved: intended.length,
        missing: missingIds.length,
        changed: changed.length,
        unchanged: intended.length - changed.length,
      },
      missingIds,
    }

    if (!apply) {
      await writeJson(reportPath, { ...baseReport, imported: false, dryRun: true })
      console.log(JSON.stringify({ ...baseReport, reportPath }, null, 2))
      return
    }

    let workspaceId: string | null = null
    let resumedWorkspace = false
    let discardedRedundantWorkspaceChanges = 0
    let validation: Awaited<ReturnType<typeof validateWorkspace>> | null = null
    let activatedRevision: { id: string; version: string } | null = active
    if (changed.length) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)) {
        throw new Error('--actor-id with a valid admin user UUID is required for --apply')
      }
      const actor = (await db.select({ id: user.id, role: playerProfiles.role }).from(user)
        .innerJoin(playerProfiles, eq(playerProfiles.userId, user.id))
        .where(eq(user.id, actorId))
        .limit(1))[0]
      if (!actor || actor.role !== 'admin') throw new Error('--actor-id must identify an admin user')

      const workspace = await getOrCreateWorkspace(db, actor)
      workspaceId = workspace.id
      if (workspace.status !== 'open') throw new Error(`Content workspace ${workspace.id} is ${workspace.status}, expected open`)
      if (workspace.baseRevisionId !== active.id) throw new Error('Content workspace is based on a different revision')

      let existingChanges = await db.select({
        itemId: contentWorkspaceChanges.itemId,
        afterPayload: contentWorkspaceChanges.afterPayload,
        source: contentWorkspaceChanges.source,
      }).from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId, workspace.id))
      if (workspaceContainsOnlyRedundantImports(existingChanges, activeById)) {
        const cleanupRequestId = `approved-game-hints:discard-redundant:${randomUUID()}`
        for (const change of existingChanges) {
          const result = await discardWorkspaceItem(db, actor, change.itemId, cleanupRequestId)
          if (result.discarded) discardedRedundantWorkspaceChanges += 1
        }
        existingChanges = []
      }
      const intendedById = new Map(changed.map((entry) => [entry.itemId, entry.after]))
      const canResume = existingChanges.length === changed.length
        && existingChanges.every((change) => change.source === 'import'
          && intendedById.has(change.itemId)
          && contentPayloadsEqual(change.afterPayload, intendedById.get(change.itemId)))
      if (existingChanges.length && !canResume) {
        throw new Error(`Content workspace ${workspace.id} already contains ${existingChanges.length} unrelated or conflicting change(s)`)
      }
      resumedWorkspace = existingChanges.length > 0 && canResume

      const requestId = `approved-game-hints:${randomUUID()}`
      if (!canResume) {
        for (const entry of changed) {
          await saveWorkspaceItem(db, actor, entry.itemId, {
            mode: 'game',
            payload: entry.after as unknown as Record<string, unknown>,
            expectedVersion: 0,
            source: 'import',
            reason: 'Persist approved game plot hints from the published quality pipeline',
          }, requestId)
        }
      }
      validation = await validateWorkspace(db, actor)
      if (activate) {
        await buildWorkspaceRevision(db, actor, workspace.id, requestId)
        const activated = await activateWorkspaceRevision(db, actor, workspace.id, requestId)
        activatedRevision = { id: activated.revision.id, version: activated.revision.version }
      } else {
        activatedRevision = null
      }
    }

    const report = {
      ...baseReport,
      imported: true,
      workspaceId,
      resumedWorkspace,
      discardedRedundantWorkspaceChanges,
      validation,
      activatedRevision,
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
