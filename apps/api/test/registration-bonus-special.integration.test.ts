import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { appSettings, connectionsSchedule, contentItemVersions, createDatabase, gameSessions, playerProfiles, user, walletAccounts, walletLedger } from '@shoditsa/database'
import { grantRegistrationPlays, GROWTH_SETTING, registrationBonusSummary } from '../src/modules/growth/service.js'
import { startConnectionsBonus } from '../src/modules/connections/service.js'
import { startDanetkiSession } from '../src/modules/danetki/service.js'
import { getMoscowDate } from '../src/lib/time.js'

describe('registration rounds in Connections and Danetki', () => {
  const id = crypto.randomUUID()
  let database: ReturnType<typeof createDatabase>
  let config: ReturnType<typeof loadConfig>
  let saved: unknown
  let scheduledDate: string
  beforeAll(async () => {
    config = { ...loadConfig(), connectionsEnabled: true, danetkiEnabled: true }
    if (config.production || !['localhost', '127.0.0.1'].includes(new URL(config.databaseUrl).hostname)) throw Error('Local isolated database required')
    database = createDatabase(config)
    saved = (await database.db.select().from(appSettings).where(eq(appSettings.key, GROWTH_SETTING)))[0]?.value
    await database.db.insert(appSettings).values({ key: GROWTH_SETTING, value: { stage: 'registration' } }).onConflictDoUpdate({ target: appSettings.key, set: { value: { stage: 'registration' } } })
    await database.db.insert(user).values({ id, name: 'Bonus test', email: `${id}@example.test`, emailVerified: true })
    await database.db.insert(playerProfiles).values({ userId: id })
    await database.db.insert(walletAccounts).values({ userId: id, balance: 0 })
    await grantRegistrationPlays(database.db, { id })
    const item = (await database.db.select().from(contentItemVersions).where(and(eq(contentItemVersions.mode, 'connections'), eq(contentItemVersions.allowedInGame, true))).limit(1))[0]
    if (!item) throw Error('Seed Connections fixtures')
    scheduledDate = getMoscowDate()
    await database.db.insert(connectionsSchedule).values({ puzzleDate: scheduledDate, itemVersionId: item.id }).onConflictDoNothing()
  })
  afterAll(async () => {
    if (!database) return
    await database.db.delete(gameSessions).where(eq(gameSessions.userId, id))
    await database.db.delete(playerProfiles).where(eq(playerProfiles.userId, id))
    await database.db.delete(user).where(eq(user.id, id))
    if (scheduledDate) await database.db.delete(connectionsSchedule).where(eq(connectionsSchedule.puzzleDate, scheduledDate))
    if (saved === undefined) await database.db.delete(appSettings).where(eq(appSettings.key, GROWTH_SETTING))
    else await database.db.update(appSettings).set({ value: saved }).where(eq(appSettings.key, GROWTH_SETTING))
    await database.client.end()
  })
  it('creates a bonus grid idempotently and never spends another mode allowance', async () => {
    const key = crypto.randomUUID()
    const results = await Promise.all([1, 2].map(() => startConnectionsBonus(database.db, id, 'player', null, key, config)))
    expect(results[0].session.id).toBe(results[1].session.id)
    expect(results[0].session.engine).toBe('connections_grid')
    const bonus = await registrationBonusSummary(database.db, id)
    expect(bonus.byMode?.connections?.remaining).toBe(2)
    expect(bonus.byMode?.danetki?.remaining).toBe(3)
    expect(bonus.remaining).toBe(3)
  })
  it('limits concurrent grids to the remaining credits and preserves the daily game', async () => {
    const attempts = await Promise.allSettled([1, 2, 3].map(() => startConnectionsBonus(database.db, id, 'player', null, crypto.randomUUID(), config)))
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
    expect((attempts.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('REGISTRATION_BONUS_EXHAUSTED')
    const sessions = await database.db.select().from(gameSessions).where(eq(gameSessions.userId, id))
    expect(sessions.every((s) => s.kind === 'free_play' && s.challengeId === null)).toBe(true)
    expect((await registrationBonusSummary(database.db, id)).byMode?.connections?.remaining).toBe(0)
  })
  it('starts extra Danetki with zero wallet balance, idempotently, at most three times', async () => {
    const player = { id, name: 'Bonus test', role: 'player' as const, authSessionId: null }
    const key = crypto.randomUUID()
    const first = await Promise.all([1, 2].map(() => startDanetkiSession(database.db, player, { kind: 'free_play', roomMode: 'solo', idempotencyKey: key }, config)))
    expect(first[0].id).toBe(first[1].id)
    expect((await registrationBonusSummary(database.db, id)).byMode?.danetki?.remaining).toBe(2)
    for (let i = 0; i < 2; i++) await startDanetkiSession(database.db, player, { kind: 'free_play', roomMode: 'solo', idempotencyKey: crypto.randomUUID() }, config)
    await expect(startDanetkiSession(database.db, player, { kind: 'free_play', roomMode: 'solo', idempotencyKey: crypto.randomUUID() }, config)).rejects.toMatchObject({ code: 'INSUFFICIENT_TICKETS' })
    expect((await registrationBonusSummary(database.db, id)).byMode?.danetki?.remaining).toBe(0)
    expect((await database.db.select().from(walletAccounts).where(eq(walletAccounts.userId, id)))[0].balance).toBe(0)
    expect(await database.db.select().from(walletLedger).where(eq(walletLedger.userId, id))).toHaveLength(0)
    const rows = await database.db.execute(sql`select count(*)::int as n from game_sessions where user_id=${id} and mode='danetki' and access_source='registration_bonus'`)
    expect(rows[0].n).toBe(3)
  })
})
