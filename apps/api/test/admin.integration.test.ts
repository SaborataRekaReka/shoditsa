import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { loadConfig, type AppConfig } from '@shoditsa/config'
import {
  auditLog, clientEvents, contentItems, contentItemVersions, contentWorkspaceChanges, contentWorkspaces,
  createDatabase, playerProfiles, user,
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
  let initialWorkspaceIds = new Set<string>()
  const forgedAdminId = crypto.randomUUID()
  const draftItemId = `admin-integration-${crypto.randomUUID()}`

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
      if (createdWorkspaceId) await database.db.delete(contentWorkspaces).where(eq(contentWorkspaces.id, createdWorkspaceId))
      await database.db.delete(contentItems).where(eq(contentItems.id, draftItemId))
      await database.db.delete(user).where(eq(user.id, forgedAdminId))
      if (adminCreated) await database.db.delete(user).where(eq(user.id, adminId))
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
      properties: { surface: 'admin' },
    }
    const first = await app.inject({ method: 'POST', url: '/api/v1/client-events/batch', payload: { events: [event] } })
    const replay = await app.inject({ method: 'POST', url: '/api/v1/client-events/batch', payload: { events: [event] } })
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json()).toEqual({ accepted: 1, duplicates: 0 })
    expect(replay.json()).toEqual({ accepted: 0, duplicates: 1 })

    const selfBlock = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${adminId}/block`,
      payload: { reason: 'Проверка защиты', revokeSessions: false },
    })
    expect(selfBlock.statusCode).toBe(409)
    expect(selfBlock.json().error.code).toBe('ADMIN_SELF_ACTION_FORBIDDEN')
  })
})
