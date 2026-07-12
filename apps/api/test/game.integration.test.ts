import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '@shoditsa/config'
import { buildApp } from '../src/app.js'
import { createDatabase, periodEntitlements, promoCodes, user, walletAccounts, walletLedger } from '@shoditsa/database'
import { eq } from 'drizzle-orm'
import { mergeAnonymousAccount } from '../src/modules/auth/merge.js'
import { promoHash } from '../src/modules/economy/service.js'

describe('server-authoritative game API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let cookie = ''
  let guestUserId = ''
  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET ||= 'integration-secret-at-least-32-characters'
    process.env.BETTER_AUTH_URL ||= 'http://localhost:3001'
    process.env.TRUSTED_ORIGINS ||= 'http://localhost:5173'
    process.env.PROMO_CODE_PEPPER ||= 'integration-pepper-at-least-32-characters'
    process.env.AUTH_EMAIL_ENABLED = 'false'
    app = await buildApp({ config: loadConfig() })
    await app.ready()
    const guest = await app.inject({ method: 'POST', url: '/api/v1/auth/guest' })
    expect(guest.statusCode).toBe(200)
    const cookies = guest.headers['set-cookie']
    cookie = (Array.isArray(cookies) ? cookies : [cookies]).filter(Boolean).map((value) => String(value).split(';')[0]).join('; ')
    expect(cookie).toContain('shoditsa')
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })
    guestUserId = me.json().user.id
  })
  afterAll(async () => app?.close())

  it('starts concurrently without duplicate sessions and does not leak the answer', async () => {
    const body = { kind: 'daily', mode: 'movie', period: 'all', difficulty: null, archiveDate: null }
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/games/start', headers: { cookie }, payload: body }),
      app.inject({ method: 'POST', url: '/api/v1/games/start', headers: { cookie }, payload: body }),
    ])
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200)
    const a = first.json().session; const b = second.json().session
    expect(a.id).toBe(b.id)
    expect(JSON.stringify(a)).not.toMatch(/answerId|answerItemVersionId|knownAnswer|"answer"/)
  })

  it('replays an attempt idempotently', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/v1/games/start', headers: { cookie }, payload: { kind: 'daily', mode: 'series', period: 'all', difficulty: null, archiveDate: null } })
    const session = start.json().session
    const search = await app.inject({ method: 'GET', url: `/api/v1/catalog/search?mode=series&q=а&sessionId=${session.id}&limit=1`, headers: { cookie } })
    expect(search.statusCode).toBe(200)
    const itemId = search.json().items[0].id
    const key = crypto.randomUUID()
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/games/${session.id}/attempts`, headers: { cookie, 'idempotency-key': key }, payload: { itemId } }),
      app.inject({ method: 'POST', url: `/api/v1/games/${session.id}/attempts`, headers: { cookie, 'idempotency-key': key }, payload: { itemId } }),
    ])
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200)
    expect(second.json()).toEqual(first.json())
    const snapshot = await app.inject({ method: 'GET', url: `/api/v1/games/${session.id}`, headers: { cookie } })
    expect(snapshot.json().session.attemptsCount).toBe(1)
  })

  it('charges unlock, free play and promo only once under concurrent retries', async () => {
    const config = loadConfig(); const database = createDatabase(config)
    try {
      await database.db.insert(walletAccounts).values({ userId: guestUserId, balance: 100, lifetimeEarned: 100 }).onConflictDoUpdate({ target: walletAccounts.userId, set: { balance: 100, lifetimeEarned: 100 } })
      const unlockKey = crypto.randomUUID()
      const unlockRequests = [1, 2].map(() => app.inject({ method: 'POST', url: '/api/v1/economy/period-unlocks', headers: { cookie, 'idempotency-key': unlockKey }, payload: { mode: 'anime', period: 'from_2020' } }))
      expect((await Promise.all(unlockRequests)).every((response) => response.statusCode === 200)).toBe(true)
      expect((await database.db.select().from(walletAccounts).where(eq(walletAccounts.userId, guestUserId)))[0].balance).toBe(75)
      expect((await database.db.select().from(periodEntitlements).where(eq(periodEntitlements.userId, guestUserId))).length).toBe(1)

      const freeKey = crypto.randomUUID()
      const freeRequests = [1, 2].map(() => app.inject({ method: 'POST', url: '/api/v1/economy/free-play/start', headers: { cookie, 'idempotency-key': freeKey }, payload: { mode: 'movie', difficulty: null } }))
      expect((await Promise.all(freeRequests)).every((response) => response.statusCode === 200)).toBe(true)
      expect((await database.db.select().from(walletAccounts).where(eq(walletAccounts.userId, guestUserId)))[0].balance).toBe(30)

      const code = `TEST-${crypto.randomUUID()}`
      await database.db.insert(promoCodes).values({ codeHash: promoHash(code, config.promoPepper), title: 'Integration', rewardType: 'tickets', rewardValue: 50, perUserLimit: 1 })
      const promoKey = crypto.randomUUID()
      const promoRequests = [1, 2].map(() => app.inject({ method: 'POST', url: '/api/v1/promos/redeem', headers: { cookie, 'idempotency-key': promoKey }, payload: { code } }))
      expect((await Promise.all(promoRequests)).every((response) => response.statusCode === 200)).toBe(true)
      expect((await database.db.select().from(walletAccounts).where(eq(walletAccounts.userId, guestUserId)))[0].balance).toBe(80)
    } finally { await database.client.end() }
  })

  it('moves a trusted anonymous wallet and immutable ledger during account link', async () => {
    const config = loadConfig(); const database = createDatabase(config); const targetUserId = crypto.randomUUID()
    try {
      await database.db.insert(user).values({ id: targetUserId, name: 'Target', email: `${targetUserId}@example.test`, emailVerified: true })
      await database.db.insert(walletAccounts).values({ userId: guestUserId, balance: 10, lifetimeEarned: 10 }).onConflictDoUpdate({ target: walletAccounts.userId, set: { balance: 10, lifetimeEarned: 10 } })
      await database.db.insert(walletLedger).values({ userId: guestUserId, operationKey: `merge-test:${guestUserId}`, type: 'earn', reason: 'test', amount: 10, balanceAfter: 10, metadata: {} }).onConflictDoNothing()
      await mergeAnonymousAccount(database.db, guestUserId, targetUserId)
      expect((await database.db.select().from(walletAccounts).where(eq(walletAccounts.userId, targetUserId)))[0].balance).toBe(10)
      expect((await database.db.select().from(walletLedger).where(eq(walletLedger.operationKey, `merge-test:${guestUserId}`)))[0].userId).toBe(targetUserId)
    } finally { await database.client.end() }
  })
})
