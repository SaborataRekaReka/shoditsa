import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { TitleItem } from '@shoditsa/contracts'
import { loadConfig } from '@shoditsa/config'
import {
  auditLog, contentItemVersions, contentRevisions, contentWorkspaceChanges, contentWorkspaces, createDatabase, playerProfiles, user,
} from '@shoditsa/database'
import {
  activateWorkspaceRevision, buildWorkspaceRevision, getOrCreateWorkspace, validateContentPayload, validateWorkspace,
} from '../../apps/api/src/modules/admin/content-service.js'
import { arg, hasArg } from './lib.js'
import {
  MUSIC_TIER_BACKFILL_VERSION, MUSIC_TIER_THRESHOLDS, proposeMusicTierBackfill, summarizeMusicTierProposals,
} from './music-tier-backfill-lib.js'

const apply = hasArg('--apply')
const activate = hasArg('--activate')
if (activate && !apply) throw new Error('--activate requires --apply')

const actorIdArg = arg('--actor-id')?.trim()
const expectedArg = arg('--expect')
const expected = expectedArg == null ? null : Number(expectedArg)
if (expected != null && (!Number.isInteger(expected) || expected < 0)) throw new Error('--expect must be a non-negative integer')

const { db, client } = createDatabase(loadConfig())
try {
  const active = (await db.select({ id: contentRevisions.id, version: contentRevisions.version }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!active) throw new Error('Active content revision not found')

  const rows = await db.select({
    id: contentItemVersions.id,
    itemId: contentItemVersions.itemId,
    popularityScore: contentItemVersions.popularityScore,
    payload: contentItemVersions.payload,
  }).from(contentItemVersions).where(and(
    eq(contentItemVersions.revisionId, active.id),
    eq(contentItemVersions.mode, 'music'),
    eq(contentItemVersions.allowedInGame, true),
  ))

  const proposals = proposeMusicTierBackfill(rows.map((row) => ({
    itemId: row.itemId,
    popularityScore: row.popularityScore,
    payload: row.payload as TitleItem,
  })))
  const summary = summarizeMusicTierProposals(proposals)
  const report = {
    mode: apply ? activate ? 'apply-and-activate' : 'apply' : 'dry-run',
    algorithm: MUSIC_TIER_BACKFILL_VERSION,
    thresholds: MUSIC_TIER_THRESHOLDS,
    activeRevision: active,
    eligibleMusicCards: rows.length,
    ...summary,
  }
  console.log(JSON.stringify(report, null, 2))

  if (expected != null && proposals.length !== expected) throw new Error(`Expected ${expected} missing music tiers, found ${proposals.length}`)
  if (!apply) process.exit(0)
  if (!proposals.length) throw new Error('No missing music tiers to backfill')
  if (!actorIdArg || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorIdArg)) {
    throw new Error('--actor-id with a valid admin user UUID is required for --apply')
  }
  const actor = (await db.select({ id: user.id, role: playerProfiles.role }).from(user)
    .innerJoin(playerProfiles, eq(playerProfiles.userId, user.id)).where(eq(user.id, actorIdArg)).limit(1))[0]
  if (!actor || actor.role !== 'admin') throw new Error('--actor-id must identify an admin user')

  const workspace = await getOrCreateWorkspace(db, actor)
  if (workspace.status !== 'open') throw new Error(`Content workspace ${workspace.id} is ${workspace.status}, expected open`)
  if (workspace.baseRevisionId !== active.id) throw new Error('Content workspace is based on a different revision')
  const existingChanges = (await db.select({ count: sql<number>`count(*)::int` }).from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId, workspace.id)))[0]?.count ?? 0
  if (existingChanges) throw new Error(`Content workspace ${workspace.id} already contains ${existingChanges} change(s)`)

  const rowByItem = new Map(rows.map((row) => [row.itemId, row]))
  const changes = proposals.map((proposal) => {
    const base = rowByItem.get(proposal.itemId)!
    const validationIssues = validateContentPayload(proposal.afterPayload as unknown as Record<string, unknown>, 'music')
    const errors = validationIssues.filter((issue) => issue.level === 'error')
    if (errors.length) throw new Error(`${proposal.itemId} failed validation: ${JSON.stringify(errors)}`)
    return {
      workspaceId: workspace.id,
      itemId: proposal.itemId,
      mode: 'music' as const,
      changeType: 'update',
      baseItemVersionId: base.id,
      beforePayload: proposal.payload,
      afterPayload: proposal.afterPayload,
      changedFields: ['gameTier', 'gameDifficulty', 'gameWeight', 'contentStatus'],
      source: 'bulk',
      actorUserId: actor.id,
      reason: `Автозаполнение уровня по процентилю популярности (${MUSIC_TIER_BACKFILL_VERSION})`,
      validationIssues,
    }
  })

  const requestId = `music-tier-backfill:${randomUUID()}`
  await db.transaction(async (tx) => {
    await tx.insert(contentWorkspaceChanges).values(changes)
    await tx.update(contentWorkspaces).set({
      version: sql`${contentWorkspaces.version} + 1`, updatedAt: new Date(), lastValidationSummary: null,
    }).where(eq(contentWorkspaces.id, workspace.id))
    await tx.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'content.music_tier.backfill',
      entityType: 'content_workspace',
      entityId: workspace.id,
      before: { baseRevisionId: active.id, changes: 0 },
      after: { algorithm: MUSIC_TIER_BACKFILL_VERSION, thresholds: MUSIC_TIER_THRESHOLDS, ...summary },
      reason: 'Автозаполнение отсутствующих уровней музыкальных карточек',
      requestId,
    })
  })

  const validation = await validateWorkspace(db, actor)
  if (validation.errors) throw new Error(`Workspace validation failed with ${validation.errors} error(s)`)
  const built = await buildWorkspaceRevision(db, actor, workspace.id, requestId)
  console.log(JSON.stringify({ workspaceId: workspace.id, builtRevisionId: built.revisionId, validation: { checked: validation.checked, errors: validation.errors, warnings: validation.warnings } }, null, 2))

  if (activate) {
    const activated = await activateWorkspaceRevision(db, actor, workspace.id, requestId)
    console.log(JSON.stringify({ activatedRevisionId: activated.revision.id, nextWorkspaceId: activated.workspace.id }, null, 2))
  }
} finally {
  await client.end()
}
