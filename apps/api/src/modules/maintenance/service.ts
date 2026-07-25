import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import {
  auditLog,
  backgroundJobs,
  contentQualityIssues,
  contentRevisions,
  danetkiInvites,
  danetkiSessionState,
  friendsRooms,
  gameSessions,
  pipelineRuns,
  type Database,
} from '@shoditsa/database'

const hoursBefore = (now: Date, hours: number) => new Date(now.getTime() - hours * 60 * 60_000)
const daysBefore = (now: Date, days: number) => hoursBefore(now, days * 24)

export const runGameLifecycleCleanup = async (db: Database, now = new Date(), dryRun = false) => {
  const catalogCutoff = hoursBefore(now, 48).toISOString()
  const packCutoff = daysBefore(now, 7).toISOString()
  const danetkiCutoff = hoursBefore(now, 1).toISOString()
  const sessionCandidates = Array.from(await db.execute(sql`
    select sessions.id, sessions.mode::text, sessions.kind
    from game_sessions sessions
    where sessions.status = 'playing'
      and (
        (
          sessions.mode <> 'danetki'
          and (
            (sessions.kind <> 'pack' and sessions."updatedAt" < ${catalogCutoff}::timestamptz)
            or (sessions.kind = 'pack' and sessions."updatedAt" < ${packCutoff}::timestamptz)
          )
        )
        or (
          sessions.mode = 'danetki'
          and sessions."updatedAt" < ${danetkiCutoff}::timestamptz
          and not exists (
            select 1
            from danetki_session_members members
            where members.session_id = sessions.id
              and members.left_at is null
              and members.last_seen_at >= ${danetkiCutoff}::timestamptz
          )
        )
      )
    order by sessions."updatedAt"
    limit 1000
  `) as Iterable<{ id: string; mode: string; kind: string }>)

  const roomCandidates = Array.from(await db.execute(sql`
    select id, phase::text
    from friends_rooms
    where phase <> 'finished'
      and (
        (phase in ('lobby', 'results') and updated_at < ${hoursBefore(now, 2).toISOString()}::timestamptz)
        or (phase in ('countdown', 'active') and coalesce(phase_ends_at, updated_at) < ${hoursBefore(now, 1).toISOString()}::timestamptz)
      )
    order by updated_at
    limit 1000
  `) as Iterable<{ id: string; phase: string }>)

  if (!dryRun) {
    const sessionIds = sessionCandidates.map((entry) => entry.id)
    if (sessionIds.length) {
      await db.transaction(async (tx) => {
        await tx.update(gameSessions).set({ status: 'expired', completedAt: now, updatedAt: now }).where(and(
          inArray(gameSessions.id, sessionIds),
          eq(gameSessions.status, 'playing'),
        ))
        await Promise.all([
          tx.update(danetkiSessionState).set({ aiStatus: 'idle', updatedAt: now })
            .where(inArray(danetkiSessionState.sessionId, sessionIds)),
          tx.update(danetkiInvites).set({ revokedAt: now }).where(inArray(danetkiInvites.sessionId, sessionIds)),
        ])
      })
    }
    const roomIds = roomCandidates.map((entry) => entry.id)
    if (roomIds.length) {
      await db.update(friendsRooms).set({
        phase: 'finished',
        phaseEndsAt: null,
        closedAt: now,
        updatedAt: now,
        version: sql`${friendsRooms.version} + 1`,
      }).where(inArray(friendsRooms.id, roomIds))
    }
  }

  return {
    dryRun,
    sessions: {
      count: sessionCandidates.length,
      byMode: Object.fromEntries([...new Set(sessionCandidates.map((entry) => entry.mode))].map((mode) => [
        mode,
        sessionCandidates.filter((entry) => entry.mode === mode).length,
      ])),
      ids: sessionCandidates.map((entry) => entry.id),
    },
    friendsRooms: {
      count: roomCandidates.length,
      ids: roomCandidates.map((entry) => entry.id),
    },
  }
}

type RevisionCandidate = { id: string; status: string; created_at: Date; item_count: number }

