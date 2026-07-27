import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { Type } from '@sinclair/typebox'
import type { AppConfig } from '@shoditsa/config'
import type { ConnectionsRoundPayload } from '@shoditsa/contracts'
import {
  appSettings,
  auditLog,
  connectionsGuesses,
  connectionsHintChoices,
  connectionsSchedule,
  connectionsSessionState,
  contentReports,
  contentItemVersions,
  contentRevisions,
  contentWorkspaceChanges,
  gameSessions,
  type Database,
} from '@shoditsa/database'
import { validateConnectionsRound } from '@shoditsa/game-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Auth } from '../auth/auth.js'
import { requireAdmin } from '../auth/session.js'
import { ApiError } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import { getOrCreateWorkspace, saveWorkspaceItem } from '../admin/content-service.js'

type Deps = { db: Database; auth: Auth; config: AppConfig }
type SourceDocument = { version?: unknown; locale?: unknown; rounds?: unknown }
type SourceRound = Record<string, unknown> & { id?: unknown }

const dateSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
const admin = async (request: FastifyRequest, reply: FastifyReply, deps: Deps) => {
  reply.header('Cache-Control', 'no-store')
  return requireAdmin(request, deps.auth, deps.db, deps.config)
}
const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
)
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const previewImport = (input: unknown) => {
  const document = asRecord(input) as SourceDocument
  if (document.version !== 1) throw new ApiError(422, 'CONNECTIONS_IMPORT_VERSION_INVALID', 'Поддерживается только версия 1')
  const locale = typeof document.locale === 'string' ? document.locale.trim() : ''
  if (!locale) throw new ApiError(422, 'CONNECTIONS_IMPORT_LOCALE_REQUIRED', 'В файле не указана локаль')
  if (!Array.isArray(document.rounds) || !document.rounds.length) {
    throw new ApiError(422, 'CONNECTIONS_IMPORT_ROUNDS_REQUIRED', 'В файле нет раундов')
  }
  const seen = new Set<string>()
  const items = document.rounds.map((raw, index) => {
    const round = asRecord(raw) as SourceRound
    const externalId = typeof round.id === 'string' ? round.id.trim() : ''
    const id = externalId ? `connections:${externalId.replace(/^connections:/, '')}` : `connections:invalid-${index + 1}`
    const payload = {
      ...round,
      id,
      externalId,
      mode: 'connections',
      titleRu: `Связи — ${externalId || index + 1}`,
      titleOriginal: '',
      alternativeTitles: [],
      schemaVersion: 1,
      locale,
      contentStatus: 'review',
      allowedInGame: false,
      popularityScore: 0,
    } as unknown as ConnectionsRoundPayload
    const issues = validateConnectionsRound(payload)
    if (!externalId) issues.unshift({ severity: 'error', code: 'round.id_required', path: 'id', message: 'Укажите ID раунда' })
    if (seen.has(id)) issues.unshift({ severity: 'error', code: 'round.id_duplicate', path: 'id', message: 'ID раунда повторяется в файле' })
    seen.add(id)
    return {
      index,
      id,
      externalId,
      title: payload.titleRu,
      payload,
      issues,
      valid: !issues.some((issue) => issue.severity === 'error'),
    }
  })
  return {
    version: 1,
    locale,
    summary: {
      total: items.length,
      valid: items.filter((item) => item.valid).length,
      invalid: items.filter((item) => !item.valid).length,
      warnings: items.reduce((sum, item) => sum + item.issues.filter((issue) => issue.severity === 'warning').length, 0),
    },
    items,
  }
}

const assertSchedulableVersions = async (db: Database, itemVersionIds: string[]) => {
  const uniqueIds = [...new Set(itemVersionIds)]
  const versions = await db.select({
    id: contentItemVersions.id,
    itemId: contentItemVersions.itemId,
    titleRu: contentItemVersions.titleRu,
  }).from(contentItemVersions)
    .innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
    .where(and(
      inArray(contentItemVersions.id, uniqueIds),
      eq(contentItemVersions.mode, 'connections'),
      eq(contentItemVersions.allowedInGame, true),
      eq(contentItemVersions.contentStatus, 'ready'),
      eq(contentRevisions.status, 'active'),
    ))
  if (versions.length !== uniqueIds.length) {
    throw new ApiError(422, 'CONNECTIONS_SCHEDULE_VERSION_INVALID', 'Расписание принимает только готовые версии из active revision')
  }
  return versions
}

