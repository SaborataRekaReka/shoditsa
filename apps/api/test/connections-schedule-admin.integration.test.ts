import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { eq, inArray } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { auditLog, connectionsSchedule, contentItems, contentItemVersions, contentRevisions, createDatabase, user } from '@shoditsa/database'
import { assertSchedulableVersions } from '../src/modules/connections/schedule-admin.js'
import { registerConnectionsAdminRoutes } from '../src/modules/connections/admin-routes.js'
import { sendError } from '../src/lib/errors.js'

const actor = vi.hoisted(() => ({ id: crypto.randomUUID() }))
vi.mock('../src/modules/auth/session.js', async (importOriginal) => ({
  ...await importOriginal<object>(), requireAdmin: async () => actor,
}))

describe('Connections schedule history guards (isolated PostgreSQL)', () => {
  let database: ReturnType<typeof createDatabase> | undefined
  const app = Fastify()
  const revisionIds = [crypto.randomUUID(), crypto.randomUUID()]
  const itemIds = Array.from({ length: 4 }, () => `connections:schedule-qa-${crypto.randomUUID()}`)
  const versionIds = Array.from({ length: 5 }, () => crypto.randomUUID())
  const futureDates = ['2098-05-01', '2098-05-02']
  beforeAll(async () => {
    const config = loadConfig()
    if (config.production || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.databaseUrl).hostname)) {
      throw new Error('Schedule integration tests require a local non-production PostgreSQL database')
    }
    database = createDatabase(config)
    await database.db.insert(user).values({ id: actor.id, name: 'Schedule QA', email: `${actor.id}@example.test` })
    await database.db.insert(contentRevisions).values(revisionIds.map((id, index) => ({ id, version: id, checksumSha256: id, sourceManifest: {}, status: index ? 'retired' : 'active' })))
    await database.db.insert(contentItems).values(itemIds.map((id) => ({ id, mode: 'connections' as const })))
    await database.db.insert(contentItemVersions).values(versionIds.map((id, index) => ({
      id, itemId: itemIds[index === 4 ? 0 : index], revisionId: revisionIds[index === 4 ? 1 : 0], mode: 'connections' as const,
      titleRu: 'Synthetic schedule fixture', normalizedTitle: id, popularityScore: 1, sortOrder: index,
      contentStatus: 'ready', allowedInGame: true, payload: {},
    })))
    await database.db.insert(connectionsSchedule).values([
      { puzzleDate: '2098-04-01', itemVersionId: versionIds[4], cancelledAt: new Date() },
      { puzzleDate: futureDates[0], itemVersionId: versionIds[1] },
      { puzzleDate: futureDates[1], itemVersionId: versionIds[2] },
    ])
    registerConnectionsAdminRoutes(app, { db: database.db, auth: {} as never, config })
    app.setErrorHandler((error, request, reply) => sendError(request, reply, error))
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
    if (!database) return
    try {
      await database.db.delete(auditLog).where(eq(auditLog.actorUserId, actor.id))
      await database.db.delete(connectionsSchedule).where(inArray(connectionsSchedule.itemVersionId, versionIds))
      await database.db.delete(contentItemVersions).where(inArray(contentItemVersions.id, versionIds))
      await database.db.delete(contentItems).where(inArray(contentItems.id, itemIds))
      await database.db.delete(contentRevisions).where(inArray(contentRevisions.id, revisionIds))
      await database.db.delete(user).where(eq(user.id, actor.id))
    } finally { await database.client.end() }
  })
  it('rejects a new version of an item assigned in a retired revision, even after cancellation', async () => {
    await expect(assertSchedulableVersions(database!.db, [versionIds[0]])).rejects.toMatchObject({ code: 'CONNECTIONS_SCHEDULE_ROUND_ALREADY_USED' })
    await expect(assertSchedulableVersions(database!.db, [versionIds[1]])).rejects.toMatchObject({ code: 'CONNECTIONS_SCHEDULE_ROUND_ALREADY_USED' })
  })
  it('accepts an unused ready active item, but rejects duplicated IDs and retired versions', async () => {
    await expect(assertSchedulableVersions(database!.db, [versionIds[3]])).resolves.toHaveLength(1)
    await expect(assertSchedulableVersions(database!.db, [versionIds[3], versionIds[3]])).rejects.toMatchObject({ code: 'CONNECTIONS_SCHEDULE_DUPLICATE_VERSION' })
    await expect(assertSchedulableVersions(database!.db, [versionIds[4]])).rejects.toMatchObject({ code: 'CONNECTIONS_SCHEDULE_VERSION_INVALID' })
  })
  it('exposes scheduledEver by item identity rather than the visible calendar range or version', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/connections/rounds' })
    expect(response.statusCode).toBe(200)
    const items = response.json().items
    expect(items.find((row: { itemVersionId: string }) => row.itemVersionId === versionIds[0])).toMatchObject({ scheduledEver: true })
    expect(items.find((row: { itemVersionId: string }) => row.itemVersionId === versionIds[3])).toMatchObject({ scheduledEver: false })
  })
  it('keeps same-day same-version PUT idempotent and rejects reuse on a new date', async () => {
    const unchanged = await app.inject({ method: 'PUT', url: `/api/v1/admin/connections/schedule/${futureDates[0]}`, payload: { itemVersionId: versionIds[1] } })
    expect(unchanged.statusCode).toBe(200)
    expect(unchanged.json()).toMatchObject({ puzzleDate: futureDates[0], itemVersionId: versionIds[1] })
    const reused = await app.inject({ method: 'PUT', url: '/api/v1/admin/connections/schedule/2098-05-03', payload: { itemVersionId: versionIds[0] } })
    expect(reused.statusCode).toBe(409)
    expect(reused.json().error.code).toBe('CONNECTIONS_SCHEDULE_ROUND_ALREADY_USED')
  })
  it('keeps explicit future-date swapping available without treating it as a new assignment', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/connections/schedule/swap', payload: { firstDate: futureDates[0], secondDate: futureDates[1], reason: 'Synthetic schedule swap test' } })
    expect(response.statusCode).toBe(200)
    expect(response.json().items.map((row: { itemVersionId: string }) => row.itemVersionId)).toEqual([versionIds[2], versionIds[1]])
  })
  it('serializes concurrent bulk requests so one unused round cannot be assigned twice', async () => {
    const responses = await Promise.all(['2098-05-04', '2098-05-05'].map((startDate) => app.inject({
      method: 'POST', url: '/api/v1/admin/connections/schedule/bulk', payload: { startDate, itemVersionIds: [versionIds[3]] },
    })))
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409])
    expect(responses.find((response) => response.statusCode === 409)!.json().error.code).toBe('CONNECTIONS_SCHEDULE_ROUND_ALREADY_USED')
    expect(await database!.db.select().from(connectionsSchedule).where(eq(connectionsSchedule.itemVersionId, versionIds[3]))).toHaveLength(1)
  })
})
