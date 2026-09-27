import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { PLAYABLE_MODE_IDS, type FreePlayResponse } from '@shoditsa/contracts'
import { appSettings, createDatabase, gameSessions, playerProfiles, registrationPlayCredits, user, walletAccounts, walletLedger } from '@shoditsa/database'
import { grantRegistrationPlays, growthReport, GROWTH_SETTING, registrationBonusSummary } from '../src/modules/growth/service.js'
import { startFreePlay as startFreePlayService } from '../src/modules/economy/service.js'
import { mergeAnonymousAccount } from '../src/modules/auth/merge.js'
const startFreePlay = (...args: Parameters<typeof startFreePlayService>) => startFreePlayService(...args) as Promise<FreePlayResponse>

describe('finite registration rounds (real isolated database)', () => {
  let database: ReturnType<typeof createDatabase>
  let saved: unknown
  const userId = crypto.randomUUID()
  const guestId = crypto.randomUUID()
  beforeAll(async () => {
    const config = loadConfig()
    if (config.production || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.databaseUrl).hostname)) throw new Error('Registration bonus tests require an isolated local database')
    database = createDatabase(config)
    saved = (await database.db.select().from(appSettings).where(eq(appSettings.key, GROWTH_SETTING)))[0]?.value
    await database.db.insert(user).values([
      { id: userId, name: 'Growth QA', email: `${userId}@example.test`, emailVerified: true },
      { id: guestId, name: 'Growth Guest', email: `${guestId}@example.test`, isAnonymous: true },
    ])
    await database.db.insert(playerProfiles).values([{ userId }, { userId: guestId }])
    await database.db.insert(walletAccounts).values([{ userId, balance: 200 }, { userId: guestId, balance: 100 }])
    await database.db.insert(appSettings).values({ key: GROWTH_SETTING, value: { stage: 'registration', changedAt: '2026-09-20T00:00:00Z', registrationOpenedAt: '2026-09-20T00:00:00Z' } }).onConflictDoUpdate({ target: appSettings.key, set: { value: { stage: 'registration' } } })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-21T12:00:00Z'))
  })
  afterAll(async () => {
    vi.useRealTimers()
    if (saved === undefined) await database.db.delete(appSettings).where(eq(appSettings.key, GROWTH_SETTING))
    else await database.db.update(appSettings).set({ value: saved }).where(eq(appSettings.key, GROWTH_SETTING))
    await database.client.end()
  })
  it('grants exactly once, never to a guest', async () => {
    await Promise.all([grantRegistrationPlays(database.db, { id: userId }), grantRegistrationPlays(database.db, { id: userId }), grantRegistrationPlays(database.db, { id: guestId, isAnonymous: true })])
    expect(await registrationBonusSummary(database.db, userId)).toMatchObject({ granted: 3, remaining: 3 })
    expect(await registrationBonusSummary(database.db, guestId)).toMatchObject({ granted: 0, remaining: 0 })
    const bonus = await registrationBonusSummary(database.db, userId)
    expect(Object.keys(bonus.byMode ?? {})).toHaveLength(PLAYABLE_MODE_IDS.length)
    for (const mode of PLAYABLE_MODE_IDS) expect(bonus.byMode?.[mode]).toEqual({ granted: 3, remaining: 3 })
  })
  it('merges the actual guest session and result without duplicating bonus', async () => {
    const guestGame = await startFreePlay(database.db, guestId, 'player', 100, 'diagnosis', null, crypto.randomUUID())
    await database.db.update(gameSessions).set({ status: 'won', completionType: 'direct_win', completedAt: new Date('2026-09-21T11:00:00Z') }).where(eq(gameSessions.id, guestGame.id))
    await mergeAnonymousAccount(database.db, guestId, userId)
    const transferred = (await database.db.select().from(gameSessions).where(eq(gameSessions.id, guestGame.id)))[0]
    expect(transferred).toMatchObject({ userId, status: 'won' })
    expect((await registrationBonusSummary(database.db, userId)).remaining).toBe(3)
  })
  it('starts a linked bonus session idempotently without touching the wallet', async () => {
    const source = (await database.db.select().from(gameSessions).where(eq(gameSessions.userId, userId)))[0]
    const balance = (await database.db.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)))[0].balance
    const key = crypto.randomUUID()
    const results = await Promise.all([1, 2].map(() => startFreePlay(database.db, userId, 'player', 100, 'diagnosis', null, key, null, source.id)))
    expect(results[0].id).toBe(results[1].id)
    expect(results[0]).toMatchObject({ cost: 0, ledgerId: null, accessSource: 'registration_bonus', balanceAfter: balance })
    expect((await registrationBonusSummary(database.db, userId)).remaining).toBe(2)
    expect((await database.db.select().from(gameSessions).where(eq(gameSessions.id, results[0].id)))[0].sourceSessionId).toBe(source.id)
    expect(await database.db.select().from(walletLedger).where(eq(walletLedger.operationKey, `free-play:${userId}:${key}`))).toHaveLength(0)
  })
  it('spends a separate finite allowance per mode; honors remaining credits after pause', async () => {
    const other = await Promise.all([1, 2, 3].map(() => startFreePlay(database.db, userId, 'player', 100, 'movie', null, crypto.randomUUID())))
    expect(other.every((result) => result.accessSource === 'registration_bonus' && result.cost === 0)).toBe(true)
    expect((await registrationBonusSummary(database.db, userId)).remaining).toBe(2)
    expect((await registrationBonusSummary(database.db, userId)).byMode?.movie?.remaining).toBe(0)
    expect((await registrationBonusSummary(database.db, userId)).byMode?.animal?.remaining).toBe(3)
    await grantRegistrationPlays(database.db, { id: userId })
    expect((await registrationBonusSummary(database.db, userId)).byMode?.movie?.remaining).toBe(0)
    const paidMovie = await startFreePlay(database.db, userId, 'player', 100, 'movie', null, crypto.randomUUID())
    expect(paidMovie.accessSource).toBe('tickets')
    await database.db.update(appSettings).set({ value: { stage: 'baseline' } }).where(eq(appSettings.key, GROWTH_SETTING))
    const results = await Promise.all([1, 2].map(() => startFreePlay(database.db, userId, 'player', 100, 'diagnosis', null, crypto.randomUUID())))
    expect(results.every((result) => result.accessSource === 'registration_bonus')).toBe(true)
    expect((await registrationBonusSummary(database.db, userId)).remaining).toBe(0)
    const fourth = await startFreePlay(database.db, userId, 'player', 100, 'diagnosis', null, crypto.randomUUID())
    expect(fourth.accessSource).toBe('tickets')
    expect(fourth.cost).toBeGreaterThan(0)
    expect((await registrationBonusSummary(database.db, userId)).remaining).toBe(0)
  })
  it('does not trust another user or an unfinished source session', async () => {
    await expect(startFreePlay(database.db, userId, 'player', 100, 'diagnosis', null, crypto.randomUUID(), null, crypto.randomUUID())).rejects.toMatchObject({ code: 'INVALID_REPLAY_SOURCE' })
  })
  it('executes the aggregate report without PII or current-day rows', async () => {
    const report = await growthReport(database.db, 7)
    expect(report.period.toExclusive).toBe('2026-09-21T00:00:00.000Z')
    expect(report.sessions).toHaveProperty('firstCompleters')
    expect(report).toHaveProperty('registrationBonusByMode')
    expect(JSON.stringify(report)).not.toMatch(/example\.test|Growth QA/)
    expect((await database.db.execute(sql`select remaining from registration_play_credits where user_id=${userId}`))[0].remaining).toBe(0)
  })
})