export const registerConnectionsAdminRoutes = (app: FastifyInstance, deps: Deps) => {
  app.get('/api/v1/admin/connections/rounds', async (request, reply) => {
    await admin(request, reply, deps)
    const rows = await deps.db.select({
      itemVersionId: contentItemVersions.id,
      itemId: contentItemVersions.itemId,
      titleRu: contentItemVersions.titleRu,
      contentStatus: contentItemVersions.contentStatus,
      allowedInGame: contentItemVersions.allowedInGame,
      payload: contentItemVersions.payload,
    }).from(contentItemVersions)
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
      .where(and(eq(contentItemVersions.mode, 'connections'), eq(contentRevisions.status, 'active')))
      .orderBy(asc(contentItemVersions.sortOrder))
    return {
      items: rows.map((row) => ({
        ...row,
        issues: validateConnectionsRound(row.payload),
      })),
    }
  })

  app.post('/api/v1/admin/connections/import/preview', {
    schema: { body: Type.Object({
      version: Type.Integer(),
      locale: Type.String(),
      rounds: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 500 }),
    }, { additionalProperties: false }) },
  }, async (request, reply) => {
    await admin(request, reply, deps)
    return previewImport(request.body)
  })

  app.post('/api/v1/admin/connections/import/apply', {
    schema: { body: Type.Object({
      document: Type.Object({
        version: Type.Integer(),
        locale: Type.String(),
        rounds: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 500 }),
      }, { additionalProperties: false }),
      reason: Type.String({ minLength: 3, maxLength: 500 }),
    }, { additionalProperties: false }) },
  }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const body = request.body as { document: unknown; reason: string }
    const preview = previewImport(body.document)
    if (preview.summary.invalid) {
      throw new ApiError(422, 'CONNECTIONS_IMPORT_INVALID', 'Сначала исправьте ошибки файла', {
        items: preview.items.filter((item) => !item.valid).map((item) => ({ id: item.id, issues: item.issues })),
      })
    }
    const workspace = await getOrCreateWorkspace(deps.db, actor)
    const drafts = await deps.db.select({
      itemId: contentWorkspaceChanges.itemId,
      version: contentWorkspaceChanges.version,
    }).from(contentWorkspaceChanges).where(and(
      eq(contentWorkspaceChanges.workspaceId, workspace.id),
      inArray(contentWorkspaceChanges.itemId, preview.items.map((item) => item.id)),
    ))
    const draftVersion = new Map(drafts.map((draft) => [draft.itemId, draft.version]))
    const results = []
    for (const item of preview.items) {
      const staged = await saveWorkspaceItem(deps.db, actor, item.id, {
        mode: 'connections',
        payload: item.payload as unknown as Record<string, unknown>,
        expectedVersion: draftVersion.get(item.id) ?? 0,
        source: 'import',
        reason: body.reason,
      }, request.id)
      results.push({ id: item.id, workspaceChangeId: staged.id, version: staged.version })
    }
    return { summary: { staged: results.length }, results, workspaceId: workspace.id }
  })

  app.get('/api/v1/admin/connections/schedule', {
    schema: { querystring: Type.Object({
      from: Type.Optional(dateSchema),
      to: Type.Optional(dateSchema),
    }, { additionalProperties: false }) },
  }, async (request, reply) => {
    await admin(request, reply, deps)
    const query = request.query as { from?: string; to?: string }
    const filters = [
      ...(query.from ? [gte(connectionsSchedule.puzzleDate, query.from)] : []),
      ...(query.to ? [lte(connectionsSchedule.puzzleDate, query.to)] : []),
    ]
    const items = await deps.db.select({
      puzzleDate: connectionsSchedule.puzzleDate,
      itemVersionId: connectionsSchedule.itemVersionId,
      itemId: contentItemVersions.itemId,
      titleRu: contentItemVersions.titleRu,
      cancelledAt: connectionsSchedule.cancelledAt,
      updatedAt: connectionsSchedule.updatedAt,
    }).from(connectionsSchedule)
      .innerJoin(contentItemVersions, eq(contentItemVersions.id, connectionsSchedule.itemVersionId))
      .where(and(...filters))
      .orderBy(asc(connectionsSchedule.puzzleDate))
    return { items }
  })

  app.put('/api/v1/admin/connections/schedule/:date', {
    schema: {
      params: Type.Object({ date: dateSchema }, { additionalProperties: false }),
      body: Type.Object({
        itemVersionId: Type.String({ format: 'uuid' }),
        reason: Type.Optional(Type.String({ minLength: 3, maxLength: 500 })),
      }, { additionalProperties: false }),
    },
  }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const { date } = request.params as { date: string }
    const body = request.body as { itemVersionId: string; reason?: string }
    if (date < getMoscowDate()) throw new ApiError(409, 'CONNECTIONS_SCHEDULE_PUBLISHED', 'Прошедший день нельзя изменить')
    await assertSchedulableVersions(deps.db, [body.itemVersionId])
    const before = (await deps.db.select().from(connectionsSchedule)
      .where(eq(connectionsSchedule.puzzleDate, date)).limit(1))[0] ?? null
    if (before && date <= getMoscowDate()) {
      throw new ApiError(409, 'CONNECTIONS_SCHEDULE_PUBLISHED', 'Опубликованный день нельзя изменить')
    }
    const after = before
      ? (await deps.db.update(connectionsSchedule).set({
          itemVersionId: body.itemVersionId,
          scheduledBy: actor.id,
          cancelledAt: null,
          updatedAt: new Date(),
        }).where(eq(connectionsSchedule.puzzleDate, date)).returning())[0]
      : (await deps.db.insert(connectionsSchedule).values({
          puzzleDate: date,
          itemVersionId: body.itemVersionId,
          scheduledBy: actor.id,
        }).returning())[0]
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'connections.schedule.put',
      entityType: 'connections_schedule',
      entityId: date,
      before,
      after,
      reason: body.reason,
      requestId: request.id,
    })
    return after
  })

  app.delete('/api/v1/admin/connections/schedule/:date', {
    schema: {
      params: Type.Object({ date: dateSchema }, { additionalProperties: false }),
      body: Type.Optional(Type.Object({
        reason: Type.String({ minLength: 3, maxLength: 500 }),
      }, { additionalProperties: false })),
    },
  }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const { date } = request.params as { date: string }
    if (date <= getMoscowDate()) throw new ApiError(409, 'CONNECTIONS_SCHEDULE_PUBLISHED', 'Опубликованный день нельзя отменить')
    const before = (await deps.db.select().from(connectionsSchedule)
      .where(eq(connectionsSchedule.puzzleDate, date)).limit(1))[0]
    if (!before) throw new ApiError(404, 'CONNECTIONS_SCHEDULE_NOT_FOUND', 'День не найден в расписании')
    const after = (await deps.db.update(connectionsSchedule).set({
      cancelledAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(connectionsSchedule.puzzleDate, date)).returning())[0]
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'connections.schedule.cancel',
      entityType: 'connections_schedule',
      entityId: date,
      before,
      after,
      reason: (request.body as { reason?: string } | undefined)?.reason,
      requestId: request.id,
    })
    return after
  })

  app.post('/api/v1/admin/connections/schedule/bulk', {
    schema: { body: Type.Object({
      startDate: dateSchema,
      itemVersionIds: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 365 }),
      reason: Type.Optional(Type.String({ minLength: 3, maxLength: 500 })),
    }, { additionalProperties: false }) },
  }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const body = request.body as { startDate: string; itemVersionIds: string[]; reason?: string }
    if (body.startDate < getMoscowDate()) {
      throw new ApiError(409, 'CONNECTIONS_SCHEDULE_PUBLISHED', 'Массовое расписание нельзя начинать в прошлом')
    }
    if (new Set(body.itemVersionIds).size !== body.itemVersionIds.length) {
      throw new ApiError(422, 'CONNECTIONS_SCHEDULE_DUPLICATE_VERSION', 'Один раунд нельзя поставить на несколько дней')
    }
    await assertSchedulableVersions(deps.db, body.itemVersionIds)
    const dates = body.itemVersionIds.map((_, index) => addDays(body.startDate, index))
    const conflicts = await deps.db.select().from(connectionsSchedule).where(inArray(connectionsSchedule.puzzleDate, dates))
    if (conflicts.length) throw new ApiError(409, 'CONNECTIONS_SCHEDULE_CONFLICT', 'Часть дней уже занята', { dates: conflicts.map((entry) => entry.puzzleDate) })
    const items = await deps.db.transaction(async (tx) => tx.insert(connectionsSchedule).values(
      body.itemVersionIds.map((itemVersionId, index) => ({
        puzzleDate: dates[index],
        itemVersionId,
        scheduledBy: actor.id,
      })),
    ).returning())
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'connections.schedule.bulk',
      entityType: 'connections_schedule',
      entityId: `${dates[0]}:${dates.at(-1)}`,
      before: null,
      after: { dates, itemVersionIds: body.itemVersionIds },
      reason: body.reason,
      requestId: request.id,
    })
    return { items }
  })

  app.post('/api/v1/admin/connections/schedule/swap', {
    schema: { body: Type.Object({
      firstDate: dateSchema,
      secondDate: dateSchema,
      reason: Type.String({ minLength: 3, maxLength: 500 }),
    }, { additionalProperties: false }) },
  }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const body = request.body as { firstDate: string; secondDate: string; reason: string }
    if (body.firstDate <= getMoscowDate() || body.secondDate <= getMoscowDate()) {
      throw new ApiError(409, 'CONNECTIONS_SCHEDULE_PUBLISHED', 'Можно менять местами только будущие дни')
    }
    const before = await deps.db.select().from(connectionsSchedule)
      .where(and(inArray(connectionsSchedule.puzzleDate, [body.firstDate, body.secondDate]), isNull(connectionsSchedule.cancelledAt)))
    if (before.length !== 2) throw new ApiError(404, 'CONNECTIONS_SCHEDULE_NOT_FOUND', 'Оба дня должны быть активны в расписании')
    const byDate = new Map(before.map((entry) => [entry.puzzleDate, entry]))
    await deps.db.transaction(async (tx) => {
      await tx.delete(connectionsSchedule).where(inArray(connectionsSchedule.puzzleDate, [body.firstDate, body.secondDate]))
      await tx.insert(connectionsSchedule).values([
        {
          puzzleDate: body.firstDate,
          itemVersionId: byDate.get(body.secondDate)!.itemVersionId,
          scheduledBy: actor.id,
        },
        {
          puzzleDate: body.secondDate,
          itemVersionId: byDate.get(body.firstDate)!.itemVersionId,
          scheduledBy: actor.id,
        },
      ])
    })
    const after = await deps.db.select().from(connectionsSchedule)
      .where(inArray(connectionsSchedule.puzzleDate, [body.firstDate, body.secondDate]))
      .orderBy(asc(connectionsSchedule.puzzleDate))
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'connections.schedule.swap',
      entityType: 'connections_schedule',
      entityId: `${body.firstDate}:${body.secondDate}`,
      before,
      after,
      reason: body.reason,
      requestId: request.id,
    })
    return { items: after }
  })

  app.get('/api/v1/admin/connections/analytics', async (request, reply) => {
    await admin(request, reply, deps)
    const today = getMoscowDate()
    const [summary, outcomes, hints, future, reports] = await Promise.all([
      deps.db.select({
        played: sql<number>`count(*)::int`,
        averageMistakes: sql<number>`coalesce(avg(${connectionsSessionState.mistakesUsed}), 0)::float`,
        averageHints: sql<number>`coalesce(avg(${connectionsSessionState.hintsUsed}), 0)::float`,
      }).from(connectionsSessionState)
        .innerJoin(gameSessions, eq(gameSessions.id, connectionsSessionState.sessionId)),
      deps.db.select({
        status: gameSessions.status,
        count: sql<number>`count(*)::int`,
      }).from(gameSessions).where(eq(gameSessions.mode, 'connections')).groupBy(gameSessions.status),
      deps.db.select({
        checkpoint: connectionsHintChoices.checkpoint,
        count: sql<number>`count(*)::int`,
      }).from(connectionsHintChoices).groupBy(connectionsHintChoices.checkpoint),
      deps.db.select({ puzzleDate: connectionsSchedule.puzzleDate }).from(connectionsSchedule)
        .where(and(gte(connectionsSchedule.puzzleDate, today), isNull(connectionsSchedule.cancelledAt))),
      deps.db.select({ count: sql<number>`count(*)::int` }).from(contentReports)
        .where(and(
          eq(contentReports.mode, 'connections'),
          inArray(contentReports.status, ['open', 'in_progress']),
        )),
    ])
    const guesses = await deps.db.select({
      result: connectionsGuesses.result,
      count: sql<number>`count(*)::int`,
    }).from(connectionsGuesses).groupBy(connectionsGuesses.result)
    const launchSetting = (await deps.db.select({ value: appSettings.value }).from(appSettings)
      .where(eq(appSettings.key, 'connections_launch_date')).limit(1))[0]?.value ?? null
    const scheduledDates = new Set(future.map((row) => row.puzzleDate))
    let nearestGap = today
    for (let offset = 0; offset < 366 && scheduledDates.has(nearestGap); offset += 1) {
      nearestGap = addDays(today, 1 + offset)
    }
    return {
      ...summary[0],
      outcomes,
      hints,
      guesses,
      scheduledAhead: future.length,
      nearestGap,
      openReports: reports[0]?.count ?? 0,
      launchDate: launchSetting,
    }
  })
}
