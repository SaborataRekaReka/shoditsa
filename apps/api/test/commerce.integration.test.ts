import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { loadConfig, type AppConfig } from '@shoditsa/config'
import { commerceProducts, createDatabase, gameSessions, paymentOrders, playerProfiles, user, userEntitlements, walletAccounts, walletLedger } from '@shoditsa/database'
import { buildApp } from '../src/app.js'
import type { Auth } from '../src/modules/auth/auth.js'

type RequestUser = { id: string; email: string; name: string; isAnonymous: boolean }

describe('commerce API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let database: ReturnType<typeof createDatabase>
  let config: AppConfig
  let currentUser: RequestUser
  const userId = crypto.randomUUID()
  const freeUserId = crypto.randomUUID()
  const testKey = 'commerce-integration-test-key'
  const webhookSecret = 'commerce-integration-webhook-secret'
  const orderIds: string[] = []

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET ||= 'commerce-integration-secret-at-least-32-characters'
    process.env.BETTER_AUTH_URL ||= 'http://localhost:3001'
    process.env.TRUSTED_ORIGINS ||= 'http://localhost:5173'
    process.env.PROMO_CODE_PEPPER ||= 'commerce-integration-pepper-at-least-32-characters'
    const loaded = loadConfig()
    config = Object.freeze({
      ...loaded,
      logLevel: 'error',
      metricsToken: testKey,
      commerce: { ...loaded.commerce, enabled: true, provider: 'stub', webhookSecret, archiveFirstDate: '2026-07-01', freeArchiveDays: 7 },
    })
    database = createDatabase(config)
    await database.db.insert(commerceProducts).values([
      { id: 'club_30d', kind: 'club', title: 'Клубный билет на 30 дней', description: '30 дней клуба', priceMinor: 19_900, currency: 'RUB', durationDays: 30, entitlementKey: 'club', sortOrder: 10 },
      { id: 'club_365d', kind: 'club', title: 'Годовой клубный билет', description: '365 дней клуба', priceMinor: 179_000, currency: 'RUB', durationDays: 365, entitlementKey: 'club', sortOrder: 20 },
    ]).onConflictDoNothing()
    await database.db.insert(user).values([
      { id: userId, name: 'Commerce User', email: `commerce-${userId}@example.test`, emailVerified: true },
      { id: freeUserId, name: 'Free User', email: `commerce-${freeUserId}@example.test`, emailVerified: true },
    ])
    await database.db.insert(playerProfiles).values([{ userId }, { userId: freeUserId }])
    await database.db.insert(walletAccounts).values([{ userId, balance: 500 }, { userId: freeUserId, balance: 500 }])
    currentUser = { id: userId, email: `commerce-${userId}@example.test`, name: 'Commerce User', isAnonymous: true }
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
      await database.db.delete(gameSessions).where(inArray(gameSessions.userId, [userId, freeUserId]))
      await database.db.delete(user).where(eq(user.id, userId))
      await database.db.delete(user).where(eq(user.id, freeUserId))
      await database.client.end()
    }
  })

  it('lets anyone read the server-priced catalog and rejects anonymous checkout', async () => {
    const catalog = await app.inject({ method: 'GET', url: '/api/v1/commerce/catalog' })
    expect(catalog.statusCode).toBe(200)
    expect(catalog.json()).toMatchObject({ enabled: true, currency: 'RUB' })
    expect(catalog.json().products).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'club_30d', priceMinor: 19_900 })]))
    const checkout = await app.inject({ method: 'POST', url: '/api/v1/commerce/checkout', headers: { 'idempotency-key': crypto.randomUUID() }, payload: { productId: 'club_30d', priceMinor: 1 } })
    expect(checkout.statusCode).toBe(400)
    const validBody = await app.inject({ method: 'POST', url: '/api/v1/commerce/checkout', headers: { 'idempotency-key': crypto.randomUUID() }, payload: { productId: 'club_30d', termsAccepted: true, offerVersion: '2026-07-20' } })
    expect(validBody.statusCode).toBe(403)
    expect(validBody.json().error.code).toBe('COMMERCE_ACCOUNT_REQUIRED')
  })

  it('blocks a direct old archive start before club access', async () => {
    currentUser.isAnonymous = false
    const response = await app.inject({ method: 'POST', url: '/api/v1/games/start', payload: { kind: 'archive', mode: 'movie', period: 'all', archiveDate: '2026-07-01' } })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('ARCHIVE_CLUB_REQUIRED')
  })

  it('creates one server-priced order per idempotency key and grants exactly one entitlement', async () => {
    const key = crypto.randomUUID()
    const first = await app.inject({ method: 'POST', url: '/api/v1/commerce/checkout', headers: { 'idempotency-key': key }, payload: { productId: 'club_30d', termsAccepted: true, offerVersion: '2026-07-20' } })
    const replay = await app.inject({ method: 'POST', url: '/api/v1/commerce/checkout', headers: { 'idempotency-key': key }, payload: { productId: 'club_30d', termsAccepted: true, offerVersion: '2026-07-20' } })
    expect(first.statusCode).toBe(200)
    expect(replay.json()).toEqual(first.json())
    expect(first.json().order.amountMinor).toBe(19_900)
    orderIds.push(first.json().order.id)
    const confirmed = await app.inject({ method: 'POST', url: `/api/v1/commerce/test/orders/${first.json().order.id}/confirm`, headers: { 'x-commerce-test-key': testKey } })
    const duplicate = await app.inject({ method: 'POST', url: `/api/v1/commerce/test/orders/${first.json().order.id}/confirm`, headers: { 'x-commerce-test-key': testKey } })
    expect(confirmed.statusCode).toBe(200)
    expect(duplicate.statusCode).toBe(200)
    const grants = await database.db.select().from(userEntitlements).where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.sourceId, first.json().order.id)))
    expect(grants).toHaveLength(1)
    expect(grants[0].endsAt!.getTime() - grants[0].startsAt.getTime()).toBe(30 * 86_400_000)
  })

  it('stacks a second club purchase after the existing end date', async () => {
    const checkout = await app.inject({ method: 'POST', url: '/api/v1/commerce/checkout', headers: { 'idempotency-key': crypto.randomUUID() }, payload: { productId: 'club_30d', termsAccepted: true, offerVersion: '2026-07-20' } })
    orderIds.push(checkout.json().order.id)
    await app.inject({ method: 'POST', url: `/api/v1/commerce/test/orders/${checkout.json().order.id}/confirm`, headers: { 'x-commerce-test-key': testKey } })
    const grants = await database.db.select().from(userEntitlements).where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.entitlementKey, 'club')))
    expect(grants).toHaveLength(2)
    const sorted = grants.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
    expect(sorted[1].startsAt.getTime()).toBe(sorted[0].endsAt!.getTime())
  })

  it('starts club free-play without changing balance or ledger', async () => {
    const beforeWallet = (await database.db.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)))[0]
    const beforeLedger = await database.db.select().from(walletLedger).where(eq(walletLedger.userId, userId))
    const response = await app.inject({ method: 'POST', url: '/api/v1/economy/free-play/start', headers: { 'idempotency-key': crypto.randomUUID() }, payload: { mode: 'movie', difficulty: null } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ cost: 0, ledgerId: null, accessSource: 'club', balanceAfter: beforeWallet.balance })
    expect((await database.db.select().from(walletLedger).where(eq(walletLedger.userId, userId))).length).toBe(beforeLedger.length)
  })

  it('keeps ordinary free-play ticket-backed', async () => {
    currentUser = { id: freeUserId, email: `commerce-${freeUserId}@example.test`, name: 'Free User', isAnonymous: false }
    const response = await app.inject({ method: 'POST', url: '/api/v1/economy/free-play/start', headers: { 'idempotency-key': crypto.randomUUID() }, payload: { mode: 'series', difficulty: null } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ cost: 60, accessSource: 'tickets', balanceAfter: 440 })
    expect(response.json().ledgerId).toEqual(expect.any(String))
    currentUser = { id: userId, email: `commerce-${userId}@example.test`, name: 'Commerce User', isAnonymous: false }
  })

  it('verifies refund webhooks and revokes only the matching grant', async () => {
    const order = (await database.db.select().from(paymentOrders).where(eq(paymentOrders.id, orderIds[0])).limit(1))[0]
    const payload = JSON.stringify({ eventId: crypto.randomUUID(), providerPaymentId: order.providerPaymentId, status: 'refunded' })
    const signature = createHmac('sha256', webhookSecret).update(Buffer.from(payload)).digest('hex')
    const first = await app.inject({ method: 'POST', url: '/api/v1/commerce/webhooks/stub', headers: { 'content-type': 'application/json', 'x-commerce-signature': signature }, payload })
    const duplicate = await app.inject({ method: 'POST', url: '/api/v1/commerce/webhooks/stub', headers: { 'content-type': 'application/json', 'x-commerce-signature': signature }, payload })
    expect(first.statusCode).toBe(200)
    expect(duplicate.statusCode).toBe(200)
    expect(duplicate.json()).toMatchObject({ duplicate: true })
    const revoked = (await database.db.select().from(userEntitlements).where(and(eq(userEntitlements.sourceType, 'order'), eq(userEntitlements.sourceId, order.id))))[0]
    expect(revoked.status).toBe('revoked')
    const other = (await database.db.select().from(userEntitlements).where(and(eq(userEntitlements.sourceType, 'order'), eq(userEntitlements.sourceId, orderIds[1]))))[0]
    expect(other.status).toBe('active')
  })
})
