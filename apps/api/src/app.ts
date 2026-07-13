import Fastify, { type FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { Type } from '@sinclair/typebox'
import { fromNodeHeaders } from 'better-auth/node'
import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import {
  AdminContentReviewDecisionSchema, AdminContentReviewParamsSchema, AdminContentReviewQuerySchema,
  AdminPromoCreateBodySchema, AdminPromoPatchBodySchema, AdminWalletAdjustmentBodySchema,
  ArchiveDateParamsSchema, ArchiveQuerySchema, AttemptBodySchema, CatalogSearchQuerySchema,
  ContentReportBodySchema, FreePlayBodySchema, GameStartBodySchema, HintChoiceBodySchema,
  LedgerQuerySchema, LegacyImportBodySchema, PeriodUnlockBodySchema, ProfilePatchSchema,
  PromoRedeemBodySchema, UuidSchema,
  type AdminContentReviewDecision, type AdminContentReviewQuery, type AdminPromoCreateBody,
  type AdminPromoPatchBody, type AdminWalletAdjustmentBody, type ArchiveQuery, type AttemptBody,
  type CatalogSearchQuery, type ContentReportBody, type FreePlayBody, type GameStartBody, type HintChoiceBody,
  type LedgerQuery, type PeriodUnlockBody, type ProfilePatch, type PromoRedeemBody,
} from '@shoditsa/contracts'
import {
  account, appSettings, auditLog, contentItemVersions, contentReports, contentReviewDecisions, contentRevisionModes, contentRevisions,
  createDatabase, gameSessions, playerProfiles, promoCodes, userModeStats, walletAccounts, walletLedger,
  type Database,
} from '@shoditsa/database'
import { createAuth, type Auth } from './modules/auth/auth.js'
import { getRequestUser, requireAdmin } from './modules/auth/session.js'
import { ApiError, requireIdempotencyKey, sendError } from './lib/errors.js'
import { getMoscowDate } from './lib/time.js'
import { chooseHint, getOwnedSession, publicCard, searchCatalog, startGame, submitAttempt } from './modules/games/service.js'
import { dashboard, ledgerPage, normalizePromoCode, promoHash, redeemPromo, startFreePlay, unlockPeriod } from './modules/economy/service.js'
import { importLegacy } from './modules/users/legacy-import.js'
import { registerAdminRoutes, registerClientEventRoutes } from './modules/admin/routes.js'

type BuildOptions = { config: AppConfig; db?: Database; auth?: Auth }

const paramsId = Type.Object({ sessionId: UuidSchema }, { additionalProperties: false })
const idempotencyHeaders = Type.Object({ 'idempotency-key': UuidSchema }, { additionalProperties: true })

const forwardAuthResponse = async (reply: FastifyReply, response: Response) => {
  reply.status(response.status)
  response.headers.forEach((value, key) => {
    if (key.toLocaleLowerCase('en-US') !== 'set-cookie') reply.header(key, value)
  })
  const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
  if (setCookies.length) reply.header('set-cookie', setCookies)
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : null
  return reply.send(body)
}

export const buildApp = async ({ config, db: providedDb, auth: providedAuth }: BuildOptions) => {
  const ownedDatabase = providedDb ? null : createDatabase(config)
  const db = providedDb ?? ownedDatabase!.db
  const auth = providedAuth ?? createAuth(config, db)
  const requestStarted = new WeakMap<object, number>()
  const requestMetrics = new Map<string, { count: number; errors: number; durationMs: number }>()
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password', 'req.body.code', 'res.headers.set-cookie'],
      base: { appVersion: config.appVersion, gitSha: config.gitSha },
    },
    trustProxy: true,
    bodyLimit: 256 * 1024,
    requestIdHeader: 'x-request-id',
  })

  await app.register(cors, { origin: config.trustedOrigins, credentials: true })
  await app.register(helmet, {
    contentSecurityPolicy: {
      reportOnly: !config.production,
      directives: {
        defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:'], scriptSrc: ["'self'", 'https://mc.yandex.ru', 'https://yandex.ru'],
        connectSrc: ["'self'", 'https://mc.yandex.ru'], frameAncestors: ["'self'", 'https://*.yandex.ru'],
      },
    },
    strictTransportSecurity: config.production ? { maxAge: 15552000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
  await app.register(rateLimit, {
    global: true,
    max: config.production ? 120 : 1000,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  })
  await app.register(swagger, { openapi: { info: { title: 'Сходится! API', version: '1.0.0' }, openapi: '3.1.0' } })
  if (!config.production) await app.register(swaggerUi, { routePrefix: '/api/docs' })

  app.addHook('onRequest', async (request, reply) => { reply.header('X-Request-Id', request.id) })
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/v1/admin/')) reply.header('Cache-Control', 'no-store')
  })
  app.addHook('onRequest', async (request) => { requestStarted.set(request, performance.now()) })
  app.addHook('onResponse', async (request, reply) => {
    const route = (request.routeOptions.url ?? request.url.split('?')[0]).replace(/:[^/]+/g, ':id')
    const current = requestMetrics.get(route) ?? { count: 0, errors: 0, durationMs: 0 }
    current.count += 1; current.errors += reply.statusCode >= 500 ? 1 : 0; current.durationMs += performance.now() - (requestStarted.get(request) ?? performance.now())
    requestMetrics.set(route, current)
  })
  app.setErrorHandler((error, request, reply) => sendError(request, reply, error))

  app.get('/api/v1/health/live', { schema: { response: { 200: Type.Object({ status: Type.Literal('ok') }) } } }, async () => ({ status: 'ok' as const }))
  app.get('/api/v1/health/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`)
      const active = await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
      if (!active[0]) return reply.status(503).send({ status: 'not-ready', checks: { database: true, activeContentRevision: false } })
      return { status: 'ok', checks: { database: true, activeContentRevision: true } }
    } catch { return reply.status(503).send({ status: 'not-ready', checks: { database: false, activeContentRevision: false } }) }
  })
  app.get('/api/v1/meta', async () => {
    const active = await db.select({ id: contentRevisions.id, version: contentRevisions.version }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
    const counts = active[0] ? await db.select({ mode: contentRevisionModes.mode, count: contentRevisionModes.itemsCount }).from(contentRevisionModes).where(eq(contentRevisionModes.revisionId, active[0].id)) : []
    const emailInfrastructureReady = Boolean(config.smtp.host && config.smtp.from)
    return {
      serverTime: new Date().toISOString(),
      moscowDate: getMoscowDate(),
      apiVersion: 'v1',
      rulesVersion: 1,
      activeRevision: active[0] ?? null,
      modes: counts,
      minimumFrontendVersion: '0.1.0',
      auth: {
        emailPassword: config.authEmailEnabled,
        emailVerification: config.authEmailEnabled && emailInfrastructureReady,
        passwordReset: config.authEmailEnabled && emailInfrastructureReady,
        yandex: config.authYandexEnabled,
      },
    }
  })
  app.get('/api/v1/metrics', async (request, reply) => {
    const authorization = request.headers.authorization
    if (!config.metricsToken || authorization !== `Bearer ${config.metricsToken}`) throw new ApiError(403, 'METRICS_FORBIDDEN', 'Метрики недоступны')
    const [active, completed, revision] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(gameSessions).where(eq(gameSessions.status, 'playing')),
      db.select({ count: sql<number>`count(*)::int` }).from(gameSessions).where(sql`${gameSessions.status} in ('won','lost')`),
      db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1),
    ])
    const lines = ['# TYPE shoditsa_http_requests_total counter']
    for (const [route, metric] of requestMetrics) {
      const label = route.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
      lines.push(`shoditsa_http_requests_total{route="${label}"} ${metric.count}`)
      lines.push(`shoditsa_http_errors_total{route="${label}"} ${metric.errors}`)
      lines.push(`shoditsa_http_duration_ms_sum{route="${label}"} ${metric.durationMs.toFixed(3)}`)
    }
    lines.push(`shoditsa_active_sessions ${active[0].count}`, `shoditsa_completed_games_total ${completed[0].count}`, `shoditsa_active_content_revision_info{revision="${revision[0]?.id ?? 'none'}"} 1`)
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(`${lines.join('\n')}\n`)
  })

  app.route({ method: ['GET', 'POST'], url: '/api/auth/*', handler: async (request, reply) => {
    const authPath = request.url.split('?')[0]
    if (!config.authEmailEnabled && /^\/api\/auth\/(sign-in|sign-up)\/email\/?$/i.test(authPath)) {
      throw new ApiError(503, 'AUTH_EMAIL_DISABLED', 'Вход по email временно отключен на этом окружении')
    }
    const url = new URL(request.url, config.authUrl)
    const response = await auth.handler(new Request(url, {
      method: request.method, headers: fromNodeHeaders(request.headers),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : JSON.stringify(request.body ?? {}),
    }))
    return forwardAuthResponse(reply, response)
  } })
  app.post('/api/v1/auth/guest', { config: { rateLimit: { max: config.production ? 10 : 100, timeWindow: '1 hour' } } }, async (request, reply) => {
    const existing = await getRequestUser(request, auth, db, false, config)
    if (existing) return existing
    const guestHeaders = fromNodeHeaders(request.headers)
    guestHeaders.set('content-type', 'application/json')
    const response = await auth.handler(new Request(new URL('/api/auth/sign-in/anonymous', config.authUrl), {
      method: 'POST', headers: guestHeaders, body: '{}',
    }))
    return forwardAuthResponse(reply, response)
  })

  app.get('/api/v1/me', async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    const [profile, linkedAccounts] = await Promise.all([
      db.select().from(playerProfiles).where(eq(playerProfiles.userId, user!.id)).limit(1),
      db.select({ providerId: account.providerId, password: account.password }).from(account).where(eq(account.userId, user!.id)),
    ])
    return {
      user,
      profile: profile[0],
      auth: {
        hasPassword: linkedAccounts.some((entry) => entry.providerId === 'credential' && Boolean(entry.password)),
        providers: [...new Set(linkedAccounts.map((entry) => entry.providerId))],
      },
    }
  })
  app.patch('/api/v1/me/profile', { schema: { body: ProfilePatchSchema } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    const body = request.body as ProfilePatch
    const rows = await db.update(playerProfiles).set({
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      ...(body.locale !== undefined ? { locale: body.locale } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}), updatedAt: new Date(),
    }).where(eq(playerProfiles.userId, user!.id)).returning()
    return rows[0]
  })
  app.post('/api/v1/me/legacy-import', { schema: { body: LegacyImportBodySchema }, config: { rateLimit: { max: 3, timeWindow: '1 day' } }, bodyLimit: 1024 * 1024 }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    if (user!.isAnonymous) throw new ApiError(403, 'LEGACY_IMPORT_ACCOUNT_REQUIRED', 'Сначала войдите в постоянный аккаунт')
    return importLegacy(db, config, user!.id, request.body as Record<string, unknown>)
  })
  app.delete('/api/v1/me', { schema: { body: Type.Object({ confirmation: Type.Literal('УДАЛИТЬ') }) } }, async (request, reply) => {
    await getRequestUser(request, auth, db, true, config)
    const headers = fromNodeHeaders(request.headers); headers.set('content-type', 'application/json')
    const response = await auth.handler(new Request(new URL('/api/auth/delete-user', config.authUrl), { method: 'POST', headers, body: '{}' }))
    return forwardAuthResponse(reply, response)
  })

  app.get('/api/v1/catalog/search', { schema: { querystring: CatalogSearchQuerySchema }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const query = request.query as CatalogSearchQuery
    const user = await getRequestUser(request, auth, db, false, config)
    return { items: await searchCatalog(db, query, user?.id) }
  })
  app.get('/api/v1/catalog/items/:itemId', { schema: { params: Type.Object({ itemId: Type.String({ minLength: 1 }) }) } }, async (request) => {
    const { itemId } = request.params as { itemId: string }
    const rows = await db.select({ payload: contentItemVersions.payload }).from(contentItemVersions)
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
      .where(and(eq(contentItemVersions.itemId, itemId), eq(contentRevisions.status, 'active'))).limit(1)
    if (!rows[0]) throw new ApiError(404, 'CONTENT_ITEM_NOT_FOUND', 'Карточка не найдена')
    return publicCard(rows[0].payload as never)
  })

  app.post('/api/v1/games/start', { schema: { body: GameStartBodySchema }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    return { session: await startGame(db, user!.id, request.body as GameStartBody, user!.authSessionId) }
  })
  app.get('/api/v1/games/:sessionId', { schema: { params: paramsId } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    return { session: await getOwnedSession(db, user!.id, (request.params as { sessionId: string }).sessionId) }
  })
  app.post('/api/v1/games/:sessionId/attempts', { schema: { params: paramsId, headers: idempotencyHeaders, body: AttemptBodySchema }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    return submitAttempt(db, user!.id, (request.params as { sessionId: string }).sessionId, (request.body as AttemptBody).itemId, requireIdempotencyKey(request))
  })
  app.post('/api/v1/games/:sessionId/hints', { schema: { params: paramsId, headers: idempotencyHeaders, body: HintChoiceBodySchema } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    const body = request.body as HintChoiceBody
    return chooseHint(db, user!.id, (request.params as { sessionId: string }).sessionId, body.checkpoint, body.hintKey, requireIdempotencyKey(request))
  })

  app.post('/api/v1/content-reports', { schema: { body: ContentReportBodySchema }, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    const body = request.body as ContentReportBody
    if (body.clientEventId) {
      const replay = await db.select({ id: contentReports.id, reason: contentReports.reason, createdAt: contentReports.createdAt })
        .from(contentReports).where(and(eq(contentReports.userId, user!.id), eq(contentReports.clientEventId, body.clientEventId))).limit(1)
      if (replay[0]) return replay[0]
    }
    const sessions = await db.select({
      id: gameSessions.id,
      mode: gameSessions.mode,
      itemId: contentItemVersions.itemId,
    }).from(gameSessions)
      .innerJoin(contentItemVersions, eq(contentItemVersions.id, gameSessions.answerItemVersionId))
      .where(and(eq(gameSessions.id, body.sessionId), eq(gameSessions.userId, user!.id)))
      .limit(1)
    if (!sessions[0]) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
    const rows = await db.insert(contentReports).values({
      userId: user!.id,
      sessionId: sessions[0].id,
      itemId: sessions[0].itemId,
      mode: sessions[0].mode,
      reason: body.reason,
      comment: body.comment?.trim() || null,
      clientEventId: body.clientEventId ?? null,
      appVersion: body.appVersion?.trim() || null,
      pageUrl: body.pageUrl ? (() => { try { const parsed = new URL(body.pageUrl, config.authUrl); return `${parsed.origin}${parsed.pathname}` } catch { return null } })() : null,
      clientErrorId: body.clientErrorId?.trim() || null,
      requestId: request.id,
    }).returning({ id: contentReports.id, reason: contentReports.reason, createdAt: contentReports.createdAt })
    return rows[0]
  })

  app.get('/api/v1/me/dashboard', async (request) => dashboard(db, (await getRequestUser(request, auth, db, true, config))!.id))
  app.get('/api/v1/me/stats', async (request) => ({ items: await db.select().from(userModeStats).where(eq(userModeStats.userId, (await getRequestUser(request, auth, db, true, config))!.id)) }))
  app.get('/api/v1/me/wallet', async (request) => ({ wallet: (await db.select().from(walletAccounts).where(eq(walletAccounts.userId, (await getRequestUser(request, auth, db, true, config))!.id)).limit(1))[0] ?? { balance: 0, lifetimeEarned: 0 } }))
  app.get('/api/v1/me/wallet/ledger', { schema: { querystring: LedgerQuerySchema } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config); const query = request.query as LedgerQuery
    return ledgerPage(db, user!.id, query.cursor, query.limit ?? 30)
  })
  app.get('/api/v1/me/entitlements', async (request) => ({ entitlements: (await dashboard(db, (await getRequestUser(request, auth, db, true, config))!.id)).entitlements }))
  app.post('/api/v1/economy/period-unlocks', { schema: { body: PeriodUnlockBodySchema, headers: idempotencyHeaders } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config); const body = request.body as PeriodUnlockBody
    return unlockPeriod(db, user!.id, body.mode, body.period, requireIdempotencyKey(request))
  })
  app.post('/api/v1/economy/free-play/start', { schema: { body: FreePlayBodySchema, headers: idempotencyHeaders } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config); const body = request.body as FreePlayBody
    return startFreePlay(db, user!.id, body.mode, body.difficulty ?? null, requireIdempotencyKey(request), user!.authSessionId)
  })
  app.post('/api/v1/promos/redeem', { schema: { body: PromoRedeemBodySchema, headers: idempotencyHeaders }, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    return redeemPromo(db, config, user!.id, (request.body as PromoRedeemBody).code, requireIdempotencyKey(request))
  })

  app.get('/api/v1/archive', { schema: { querystring: ArchiveQuerySchema } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config); const query = request.query as ArchiveQuery
    const limit = query.limit ?? 30
    const filters = [eq(gameSessions.userId, user!.id), sql`${gameSessions.status} <> 'playing'`]
    if (query.mode) filters.push(eq(gameSessions.mode, query.mode))
    if (query.cursor) filters.push(lt(gameSessions.completedAt, new Date(query.cursor)))
    const rows = await db.select({ id: gameSessions.id, mode: gameSessions.mode, period: gameSessions.period, difficulty: gameSessions.difficulty, puzzleDate: gameSessions.puzzleDate, status: gameSessions.status, attemptsCount: gameSessions.attemptsCount, completedAt: gameSessions.completedAt })
      .from(gameSessions).where(and(...filters)).orderBy(desc(gameSessions.completedAt)).limit(limit + 1)
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].completedAt?.toISOString() ?? null : null }
  })
  app.get('/api/v1/archive/:date/status', { schema: { params: ArchiveDateParamsSchema } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config); const { date } = request.params as { date: string }
    return { items: await db.select({ mode: gameSessions.mode, status: gameSessions.status, id: gameSessions.id }).from(gameSessions).where(and(eq(gameSessions.userId, user!.id), eq(gameSessions.puzzleDate, date))) }
  })

  await registerClientEventRoutes(app, { db, auth, config })
  await registerAdminRoutes(app, { db, auth, config })

  app.get('/api/v1/admin/content/revisions', async (request) => { await requireAdmin(request, auth, db, config); return { items: await db.select().from(contentRevisions).orderBy(desc(contentRevisions.createdAt)) } })
  app.post('/api/v1/admin/content/revisions/:id/activate', { schema: { params: Type.Object({ id: UuidSchema }), headers: idempotencyHeaders } }, async (request) => {
    const actor = await requireAdmin(request, auth, db, config); const id = (request.params as { id: string }).id
    await db.transaction(async (tx) => {
      const target = await tx.select().from(contentRevisions).where(eq(contentRevisions.id, id)).for('update').limit(1)
      if (!target[0] || !['ready', 'active'].includes(target[0].status)) throw new ApiError(422, 'REVISION_NOT_READY', 'Ревизия не готова к активации')
      await tx.update(contentRevisions).set({ status: 'retired' }).where(eq(contentRevisions.status, 'active'))
      await tx.update(contentRevisions).set({ status: 'active', activatedAt: new Date() }).where(eq(contentRevisions.id, id))
      await tx.insert(appSettings).values({ key: 'active_content_revision_id', value: id, updatedBy: actor.id }).onConflictDoUpdate({ target: appSettings.key, set: { value: id, updatedBy: actor.id, updatedAt: new Date(), version: sql`${appSettings.version} + 1` } })
      await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'content.revision.activate', entityType: 'content_revision', entityId: id, after: target[0], requestId: request.id })
    }); return { activated: id }
  })
  app.get('/api/v1/admin/settings/daily-salt', async (request) => { await requireAdmin(request, auth, db, config); return (await db.select().from(appSettings).where(eq(appSettings.key, 'daily_global_salt')).limit(1))[0] })
  app.put('/api/v1/admin/settings/daily-salt', { schema: { body: Type.Object({ currentValue: Type.Integer(), value: Type.Integer(), reason: Type.String({ minLength: 3, maxLength: 500 }) }, { additionalProperties: false }), headers: idempotencyHeaders } }, async (request) => {
    const actor = await requireAdmin(request, auth, db, config); const body = request.body as { currentValue: number; value: number; reason: string }; const value = body.value
    const before = await db.select().from(appSettings).where(eq(appSettings.key, 'daily_global_salt')).limit(1)
    if (Number(before[0]?.value ?? 0) !== body.currentValue) throw new ApiError(409, 'DAILY_SALT_CONFLICT', 'Текущее значение изменилось; обновите страницу')
    const updated = await db.insert(appSettings).values({ key: 'daily_global_salt', value, updatedBy: actor.id }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: actor.id, updatedAt: new Date(), version: sql`${appSettings.version} + 1` } }).returning()
    await db.insert(auditLog).values({ actorUserId: actor.id, action: 'settings.daily-salt.update', entityType: 'app_setting', entityId: 'daily_global_salt', before: before[0] ?? null, after: updated[0], reason: body.reason, requestId: request.id })
    return updated[0]
  })
  app.post('/api/v1/admin/promos', { schema: { headers: idempotencyHeaders, body: AdminPromoCreateBodySchema } }, async (request) => {
    const actor = await requireAdmin(request, auth, db, config); const body = request.body as AdminPromoCreateBody
    if (!body.code || normalizePromoCode(body.code) === 'СОСО') throw new ApiError(422, 'PROMO_CODE_INVALID', 'Недопустимый промокод')
    const rows = await db.insert(promoCodes).values({ codeHash: promoHash(body.code, config.promoPepper), title: body.title, rewardType: body.rewardType ?? 'tickets', rewardValue: body.rewardValue, perUserLimit: body.perUserLimit ?? 1, globalLimit: body.globalLimit ?? null, createdBy: actor.id }).returning()
    await db.insert(auditLog).values({ actorUserId: actor.id, action: 'promo.create', entityType: 'promo', entityId: rows[0].id, after: { ...rows[0], codeHash: '[redacted]' }, requestId: request.id })
    return { ...rows[0], codeHash: undefined }
  })
  app.patch('/api/v1/admin/promos/:id', { schema: { params: Type.Object({ id: UuidSchema }, { additionalProperties: false }), body: AdminPromoPatchBodySchema } }, async (request) => {
    const actor = await requireAdmin(request, auth, db, config); const id = (request.params as { id: string }).id; const body = request.body as AdminPromoPatchBody
    const rows = await db.update(promoCodes).set({ ...(body.enabled !== undefined ? { enabled: body.enabled } : {}), ...(body.endsAt !== undefined ? { endsAt: body.endsAt ? new Date(body.endsAt) : null } : {}) }).where(eq(promoCodes.id, id)).returning()
    if (!rows[0]) throw new ApiError(404, 'PROMO_NOT_FOUND', 'Промокод не найден')
    await db.insert(auditLog).values({ actorUserId: actor.id, action: 'promo.update', entityType: 'promo', entityId: id, after: { ...rows[0], codeHash: '[redacted]' }, requestId: request.id })
    return { ...rows[0], codeHash: undefined }
  })
  app.post('/api/v1/admin/wallet-adjustments', { schema: { headers: idempotencyHeaders, body: AdminWalletAdjustmentBodySchema } }, async (request) => {
    const actor = await requireAdmin(request, auth, db, config); const body = request.body as AdminWalletAdjustmentBody; const key = requireIdempotencyKey(request)
    return db.transaction(async (tx) => {
      await tx.insert(walletAccounts).values({ userId: body.userId }).onConflictDoNothing()
      const wallet = (await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, body.userId)).for('update').limit(1))[0]
      const balanceAfter = wallet.balance + Math.trunc(body.amount)
      if (balanceAfter < 0) throw new ApiError(409, 'INSUFFICIENT_TICKETS', 'Корректировка сделает баланс отрицательным')
      const ledger = await tx.insert(walletLedger).values({ userId: body.userId, operationKey: `admin-adjustment:${key}`, type: 'adjustment', reason: body.reason, amount: Math.trunc(body.amount), balanceAfter, metadata: { actor: actor.id } }).returning()
      await tx.update(walletAccounts).set({ balance: balanceAfter, lifetimeEarned: Math.max(wallet.lifetimeEarned, balanceAfter), version: sql`${walletAccounts.version} + 1`, updatedAt: new Date() }).where(eq(walletAccounts.userId, body.userId))
      await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'wallet.adjustment', entityType: 'wallet', entityId: body.userId, before: wallet, after: { balanceAfter, ledgerId: ledger[0].id }, requestId: request.id })
      return { ledger: ledger[0], balanceAfter }
    })
  })
  app.get('/api/v1/admin/content-review', { schema: { querystring: AdminContentReviewQuerySchema } }, async (request) => {
    await requireAdmin(request, auth, db, config)
    const query = request.query as AdminContentReviewQuery
    const active = await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
    if (!active[0]) throw new ApiError(503, 'CONTENT_NOT_READY', 'Активная ревизия контента не настроена')
    const limit = query.limit ?? 30
    const filters = [eq(contentItemVersions.revisionId, active[0].id)]
    if (query.mode) filters.push(eq(contentItemVersions.mode, query.mode))
    if (query.cursor) filters.push(gt(contentItemVersions.itemId, query.cursor))
    const candidates = await db.select({
      id: contentItemVersions.itemId,
      mode: contentItemVersions.mode,
      titleRu: contentItemVersions.titleRu,
      titleOriginal: contentItemVersions.titleOriginal,
      contentStatus: contentItemVersions.contentStatus,
      payload: contentItemVersions.payload,
    }).from(contentItemVersions).where(and(...filters)).orderBy(asc(contentItemVersions.itemId)).limit(limit + 1)
    const enriched = await Promise.all(candidates.slice(0, limit).map(async (item) => {
      const decisions = await db.select({
        field: contentReviewDecisions.field,
        decision: contentReviewDecisions.decision,
        reviewerUserId: contentReviewDecisions.reviewerUserId,
        updatedAt: contentReviewDecisions.updatedAt,
      }).from(contentReviewDecisions).where(eq(contentReviewDecisions.itemId, item.id))
      const payload = item.payload as Record<string, unknown>
      const reviewReasons = Array.isArray(payload.reviewReasons)
        ? payload.reviewReasons.filter((value): value is string => typeof value === 'string')
        : []
      return { ...item, payload, reviewReasons, decisions }
    }))
    const items = query.pendingOnly === false ? enriched : enriched.filter((item) => !item.decisions.some((decision) => decision.field === '__approval__'))
    return { items, nextCursor: candidates.length > limit ? candidates[limit - 1].id : null }
  })
  app.get('/api/v1/admin/content-review/:itemId', { schema: { params: Type.Object({ itemId: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false }) } }, async (request) => { await requireAdmin(request, auth, db, config); return { items: await db.select().from(contentReviewDecisions).where(eq(contentReviewDecisions.itemId, (request.params as { itemId: string }).itemId)) } })
  app.put('/api/v1/admin/content-review/:itemId/:field', { schema: { headers: idempotencyHeaders, params: AdminContentReviewParamsSchema, body: AdminContentReviewDecisionSchema } }, async (request) => {
    const actor = await requireAdmin(request, auth, db, config); const params = request.params as { itemId: string; field: string }
    const decision = request.body as AdminContentReviewDecision
    const rows = await db.insert(contentReviewDecisions).values({ itemId: params.itemId, field: params.field, decision, reviewerUserId: actor.id }).onConflictDoUpdate({ target: [contentReviewDecisions.itemId, contentReviewDecisions.field, contentReviewDecisions.reviewerUserId], set: { decision, updatedAt: new Date() } }).returning()
    await db.insert(auditLog).values({ actorUserId: actor.id, action: 'content.review', entityType: 'content_item', entityId: params.itemId, after: rows[0], requestId: request.id })
    return rows[0]
  })

  app.addHook('onClose', async () => { if (ownedDatabase) await ownedDatabase.client.end() })
  return app
}
