import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { and, eq, inArray } from 'drizzle-orm'
import { loadConfig, type AppConfig } from '@shoditsa/config'
import {
  auditLog, clientEvents, contentItems, contentItemVersions, contentRevisions, contentWorkspaceChanges, contentWorkspaces,
  createDatabase, integrationSecrets, pipelineRunItems, pipelineRuns, playerProfiles, user,
} from '@shoditsa/database'
import { buildApp } from '../src/app.js'
import type { Auth } from '../src/modules/auth/auth.js'

type RequestUser = { id: string; email: string; name: string; isAnonymous: boolean }

describe('admin API guard, workspace and telemetry', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let database: ReturnType<typeof createDatabase>
  let config: AppConfig
  let currentUser: RequestUser
  let adminId = ''
  let adminCreated = false
  let adminProfileCreated = false
  let originalAdminRole: string | null = null
  let createdWorkspaceId: string | null = null
  let telemetryEventId: string | null = null
  let uploadedMediaFile: string | null = null
  let initialWorkspaceIds = new Set<string>()
  const bulkDecisionRunId = crypto.randomUUID()
  const bulkDecisionItemIds = [crypto.randomUUID(), crypto.randomUUID()]
  const failedDecisionItemId = crypto.randomUUID()
  const forgedAdminId = crypto.randomUUID()
  const draftItemId = `admin-integration-${crypto.randomUUID()}`
  const exchangeNewItemId = `exchange-integration-${crypto.randomUUID()}`

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET ||= 'admin-integration-secret-at-least-32-characters'
    process.env.BETTER_AUTH_URL ||= 'http://localhost:3001'
    process.env.TRUSTED_ORIGINS ||= 'http://localhost:5173'
    process.env.PROMO_CODE_PEPPER ||= 'admin-integration-pepper-at-least-32-characters'
    const loaded = loadConfig()
    database = createDatabase(loaded)
    const existingAdmin = await database.db.select().from(user).where(eq(user.email, 'breneize@yandex.ru')).limit(1)
    adminId = existingAdmin[0]?.id ?? crypto.randomUUID()
    if (!existingAdmin[0]) {
      adminCreated = true
      await database.db.insert(user).values({ id: adminId, name: 'Integration Admin', email: 'breneize@yandex.ru', emailVerified: true })
    }
    const existingProfile = await database.db.select().from(playerProfiles).where(eq(playerProfiles.userId, adminId)).limit(1)
    originalAdminRole = existingProfile[0]?.role ?? null
    if (!existingProfile[0]) {
      adminProfileCreated = true
      await database.db.insert(playerProfiles).values({ userId: adminId, role: 'admin' })
    } else if (existingProfile[0].role !== 'admin') {
      await database.db.update(playerProfiles).set({ role: 'admin' }).where(eq(playerProfiles.userId, adminId))
    }
    initialWorkspaceIds = new Set((await database.db.select({ id: contentWorkspaces.id }).from(contentWorkspaces)).map((entry) => entry.id))
    config = Object.freeze({
      ...loaded,
      logLevel: 'error',
      adminEmails: ['breneize@yandex.ru'],
      adminUserIds: [adminId],
    })
    await database.db.insert(user).values({ id: forgedAdminId, name: 'Forged Admin', email: `forged-${forgedAdminId}@example.test`, emailVerified: true })
    await database.db.insert(playerProfiles).values({ userId: forgedAdminId, role: 'admin' })
    currentUser = { id: adminId, email: 'breneize@yandex.ru', name: 'Integration Admin', isAnonymous: false }
    const auth = {
      api: { getSession: async () => ({ user: currentUser, session: {} }) },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    app = await buildApp({ config, db: database.db, auth })
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    if (database) {
      if (telemetryEventId) await database.db.delete(clientEvents).where(eq(clientEvents.eventId, telemetryEventId))
      await database.db.delete(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.actorUserId, adminId))
      await database.db.delete(auditLog).where(eq(auditLog.entityId, draftItemId))
      await database.db.delete(auditLog).where(and(eq(auditLog.actorUserId, adminId), inArray(auditLog.action, ['content.exchange.export', 'content.exchange.import'])))
      await database.db.delete(auditLog).where(eq(auditLog.entityId, 'OPENAI_API_KEY'))
      await database.db.delete(auditLog).where(eq(auditLog.entityId, 'MUSIC_OUTBOUND_PROXY_URL'))
      await database.db.delete(auditLog).where(inArray(auditLog.entityId, bulkDecisionItemIds))
      await database.db.delete(pipelineRuns).where(eq(pipelineRuns.id, bulkDecisionRunId))
      await database.db.delete(integrationSecrets).where(eq(integrationSecrets.key, 'OPENAI_API_KEY'))
      await database.db.delete(integrationSecrets).where(eq(integrationSecrets.key, 'MUSIC_OUTBOUND_PROXY_URL'))
      if (createdWorkspaceId) await database.db.delete(contentWorkspaces).where(eq(contentWorkspaces.id, createdWorkspaceId))
      await database.db.delete(contentItems).where(eq(contentItems.id, draftItemId))
      await database.db.delete(contentItems).where(eq(contentItems.id, exchangeNewItemId))
      if (uploadedMediaFile) await rm(uploadedMediaFile, { force: true })
      await database.db.delete(user).where(eq(user.id, forgedAdminId))
      if (adminCreated) {
        await database.db.delete(auditLog).where(eq(auditLog.actorUserId, adminId))
        await database.db.delete(user).where(eq(user.id, adminId))
      }
      else if (adminProfileCreated) await database.db.delete(playerProfiles).where(eq(playerProfiles.userId, adminId))
      else if (originalAdminRole && originalAdminRole !== 'admin') await database.db.update(playerProfiles).set({ role: originalAdminRole }).where(eq(playerProfiles.userId, adminId))
      await database.client.end()
    }
  })

  it('requires the exact UUID, email and database role combination', async () => {
    const allowed = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard' })
    expect(allowed.statusCode, allowed.body).toBe(200)
    expect(allowed.headers['cache-control']).toContain('no-store')
    const workspace = allowed.json().workspace as { id: string; createdBy: string }
    if (!initialWorkspaceIds.has(workspace.id)) createdWorkspaceId = workspace.id

    currentUser = { id: forgedAdminId, email: 'breneize@yandex.ru', name: 'Forged Admin', isAnonymous: false }
    const denied = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard' })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error.code).toBe('ADMIN_REQUIRED')
    currentUser = { id: adminId, email: 'breneize@yandex.ru', name: 'Integration Admin', isAnonymous: false }
  })

  it('keeps edits in a versioned workspace without changing the active revision', async () => {
    const payload = {
      id: draftItemId,
      mode: 'movie',
      titleRu: 'Интеграционная карточка',
      titleOriginal: 'Integration card',
      alternativeTitles: [],
      year: 2024,
      plotHint: 'Новая длинная подсказка, которая не раскрывает название ответа.',
      allowedInGame: false,
    }
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/content/workspace/items/${draftItemId}`,
      payload: { mode: 'movie', payload, expectedVersion: 0, reason: 'Интеграционная проверка' },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json()).toMatchObject({ itemId: draftItemId, version: 1, changeType: 'create' })

    const detail = await app.inject({ method: 'GET', url: `/api/v1/admin/content/items/${draftItemId}` })
    expect(detail.statusCode, detail.body).toBe(200)
    expect(detail.json().active).toBeNull()
    expect(detail.json().draft.afterPayload.titleRu).toBe('Интеграционная карточка')
    expect(await database.db.select().from(contentItemVersions).where(eq(contentItemVersions.itemId, draftItemId))).toEqual([])

    const image = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#2b060a' } }).png().toBuffer()
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/content/items/${draftItemId}/media`,
      payload: { fileName: 'cover.png', contentType: 'image/png', base64: image.toString('base64'), purpose: 'posterUrl' },
    })
    expect(uploaded.statusCode, uploaded.body).toBe(201)
    expect(uploaded.json()).toMatchObject({ width: 320, height: 180, purpose: 'posterUrl' })
    expect(uploaded.json().url).toMatch(/\/media\/admin\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/)
    uploadedMediaFile = join(resolve(config.mediaRoot), String(uploaded.json().url).split('/media/')[1])

    const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#000' } }).png().toBuffer()
    const rejectedMedia = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/content/items/${draftItemId}/media`,
      payload: { fileName: 'tiny.png', contentType: 'image/png', base64: tiny.toString('base64'), purpose: 'posterUrl' },
    })
    expect(rejectedMedia.statusCode).toBe(422)
    expect(rejectedMedia.json().error.code).toBe('MEDIA_RESOLUTION_TOO_SMALL')

    const conflict = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/content/workspace/items/${draftItemId}`,
      payload: { mode: 'movie', payload, expectedVersion: 0, reason: 'Проверка конфликта версий' },
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().error.code).toBe('WORKSPACE_VERSION_CONFLICT')

    const discarded = await app.inject({ method: 'DELETE', url: `/api/v1/admin/content/workspace/items/${draftItemId}` })
    expect(discarded.statusCode).toBe(200)
    expect(discarded.json()).toEqual({ discarded: true })
  })

  it('deduplicates client events and prevents self-blocking', async () => {
    telemetryEventId = crypto.randomUUID()
    const event = {
      eventId: telemetryEventId,
      eventName: 'page_view',
      occurredAt: new Date().toISOString(),
      route: '/admin',
      appVersion: 'integration',
      properties: { surface: 'admin', accessToken: 'must-not-be-stored' },
    }
    const first = await app.inject({ method: 'POST', url: '/api/v1/client-events/batch', payload: { events: [event] } })
    const replay = await app.inject({ method: 'POST', url: '/api/v1/client-events/batch', payload: { events: [event] } })
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json()).toEqual({ accepted: 1, duplicates: 0 })
    expect(replay.json()).toEqual({ accepted: 0, duplicates: 1 })
    const storedEvent = await database.db.select({ properties: clientEvents.properties }).from(clientEvents).where(eq(clientEvents.eventId, telemetryEventId)).limit(1)
    expect(storedEvent[0]?.properties).toEqual({ surface: 'admin' })

    const timeline = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/events?userId=${adminId}&from=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`,
    })
    expect(timeline.statusCode, timeline.body).toBe(200)
    expect(timeline.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'page_view', userId: adminId, sourceTable: 'client_events' }),
    ]))

    const selfBlock = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${adminId}/block`,
      payload: { reason: 'Проверка защиты', revokeSessions: false },
    })
    expect(selfBlock.statusCode).toBe(409)
    expect(selfBlock.json().error.code).toBe('ADMIN_SELF_ACTION_FORBIDDEN')
  })

  it('stores integration credentials as write-only encrypted values', async () => {
    const value = `sk-integration-${crypto.randomUUID()}`
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/admin/integrations/OPENAI_API_KEY', payload: { value, confirmation: true } })
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.body).not.toContain(value)
    expect(saved.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'OPENAI_API_KEY', configured: true, source: 'admin' })]))
    const stored = await database.db.select().from(integrationSecrets).where(eq(integrationSecrets.key, 'OPENAI_API_KEY')).limit(1)
    expect(stored[0]?.encryptedValue).not.toContain(value)
    expect(stored[0]?.lastFour).toBe(value.slice(-4))

    const listed = await app.inject({ method: 'GET', url: '/api/v1/admin/integrations' })
    expect(listed.body).not.toContain(value)
    const removed = await app.inject({ method: 'DELETE', url: '/api/v1/admin/integrations/OPENAI_API_KEY', payload: { confirmation: true } })
    expect(removed.statusCode, removed.body).toBe(200)

    const proxyValue = 'http://proxy-user:proxy-password@proxy.example:3128'
    const proxySaved = await app.inject({ method: 'PUT', url: '/api/v1/admin/integrations/MUSIC_OUTBOUND_PROXY_URL', payload: { value: proxyValue, confirmation: true } })
    expect(proxySaved.statusCode, proxySaved.body).toBe(200)
    expect(proxySaved.body).not.toContain(proxyValue)
    expect(proxySaved.body).not.toContain('proxy-password')
    expect(proxySaved.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'MUSIC_OUTBOUND_PROXY_URL', configured: true, source: 'admin' })]))
    const invalidProxy = await app.inject({ method: 'PUT', url: '/api/v1/admin/integrations/MUSIC_OUTBOUND_PROXY_URL', payload: { value: 'socks5://proxy.example:1080', confirmation: true } })
    expect(invalidProxy.statusCode, invalidProxy.body).toBe(422)
    expect(invalidProxy.json().error.code).toBe('MUSIC_PROXY_URL_INVALID')
    const proxyRemoved = await app.inject({ method: 'DELETE', url: '/api/v1/admin/integrations/MUSIC_OUTBOUND_PROXY_URL', payload: { confirmation: true } })
    expect(proxyRemoved.statusCode, proxyRemoved.body).toBe(200)
  })

  it('previews a manual artist list and removes normalized duplicates', async () => {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/admin/pipelines/music/manual/preview',
      payload: { artists: [{ artist: 'Test Artist' }, { artist: '  TEST—ARTIST  ' }, { artist: 'Другой артист', country: 'Россия' }] },
    })
    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().summary).toMatchObject({ total: 3, ready: 2, duplicates: 1 })
    expect(preview.json().items[1].status).toBe('duplicate_input')
  })

  it('previews a manual Kinopoisk list and removes duplicate IDs', async () => {
    const kinopoiskId = 999_999_991
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/admin/pipelines/movie/manual/preview',
      payload: { movies: [{ kinopoiskId }, { kinopoiskId, hint: 'дубликат' }] },
    })
    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().summary).toMatchObject({ total: 2, ready: 1, duplicates: 1 })
    expect(preview.json().items[1].status).toBe('duplicate_input')
  })

  it('previews a manual Shikimori list and removes duplicate IDs', async () => {
    const shikimoriId = 999_999_992
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/admin/pipelines/anime/manual/preview',
      payload: { anime: [{ shikimoriId }, { shikimoriId, hint: 'дубликат' }] },
    })
    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().summary).toMatchObject({ total: 2, ready: 1, duplicates: 1 })
    expect(preview.json().items[1].status).toBe('duplicate_input')
  })

  it('applies a bulk pipeline decision atomically in one request', async () => {
    await database.db.insert(pipelineRuns).values({
      id: bulkDecisionRunId,
      pipelineKey: 'normalization',
      pipelineVersion: 'integration-test',
      status: 'review_required',
      itemsTotal: bulkDecisionItemIds.length,
      itemsProcessed: bulkDecisionItemIds.length,
      itemsSucceeded: bulkDecisionItemIds.length,
      createdBy: adminId,
    })
    await database.db.insert(pipelineRunItems).values(bulkDecisionItemIds.map((id, index) => ({
      id,
      runId: bulkDecisionRunId,
      entityKey: `bulk-decision-${index}`,
      status: 'review_required',
      beforeJson: { title: `До ${index}`, unchanged: true },
      proposedJson: { title: `После ${index}`, unchanged: true },
      idempotencyKey: crypto.randomUUID(),
    })))

    const missingId = crypto.randomUUID()
    const rejectedAtomicAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/pipeline-runs/${bulkDecisionRunId}/items/decisions`,
      payload: { itemIds: [bulkDecisionItemIds[0], missingId], approved: true },
    })
    expect(rejectedAtomicAttempt.statusCode, rejectedAtomicAttempt.body).toBe(404)
    expect(rejectedAtomicAttempt.json().error).toMatchObject({ code: 'PIPELINE_ITEMS_NOT_FOUND', details: { missingItemIds: [missingId] } })
    expect((await database.db.select().from(pipelineRunItems).where(eq(pipelineRunItems.id, bulkDecisionItemIds[0])))[0].status).toBe('review_required')

    await database.db.insert(pipelineRunItems).values({
      id: failedDecisionItemId,
      runId: bulkDecisionRunId,
      entityKey: 'bulk-decision-failed',
      status: 'failed',
      proposedJson: null,
      idempotencyKey: crypto.randomUUID(),
      errorCode: 'PIPELINE_ITEM_MAPPING_FAILED',
      safeErrorMessage: 'Model failed',
    })
    const failedResultAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/pipeline-runs/${bulkDecisionRunId}/items/decisions`,
      payload: { itemIds: [bulkDecisionItemIds[0], failedDecisionItemId], approved: true },
    })
    expect(failedResultAttempt.statusCode, failedResultAttempt.body).toBe(409)
    expect(failedResultAttempt.json().error).toMatchObject({ code: 'PIPELINE_ITEM_NOT_DECIDABLE', details: { itemId: failedDecisionItemId, status: 'failed' } })
    expect((await database.db.select().from(pipelineRunItems).where(eq(pipelineRunItems.id, bulkDecisionItemIds[0])))[0].status).toBe('review_required')
    expect((await database.db.select().from(pipelineRunItems).where(eq(pipelineRunItems.id, failedDecisionItemId)))[0].status).toBe('failed')

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/pipeline-runs/${bulkDecisionRunId}/items/decisions`,
      payload: { itemIds: bulkDecisionItemIds, approved: true, note: 'Интеграционная массовая проверка' },
    })
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json()).toMatchObject({ success: 2, failed: 0, approved: true })
    const updated = await database.db.select().from(pipelineRunItems).where(inArray(pipelineRunItems.id, bulkDecisionItemIds))
    expect(updated).toHaveLength(2)
    expect(updated.every((item) => item.status === 'approved' && item.approvedBy === adminId)).toBe(true)
    expect(updated.every((item) => (item.fieldDecisionsJson as Record<string, { action: string }>).title?.action === 'accept')).toBe(true)
    const decisions = await database.db.select().from(auditLog).where(and(eq(auditLog.action, 'pipeline.item.decision'), inArray(auditLog.entityId, bulkDecisionItemIds)))
    expect(decisions).toHaveLength(2)
    expect(new Set(decisions.map((entry) => entry.requestId)).size).toBe(1)

    // Simulate a legacy-corrupted row that was marked approved without a model result.
    // Publication must reject the complete batch before touching the workspace.
    await database.db.update(pipelineRunItems).set({ status: 'approved' }).where(eq(pipelineRunItems.id, failedDecisionItemId))
    const changesBefore = await database.db.select({ id: contentWorkspaceChanges.id }).from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.actorUserId, adminId))
    const invalidPublish = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/pipeline-runs/${bulkDecisionRunId}/approve-to-workspace`,
      payload: { itemIds: [failedDecisionItemId] },
    })
    expect(invalidPublish.statusCode, invalidPublish.body).toBe(422)
    expect(invalidPublish.json().error).toMatchObject({ code: 'PIPELINE_ITEMS_INVALID', details: { invalidCount: 1 } })
    const changesAfter = await database.db.select({ id: contentWorkspaceChanges.id }).from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.actorUserId, adminId))
    expect(changesAfter).toHaveLength(changesBefore.length)
    await database.db.update(pipelineRunItems).set({ status: 'failed' }).where(eq(pipelineRunItems.id, failedDecisionItemId))
  })

  it('round-trips selected content fields and separates updates from new categorized cards', async () => {
    const source = (await database.db.select({ itemId: contentItemVersions.itemId, mode: contentItemVersions.mode, payload: contentItemVersions.payload })
      .from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
      .where(and(eq(contentRevisions.status, 'active'), eq(contentItemVersions.mode, 'movie'))).limit(1))[0]
    expect(source).toBeTruthy()
    const fields = ['titleRu', 'titleOriginal', 'alternativeTitles', 'allowedInGame', 'plotHint']
    const exported = await app.inject({ method: 'POST', url: '/api/v1/admin/content/exchange/export', payload: { itemIds: [source.itemId], fields } })
    expect(exported.statusCode, exported.body).toBe(200)
    const document = exported.json()
    expect(document).toMatchObject({ format: 'shoditsa-content-exchange', schemaVersion: 1, fields })
    expect(Object.keys(document.items[0].data).every((field) => fields.includes(field))).toBe(true)
    expect(document.items[0]).toMatchObject({ id: source.itemId, mode: source.mode })

    document.items[0].data.titleRu = `${String((source.payload as Record<string, unknown>).titleRu)} · exchange test`
    document.items.push({
      id: exchangeNewItemId,
      mode: source.mode,
      base: null,
      data: {
        titleRu: 'Новая карточка из обменного JSON', titleOriginal: '', alternativeTitles: [], allowedInGame: false,
        plotHint: 'Достаточно длинная тестовая подсказка без раскрытия названия ответа.',
      },
      unsetFields: [],
    })
    const preview = await app.inject({ method: 'POST', url: '/api/v1/admin/content/exchange/import/preview', payload: { document } })
    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().summary).toMatchObject({ total: 2, create: 1, update: 1, conflict: 0, invalid: 0 })
    expect(preview.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: source.itemId, mode: source.mode, status: 'update', changedFields: expect.arrayContaining(['titleRu']) }),
      expect.objectContaining({ id: exchangeNewItemId, mode: source.mode, status: 'create' }),
    ]))

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/admin/content/exchange/import/apply',
      payload: { document, previewHash: preview.json().previewHash, items: preview.json().items.map(({ id, mode }: { id: string; mode: string }) => ({ id, mode })), reason: 'Интеграционная проверка JSON-обмена', confirmation: true },
    })
    expect(applied.statusCode, applied.body).toBe(200)
    expect(applied.json().summary).toEqual({ requested: 2, staged: 2, failed: 0 })
    const staged = await database.db.select().from(contentWorkspaceChanges).where(inArray(contentWorkspaceChanges.itemId, [source.itemId, exchangeNewItemId]))
    expect(staged).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: source.itemId, mode: source.mode, changeType: 'update', source: 'import' }),
      expect.objectContaining({ itemId: exchangeNewItemId, mode: source.mode, changeType: 'create', source: 'import' }),
    ]))
  })
})
