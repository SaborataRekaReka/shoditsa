import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '@shoditsa/config'
import type { DanetkiPayload } from '@shoditsa/contracts'
import {
  appSettings, auditLog, backgroundJobs, contentItemVersions, danetkiAiCalls, danetkiInvites,
  danetkiMessages, danetkiSessionMembers, danetkiSessionState, gameSessions, type Database,
} from '@shoditsa/database'
import type { Auth } from '../auth/auth.js'
import { requireAdmin } from '../auth/session.js'
import { ApiError } from '../../lib/errors.js'
import { loadIntegrationEnvironment } from '../admin/integration-secrets.js'
import { requestDanetkiAnswer } from './ai.js'
import { toPublicDanetka } from './service.js'

type Deps = { db: Database; auth: Auth; config: AppConfig }
const idParams = Type.Object({ sessionId: Type.String({ format: 'uuid' }) }, { additionalProperties: false })
const settingsBody = Type.Object({
  enabled: Type.Boolean(),
  multiplayerEnabled: Type.Boolean(),
  hostModel: Type.String({ minLength: 1, maxLength: 120 }),
  promptVersion: Type.String({ minLength: 1, maxLength: 120 }),
  contextMessages: Type.Integer({ minimum: 10, maximum: 100 }),
  maxOutputTokens: Type.Integer({ minimum: 100, maximum: 2_000 }),
  timeoutMs: Type.Integer({ minimum: 3_000, maximum: 60_000 }),
  retryCount: Type.Integer({ minimum: 0, maximum: 3 }),
  userCooldownMs: Type.Integer({ minimum: 500, maximum: 30_000 }),
  roomQuestionsPerMinute: Type.Integer({ minimum: 1, maximum: 120 }),
  emptyRoomTtlMinutes: Type.Integer({ minimum: 1, maximum: 10_080 }),
}, { additionalProperties: false })
type SettingsBody = {
  enabled: boolean; multiplayerEnabled: boolean; hostModel: string; promptVersion: string; contextMessages: number
  maxOutputTokens: number; timeoutMs: number; retryCount: number; userCooldownMs: number; roomQuestionsPerMinute: number; emptyRoomTtlMinutes: number
}
const defaults: SettingsBody = {
  enabled: false, multiplayerEnabled: true, hostModel: 'gpt-5-mini', promptVersion: 'danetki-host-v1', contextMessages: 30,
  maxOutputTokens: 800, timeoutMs: 20_000, retryCount: 1, userCooldownMs: 2_000, roomQuestionsPerMinute: 20, emptyRoomTtlMinutes: 60,
}
const keys: Record<keyof SettingsBody, string> = {
  enabled: 'danetki.enabled', multiplayerEnabled: 'danetki.multiplayerEnabled', hostModel: 'danetki.hostModel', promptVersion: 'danetki.promptVersion',
  contextMessages: 'danetki.contextMessages', maxOutputTokens: 'danetki.maxOutputTokens', timeoutMs: 'danetki.timeoutMs', retryCount: 'danetki.retryCount',
  userCooldownMs: 'danetki.userCooldownMs', roomQuestionsPerMinute: 'danetki.roomQuestionsPerMinute', emptyRoomTtlMinutes: 'danetki.emptyRoomTtlMinutes',
}

const loadSettings = async (db: Database): Promise<SettingsBody> => {
  const rows = await db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(inArray(appSettings.key, Object.values(keys)))
  const values = new Map(rows.map((row) => [row.key, row.value]))
  return Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, values.has(key) ? values.get(key) : defaults[name as keyof SettingsBody]])) as SettingsBody
}

