import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  contentRevisions,
  contentItemVersions,
  contentWorkspaceChanges,
  contentWorkspaces,
  createDatabase,
  pipelineRunItems,
  pipelineRuns,
  playerProfiles,
} from '@shoditsa/database'
import {
  activateWorkspaceRevision,
  buildWorkspaceRevision,
  validateContentPayload,
} from '../../apps/api/src/modules/admin/content-service.js'

const [factsRunId, hintsRunId] = process.argv.slice(2)
if (!factsRunId || !hintsRunId) {
  throw new Error('Usage: city-content-finalize <facts-run-id> <hints-run-id>')
}

const config = loadConfig()
const { db, client } = createDatabase(config)
const requestId = `city-content-finalize:${randomUUID()}`
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const strings = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : []

const sourceCorrections: Record<string, Record<string, unknown>> = {
  'city:san-jose-2': { titleOriginal: 'San José', population: 342188, timezone: 'GMT-06:00', alternativeTitles: ['Chepe', 'San Jose'] },
  'city:portland-2': { titleOriginal: 'Bridgetown', population: 110000, timezone: 'GMT-04:00', alternativeTitles: [], cityFlagUrl: null, coatOfArmsUrl: null },
  'city:bordeaux-2': { titleOriginal: 'Porto', population: 231800, timezone: 'GMT+00:00', alternativeTitles: ['Oporto'] },
  'city:jerusalem-2': { titleOriginal: 'Salem', population: 917414, timezone: 'GMT+05:30', alternativeTitles: [] },
  'city:tijuana': { titleOriginal: 'Zaragoza', population: 682513, timezone: 'GMT+01:00', alternativeTitles: ['Saragossa', 'Saragosa'] },
  'city:dayton-2': { titleOriginal: 'Venice', population: 249466, timezone: 'GMT+01:00', alternativeTitles: ['Venezia', 'Venise'] },
  'city:changchun': { titleOriginal: 'Cancún', population: 888797, timezone: 'GMT-05:00', alternativeTitles: ['Cancun'] },
  'city:chattogram': { titleOriginal: 'Islamabad–Rawalpindi', population: 3113056, timezone: 'GMT+05:00', alternativeTitles: ['Islamabad-Rawalpindi', 'Twin Cities'] },
}

