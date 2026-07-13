import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { loadConfig, type AppConfig } from '@shoditsa/config'
import {
  contentItemVersions,
  createDatabase,
  gameSessions,
  user,
  walletLedger,
} from '@shoditsa/database'
import { buildApp } from '../src/app.js'

const requestOrigin = 'http://localhost:5173'

const responseCookie = (headers: Record<string, unknown>) => {
  const raw = headers['set-cookie']
  const values = Array.isArray(raw) ? raw : raw ? [raw] : []
  return values.map((value) => String(value).split(';')[0]).join('; ')
}

describe('guest to permanent account lifecycle', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let database: ReturnType<typeof createDatabase>
  let config: AppConfig

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET ||= 'account-lifecycle-secret-at-least-32-characters'
    process.env.BETTER_AUTH_URL ||= 'http://localhost:3001'
    process.env.TRUSTED_ORIGINS ||= requestOrigin
    process.env.PROMO_CODE_PEPPER ||= 'account-lifecycle-pepper-at-least-32-characters'
    config = Object.freeze({
      ...loadConfig(),
      authEmailEnabled: true,
      smtp: { host: '', port: 587, user: '', password: '', from: '' },
    })
    database = createDatabase(config)
    app = await buildApp({ config })
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    await database?.client.end()
  })

  const createGuest = async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/guest', headers: { origin: requestOrigin } })
    expect(response.statusCode).toBe(200)
    const cookie = responseCookie(response.headers)
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    return { cookie, userId: me.json().user.id as string }
  }

  const completeDaily = async (cookie: string, mode: 'movie' | 'series') => {
    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/games/start',
      headers: { cookie },
      payload: { kind: 'daily', mode, period: 'all', difficulty: null, archiveDate: null },
    })
    expect(start.statusCode).toBe(200)
    const sessionId = start.json().session.id as string
    const answer = await database.db
      .select({ itemId: contentItemVersions.itemId })
      .from(gameSessions)
      .innerJoin(contentItemVersions, eq(contentItemVersions.id, gameSessions.answerItemVersionId))
      .where(eq(gameSessions.id, sessionId))
      .limit(1)
    expect(answer[0]?.itemId).toBeTruthy()
    const attempt = await app.inject({
      method: 'POST',
      url: `/api/v1/games/${sessionId}/attempts`,
      headers: { cookie, 'idempotency-key': crypto.randomUUID() },
      payload: { itemId: answer[0].itemId },
    })
    expect(attempt.statusCode).toBe(200)
    expect(attempt.json().session.status).toBe('won')
    expect(attempt.json().reward.total).toBeGreaterThan(0)
    return { sessionId, reward: attempt.json().reward as { total: number; balanceAfter: number } }
  }

  const dashboard = async (cookie: string) => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/dashboard', headers: { cookie } })
    expect(response.statusCode).toBe(200)
    return response.json()
  }

  it('preserves and continues all trusted progress across registration and existing-account login', async () => {
    const email = `lifecycle-${crypto.randomUUID()}@example.test`
    const password = 'Strong-password-123'

    const firstGuest = await createGuest()
    const firstCompletion = await completeDaily(firstGuest.cookie, 'movie')
    const guestDashboard = await dashboard(firstGuest.cookie)
    expect(guestDashboard.wallet.balance).toBe(firstCompletion.reward.balanceAfter)
    expect(guestDashboard.today.completedModes).toContain('movie')

    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { cookie: firstGuest.cookie, origin: requestOrigin },
      payload: { name: 'Lifecycle Player', email, password },
    })
    expect(signUp.statusCode, signUp.body).toBe(200)
    const accountCookie = responseCookie(signUp.headers)
    const accountMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: accountCookie } })
    expect(accountMe.statusCode).toBe(200)
    expect(accountMe.json().user).toMatchObject({ email, isAnonymous: false })
    const accountUserId = accountMe.json().user.id as string
    expect(accountUserId).not.toBe(firstGuest.userId)

    const afterRegistration = await dashboard(accountCookie)
    expect(afterRegistration.wallet.balance).toBe(guestDashboard.wallet.balance)
    expect(afterRegistration.wallet.lifetimeEarned).toBe(guestDashboard.wallet.lifetimeEarned)
    expect(afterRegistration.today.completedModes).toContain('movie')
    expect(afterRegistration.stats.find((entry: { mode: string }) => entry.mode === 'movie')).toMatchObject({ played: 1, won: 1 })
    expect((await database.db.select().from(user).where(eq(user.id, firstGuest.userId))).length).toBe(0)

    const archive = await app.inject({ method: 'GET', url: '/api/v1/archive?mode=movie', headers: { cookie: accountCookie } })
    expect(archive.statusCode).toBe(200)
    expect(archive.json().items).toHaveLength(1)
    expect(archive.json().items[0]).toMatchObject({ id: firstCompletion.sessionId, status: 'won' })

    const targetBeforeSecondMerge = afterRegistration.wallet.balance as number
    const secondGuest = await createGuest()
    const secondCompletion = await completeDaily(secondGuest.cookie, 'movie')
    const secondGuestDashboard = await dashboard(secondGuest.cookie)
    expect(secondGuestDashboard.wallet.balance).toBe(secondCompletion.reward.balanceAfter)

    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { cookie: secondGuest.cookie, origin: requestOrigin },
      payload: { email, password },
    })
    expect(signIn.statusCode, signIn.body).toBe(200)
    const mergedCookie = responseCookie(signIn.headers)
    const afterExistingAccountMerge = await dashboard(mergedCookie)
    expect(afterExistingAccountMerge.wallet.balance).toBe(targetBeforeSecondMerge + secondGuestDashboard.wallet.balance)
    expect((await database.db.select().from(user).where(eq(user.id, secondGuest.userId))).length).toBe(0)

    const mergedArchive = await app.inject({ method: 'GET', url: '/api/v1/archive?mode=movie', headers: { cookie: mergedCookie } })
    expect(mergedArchive.statusCode).toBe(200)
    expect(mergedArchive.json().items).toHaveLength(1)
    expect(mergedArchive.json().items[0]).toMatchObject({ status: 'won', attemptsCount: 1 })

    const movedLedger = await database.db.select().from(walletLedger).where(eq(walletLedger.userId, accountUserId))
    expect(movedLedger.filter((entry) => entry.reason === 'game-completion')).toHaveLength(2)
    expect(movedLedger.reduce((sum, entry) => sum + entry.amount, 0)).toBe(afterExistingAccountMerge.wallet.balance)

    const nextCompletion = await completeDaily(mergedCookie, 'series')
    const afterNextGame = await dashboard(mergedCookie)
    expect(afterNextGame.wallet.balance).toBe(nextCompletion.reward.balanceAfter)
    expect(afterNextGame.wallet.balance).toBeGreaterThan(afterExistingAccountMerge.wallet.balance)
    expect(afterNextGame.today.completedModes).toEqual(expect.arrayContaining(['movie', 'series']))

    const repeatRead = await dashboard(mergedCookie)
    expect(repeatRead.wallet).toEqual(afterNextGame.wallet)
    expect(repeatRead.stats).toEqual(afterNextGame.stats)
  })
})