const revisionCandidates = async (db: Database, now: Date) => Array.from(await db.execute(sql`
  select revisions.id, revisions.status, revisions."createdAt" as created_at,
         (select count(*)::int from content_item_versions versions where versions.revision_id = revisions.id) as item_count
  from content_revisions revisions
  where (
      (revisions.status = 'ready' and revisions."createdAt" < ${daysBefore(now, 7).toISOString()}::timestamptz)
      or (revisions.status = 'retired' and revisions."createdAt" < ${daysBefore(now, 180).toISOString()}::timestamptz)
    )
    and not exists (select 1 from content_workspaces workspaces where workspaces.base_revision_id = revisions.id or workspaces.built_revision_id = revisions.id)
    and not exists (select 1 from daily_challenges challenges where challenges.revision_id = revisions.id)
    and not exists (select 1 from game_sessions sessions where sessions.revision_id = revisions.id)
    and not exists (select 1 from friends_rooms rooms where rooms.revision_id = revisions.id)
    and not exists (select 1 from pipeline_run_items items where items.applied_revision_id = revisions.id)
  order by revisions."createdAt"
  limit 50
`) as Iterable<RevisionCandidate>)

export const runContentRetention = async (db: Database, now = new Date(), dryRun = false) => {
  const revisions = await revisionCandidates(db, now)
  const terminalJobCutoff = daysBefore(now, 90)
  const terminalPipelineCutoff = daysBefore(now, 90)
  const resolvedQualityCutoff = daysBefore(now, 30)
  const auditCutoff = daysBefore(now, 365)
  const terminalJobCutoffIso = terminalJobCutoff.toISOString()
  const terminalPipelineCutoffIso = terminalPipelineCutoff.toISOString()
  const resolvedQualityCutoffIso = resolvedQualityCutoff.toISOString()
  const auditCutoffIso = auditCutoff.toISOString()

  const scalarCount = async (query: ReturnType<typeof sql>) => Number(
    Array.from(await db.execute(query) as Iterable<{ value: number }>)[0]?.value ?? 0,
  )
  const counts = {
    revisions: revisions.length,
    revisionItems: revisions.reduce((sum, revision) => sum + Number(revision.item_count), 0),
    backgroundJobs: await scalarCount(sql`
      select count(*)::int value from background_jobs
      where status in ('completed','failed','cancelled') and "createdAt" < ${terminalJobCutoffIso}::timestamptz
    `),
    pipelineRuns: await scalarCount(sql`
      select count(*)::int value from pipeline_runs
      where status not in ('queued','running') and "createdAt" < ${terminalPipelineCutoffIso}::timestamptz
    `),
    qualityIssues: await scalarCount(sql`
      select count(*)::int value from content_quality_issues
      where status = 'resolved' and resolved_at < ${resolvedQualityCutoffIso}::timestamptz
    `),
    auditRows: await scalarCount(sql`
      select count(*)::int value from audit_log where "createdAt" < ${auditCutoffIso}::timestamptz
    `),
  }

  if (!dryRun) {
    await db.transaction(async (tx) => {
      const revisionIds = revisions.map((revision) => revision.id)
      if (revisionIds.length) await tx.delete(contentRevisions).where(inArray(contentRevisions.id, revisionIds))
      await tx.delete(contentQualityIssues).where(and(
        eq(contentQualityIssues.status, 'resolved'),
        lt(contentQualityIssues.resolvedAt, resolvedQualityCutoff),
      ))
      await tx.delete(backgroundJobs).where(and(
        sql`${backgroundJobs.status} in ('completed','failed','cancelled')`,
        lt(backgroundJobs.createdAt, terminalJobCutoff),
      ))
      await tx.delete(pipelineRuns).where(and(
        sql`${pipelineRuns.status} not in ('queued','running')`,
        lt(pipelineRuns.createdAt, terminalPipelineCutoff),
      ))
      await tx.delete(auditLog).where(lt(auditLog.createdAt, auditCutoff))
    })
  }

  return {
    dryRun,
    counts,
    revisionIds: revisions.map((revision) => revision.id),
  }
}