try {
  const admin = (await db.select({ id: playerProfiles.userId }).from(playerProfiles).where(eq(playerProfiles.role, 'admin')).limit(1))[0]
  if (!admin) throw new Error('Production admin was not found')

  const workspace = (await db.select().from(contentWorkspaces).where(eq(contentWorkspaces.status, 'open')).limit(1))[0]
  if (!workspace) throw new Error('Open content workspace was not found')
  const active = (await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!active || workspace.baseRevisionId !== active.id) throw new Error('Workspace is not based on the active revision')

  const [facts, hints, changes] = await Promise.all([
    db.select().from(pipelineRunItems).where(eq(pipelineRunItems.runId, factsRunId)),
    db.select().from(pipelineRunItems).where(eq(pipelineRunItems.runId, hintsRunId)),
    db.select().from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId, workspace.id)),
  ])
  if (facts.length !== 980 || hints.length !== 980 || changes.length !== 980) {
    throw new Error(`Expected 980 facts, hints and workspace changes; found ${facts.length}, ${hints.length}, ${changes.length}`)
  }
  if (changes.some((change) => change.mode !== 'city')) throw new Error('Workspace contains non-city changes')

  const factById = new Map(facts.map((item) => [item.cardId ?? item.entityKey, item]))
  const hintById = new Map(hints.map((item) => [item.cardId ?? item.entityKey, item]))
  const prepared = changes.map((change) => {
    const factItem = factById.get(change.itemId)
    const hintItem = hintById.get(change.itemId)
    const fact = strings(record(factItem?.proposedJson).facts)[0] ?? ''
    const plotHint = text(record(hintItem?.proposedJson).plotHint)
    if (!factItem || !hintItem || !fact || !plotHint) throw new Error(`Missing enrichment for ${change.itemId}`)
    if (fact.length < 80 || fact.length > 210) throw new Error(`Fact length is invalid for ${change.itemId}: ${fact.length}`)
    const payload = {
      ...record(change.afterPayload),
      ...sourceCorrections[change.itemId],
      id: change.itemId,
      mode: 'city',
      plotHint,
      facts: [fact],
    }
    const errors = validateContentPayload(payload, 'city').filter((issue) => issue.level === 'error')
    if (errors.length) throw new Error(`Content validation failed for ${change.itemId}: ${JSON.stringify(errors)}`)
    const changedFields = [...new Set([
      ...change.changedFields,
      'plotHint',
      'facts',
      ...Object.keys(sourceCorrections[change.itemId] ?? {}),
    ])].sort()
    return { change, factItem, payload, changedFields, issues: validateContentPayload(payload, 'city') }
  })

  await db.transaction(async (tx) => {
    for (const batch of Array.from({ length: Math.ceil(prepared.length / 40) }, (_, index) => prepared.slice(index * 40, index * 40 + 40))) {
      await Promise.all(batch.map(async ({ change, factItem, payload, changedFields, issues }) => {
        await tx.update(contentWorkspaceChanges).set({
          afterPayload: payload,
          changedFields,
          validationIssues: issues,
          version: sql`${contentWorkspaceChanges.version} + 1`,
          updatedAt: new Date(),
        }).where(eq(contentWorkspaceChanges.id, change.id))
        await tx.update(pipelineRunItems).set({
          status: 'staged',
          fieldDecisionsJson: { facts: { action: 'accept' } },
          approvedBy: admin.id,
          approvedAt: new Date(),
          workspaceChangeId: change.id,
          errorCode: null,
          safeErrorMessage: null,
          updatedAt: new Date(),
        }).where(eq(pipelineRunItems.id, factItem.id))
      }))
    }
    await tx.update(pipelineRuns).set({ status: 'staged' }).where(inArray(pipelineRuns.id, [factsRunId, hintsRunId]))
    await tx.update(contentWorkspaces).set({ version: sql`${contentWorkspaces.version} + 1`, updatedAt: new Date() }).where(eq(contentWorkspaces.id, workspace.id))
  })

  const built = await buildWorkspaceRevision(db, admin, workspace.id, requestId)
  const activated = await activateWorkspaceRevision(db, admin, workspace.id, requestId)
  await db.transaction(async (tx) => {
    await tx.update(pipelineRunItems).set({
      status: 'published',
      appliedRevisionId: activated.revision.id,
      updatedAt: new Date(),
    }).where(inArray(pipelineRunItems.runId, [factsRunId, hintsRunId]))
    await tx.update(pipelineRuns).set({ status: 'published', finishedAt: new Date() }).where(inArray(pipelineRuns.id, [factsRunId, hintsRunId]))
  })

  const completeness = (await db.select({
    total: sql<number>`count(*)::int`,
    withHints: sql<number>`count(*) filter (where nullif(trim(${contentItemVersions.payload}->>'plotHint'), '') is not null)::int`,
    withFacts: sql<number>`count(*) filter (where jsonb_array_length(coalesce(${contentItemVersions.payload}->'facts', '[]'::jsonb)) > 0)::int`,
  }).from(contentItemVersions).where(and(
    eq(contentItemVersions.revisionId, activated.revision.id),
    eq(contentItemVersions.mode, 'city'),
  )))[0]
  if (!completeness || completeness.total !== 980 || completeness.withHints !== 980 || completeness.withFacts !== 980) {
    throw new Error(`Published revision is incomplete: ${JSON.stringify(completeness)}`)
  }
  console.log(JSON.stringify({ built, revisionId: activated.revision.id, completeness }, null, 2))
} finally {
  await client.end()
}