export const registerDanetkiAdminRoutes = (app: FastifyInstance, deps: Deps) => {
  const admin = async (request: Parameters<typeof requireAdmin>[0], reply: { header: (name: string, value: string) => unknown }) => {
    reply.header('Cache-Control', 'no-store')
    return requireAdmin(request, deps.auth, deps.db, deps.config)
  }

  app.get('/api/v1/admin/danetki/settings', async (request, reply) => {
    await admin(request, reply)
    const environment = await loadIntegrationEnvironment(deps.db, deps.config)
    return { settings: await loadSettings(deps.db), openAiConfigured: Boolean(environment.OPENAI_API_KEY) }
  })

  app.put('/api/v1/admin/danetki/settings', { schema: { body: settingsBody } }, async (request, reply) => {
    const actor = await admin(request, reply)
    const body = request.body as SettingsBody
    const before = await loadSettings(deps.db)
    await deps.db.transaction(async (tx) => {
      for (const [name, key] of Object.entries(keys)) {
        const value = body[name as keyof SettingsBody]
        await tx.insert(appSettings).values({ key, value, updatedBy: actor.id }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: actor.id, updatedAt: new Date(), version: sql`${appSettings.version} + 1` } })
      }
      await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'danetki.settings.update', entityType: 'app_settings', entityId: 'danetki', before, after: body, requestId: request.id })
    })
    return { settings: await loadSettings(deps.db) }
  })

  app.get('/api/v1/admin/danetki/sessions', async (request, reply) => {
    await admin(request, reply)
    const items = await deps.db.select({
      id: gameSessions.id, status: gameSessions.status, puzzleDate: gameSessions.puzzleDate, startedAt: gameSessions.startedAt, completedAt: gameSessions.completedAt,
      title: contentItemVersions.titleRu, roomMode: danetkiSessionState.roomMode, questionCount: danetkiSessionState.questionCount,
      hintLevel: danetkiSessionState.hintLevel, aiStatus: danetkiSessionState.aiStatus,
      participants: sql<number>`(select count(*)::int from danetki_session_members m where m.session_id = ${gameSessions.id} and m.left_at is null)`,
      lastLatencyMs: sql<number | null>`(select latency_ms from danetki_ai_calls c where c.session_id = ${gameSessions.id} order by c.created_at desc limit 1)`,
      lastError: sql<string | null>`(select error_code from danetki_ai_calls c where c.session_id = ${gameSessions.id} and c.status = 'error' order by c.created_at desc limit 1)`,
    }).from(gameSessions).innerJoin(danetkiSessionState, eq(danetkiSessionState.sessionId, gameSessions.id))
      .innerJoin(contentItemVersions, eq(contentItemVersions.id, gameSessions.answerItemVersionId))
      .where(eq(gameSessions.mode, 'danetki')).orderBy(desc(gameSessions.startedAt)).limit(200)
    return { items }
  })

  app.get('/api/v1/admin/danetki/sessions/:sessionId', { schema: { params: idParams } }, async (request, reply) => {
    await admin(request, reply)
    const sessionId = (request.params as { sessionId: string }).sessionId
    const room = await deps.db.select({ session: gameSessions, state: danetkiSessionState, title: contentItemVersions.titleRu })
      .from(gameSessions).innerJoin(danetkiSessionState, eq(danetkiSessionState.sessionId, gameSessions.id))
      .innerJoin(contentItemVersions, eq(contentItemVersions.id, gameSessions.answerItemVersionId))
      .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.mode, 'danetki'))).limit(1)
    if (!room[0]) throw new ApiError(404, 'DANETKI_SESSION_NOT_FOUND', 'Комната не найдена')
    const [members, messages, aiCalls, jobs] = await Promise.all([
      deps.db.select().from(danetkiSessionMembers).where(eq(danetkiSessionMembers.sessionId, sessionId)).orderBy(asc(danetkiSessionMembers.joinedAt)),
      deps.db.select().from(danetkiMessages).where(eq(danetkiMessages.sessionId, sessionId)).orderBy(asc(danetkiMessages.seq)),
      deps.db.select().from(danetkiAiCalls).where(eq(danetkiAiCalls.sessionId, sessionId)).orderBy(desc(danetkiAiCalls.createdAt)).limit(100),
      deps.db.select().from(backgroundJobs).where(sql`${backgroundJobs.payload}->>'sessionId' = ${sessionId}`).orderBy(desc(backgroundJobs.createdAt)).limit(100),
    ])
    return { ...room[0], members, messages, aiCalls, jobs }
  })

  app.post('/api/v1/admin/danetki/sessions/:sessionId/retry-ai', { schema: { params: idParams } }, async (request, reply) => {
    const actor = await admin(request, reply)
    const sessionId = (request.params as { sessionId: string }).sessionId
    const failed = await deps.db.select().from(backgroundJobs).where(and(
      eq(backgroundJobs.status, 'failed'), inArray(backgroundJobs.type, ['danetki_ai_reply', 'danetki_guess_evaluate']),
      sql`${backgroundJobs.payload}->>'sessionId' = ${sessionId}`,
    )).orderBy(desc(backgroundJobs.createdAt)).limit(1)
    if (!failed[0]) throw new ApiError(409, 'DANETKI_AI_JOB_NOT_RETRYABLE', 'В комнате нет упавшей AI-задачи')
    const job = (await deps.db.insert(backgroundJobs).values({
      type: failed[0].type, idempotencyKey: `danetki:admin-retry:${failed[0].id}:${randomUUID()}`, createdBy: actor.id,
      payload: { ...(failed[0].payload as Record<string, unknown>), retryOf: failed[0].id },
    }).returning())[0]
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'danetki.ai.retry', entityType: 'game_session', entityId: sessionId, before: { jobId: failed[0].id }, after: { jobId: job.id }, requestId: request.id })
    return reply.code(202).send({ job })
  })

  app.post('/api/v1/admin/danetki/sessions/:sessionId/force-close', { schema: { params: idParams, body: Type.Object({ reason: Type.String({ minLength: 5, maxLength: 500 }) }, { additionalProperties: false }) } }, async (request, reply) => {
    const actor = await admin(request, reply)
    const sessionId = (request.params as { sessionId: string }).sessionId
    const reason = (request.body as { reason: string }).reason.trim()
    const result = await deps.db.transaction(async (tx) => {
      const rows = await tx.select({ session: gameSessions, state: danetkiSessionState }).from(gameSessions).innerJoin(danetkiSessionState, eq(danetkiSessionState.sessionId, gameSessions.id)).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.mode, 'danetki'))).for('update').limit(1)
      if (!rows[0]) throw new ApiError(404, 'DANETKI_SESSION_NOT_FOUND', 'Комната не найдена')
      const before = rows[0].session
      if (before.status === 'playing') {
        const now = new Date()
        await tx.insert(danetkiMessages).values({ sessionId, seq: rows[0].state.nextMessageSeq, senderKind: 'system', messageType: 'event', text: 'Комната закрыта администратором.' })
        await Promise.all([
          tx.update(gameSessions).set({ status: 'lost', completedAt: now, updatedAt: now }).where(eq(gameSessions.id, sessionId)),
          tx.update(danetkiSessionState).set({ nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`, aiStatus: 'idle', updatedAt: now }).where(eq(danetkiSessionState.sessionId, sessionId)),
          tx.update(danetkiInvites).set({ revokedAt: now }).where(and(eq(danetkiInvites.sessionId, sessionId), isNull(danetkiInvites.revokedAt))),
        ])
      }
      await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'danetki.session.force_close', entityType: 'game_session', entityId: sessionId, before, after: { status: 'lost' }, reason, requestId: request.id })
      return { closed: before.status === 'playing' }
    })
    return result
  })

  app.post('/api/v1/admin/danetki/ai-test', { schema: { body: Type.Object({ itemVersionId: Type.Optional(Type.String({ format: 'uuid' })), question: Type.String({ minLength: 2, maxLength: 300 }) }, { additionalProperties: false }) } }, async (request, reply) => {
    await admin(request, reply)
    const body = request.body as { itemVersionId?: string; question: string }
    const settings = await loadSettings(deps.db)
    const environment = await loadIntegrationEnvironment(deps.db, deps.config)
    if (!environment.OPENAI_API_KEY) throw new ApiError(409, 'OPENAI_API_KEY_REQUIRED', 'OpenAI API key не настроен')
    const puzzleRows = body.itemVersionId
      ? await deps.db.select().from(contentItemVersions).where(and(eq(contentItemVersions.id, body.itemVersionId), eq(contentItemVersions.mode, 'danetki'))).limit(1)
      : await deps.db.select().from(contentItemVersions).where(and(eq(contentItemVersions.mode, 'danetki'), eq(contentItemVersions.allowedInGame, true))).orderBy(desc(contentItemVersions.createdAt)).limit(1)
    if (!puzzleRows[0]) throw new ApiError(404, 'DANETKI_TEST_PUZZLE_NOT_FOUND', 'Тестовая данетка не найдена')
    toPublicDanetka(puzzleRows[0].payload)
    const result = await requestDanetkiAnswer({
      apiKey: environment.OPENAI_API_KEY, proxyUrl: environment.MUSIC_OUTBOUND_PROXY_URL, model: settings.hostModel,
      promptVersion: settings.promptVersion, puzzle: puzzleRows[0].payload as DanetkiPayload, question: body.question,
      revealedFactIds: [], summary: '', messages: [], timeoutMs: settings.timeoutMs, retryCount: settings.retryCount, maxOutputTokens: settings.maxOutputTokens,
    })
    return { result: result.value, latencyMs: result.latencyMs, usage: result.usage, responseId: result.responseId, model: settings.hostModel }
  })
}
