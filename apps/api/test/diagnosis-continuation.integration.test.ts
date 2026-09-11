import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { loadConfig, type AppConfig } from '@shoditsa/config'
import type { GameSessionSnapshot } from '@shoditsa/contracts'
import {
  createDatabase, gameSessions, playerProfiles, registrationPlayCredits,
  user, userEntitlements, walletAccounts, walletLedger,
} from '@shoditsa/database'
import { startGame as startGameService } from '../src/modules/games/service.js'
import { loadGrowthPolicy } from '../src/modules/growth/service.js'

const TODAY = '2026-09-12'
const YESTERDAY = '2026-09-11'
const startGame = (...args: Parameters<typeof startGameService>) => startGameService(...args) as Promise<GameSessionSnapshot>

describe('diagnosis continuation into the free archive (isolated test accounts)', () => {
  let database: ReturnType<typeof createDatabase> | undefined
  let config: AppConfig
  const users: string[] = []

  beforeAll(() => {
    const loaded = loadConfig()
    const url = new URL(loaded.databaseUrl)
    if (loaded.production || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Diagnosis continuation integration tests require a local, non-production PostgreSQL database')
    }
    config = { ...loaded, commerce: { ...loaded.commerce, archiveFirstDate: '2026-07-01', freeArchiveDays: 7 } }
    database = createDatabase(config)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  })

  afterAll(async () => {
    vi.useRealTimers()
    if (!database) return
    try {
      if (users.length) {
        await database.db.delete(gameSessions).where(inArray(gameSessions.userId, users))
        await database.db.delete(registrationPlayCredits).where(inArray(registrationPlayCredits.userId, users))
        await database.db.delete(userEntitlements).where(inArray(userEntitlements.userId, users))
        await database.db.delete(walletAccounts).where(inArray(walletAccounts.userId, users))
        await database.db.delete(playerProfiles).where(inArray(playerProfiles.userId, users))
        await database.db.delete(user).where(inArray(user.id, users))
      }
    } finally { await database.client.end() }
  })

  const db = () => database!.db
  const guest = async () => {
    const id = crypto.randomUUID()
    await db().insert(user).values({ id, name: 'Continuation QA', email: `${id}@example.test`, isAnonymous: true })
    users.push(id)
    await db().insert(playerProfiles).values({ userId: id })
    await db().insert(walletAccounts).values({ userId: id, balance: 0 })
    return id
  }
  const source = async (userId: string, options: {
    mode?: 'diagnosis' | 'movie'; finished?: boolean; pack?: boolean; archiveDate?: string
  } = {}) => {
    const started = await startGame(db(), userId, {
      kind: options.archiveDate ? 'archive' : 'daily', mode: options.mode ?? 'diagnosis',
      ...(options.archiveDate ? { archiveDate: options.archiveDate } : {}),
    }, null, 'player', config)
    await db().update(gameSessions).set({
      startedAt: new Date(`${TODAY}T10:00:00Z`),
      ...(options.finished === false ? {} : {
        status: 'won', completionType: 'direct_win', completedAt: new Date(`${TODAY}T11:00:00Z`),
      }),
      ...(options.pack ? { kind: 'pack', packId: 'continuation-test-private-pack', packPosition: 1 } : {}),
    }).where(eq(gameSessions.id, started.id))
    return started.id
  }
  const continueWith = (userId: string, sourceSessionId: string, archiveDate = YESTERDAY) => startGame(db(), userId, {
    kind: 'archive', mode: 'diagnosis', archiveDate, sourceSessionId,
  }, null, 'player', config)
  const sessionRow = async (id: string) => (await db().select().from(gameSessions).where(eq(gameSessions.id, id)))[0]
  const expectNoCharge = async (userId: string) => {
    expect((await db().select().from(walletAccounts).where(eq(walletAccounts.userId, userId)))[0].balance).toBe(0)
    expect(await db().select().from(walletLedger).where(eq(walletLedger.userId, userId))).toHaveLength(0)
    expect(await db().select().from(registrationPlayCredits).where(eq(registrationPlayCredits.userId, userId))).toHaveLength(0)
  }

  it('lets a guest with zero tickets continue for free and stores the source and actual rollout stage', async () => {
    const id = await guest()
    const sourceId = await source(id)
    const stage = (await loadGrowthPolicy(db())).stage
    const next = await continueWith(id, sourceId)
    expect(next).toMatchObject({ mode: 'diagnosis', kind: 'archive', puzzleDate: YESTERDAY, status: 'playing' })
    expect(await sessionRow(next.id)).toMatchObject({ userId: id, sourceSessionId: sourceId, accessSource: 'free_archive', growthStage: stage })
    await expectNoCharge(id)
  })

  it('reuses the same daily challenge on concurrent retries and preserves its original source', async () => {
    const id = await guest()
    const sourceId = await source(id)
    const [a, b] = await Promise.all([continueWith(id, sourceId), continueWith(id, sourceId)])
    expect(a.id).toBe(b.id)
    const otherSourceId = await source(id, { archiveDate: '2026-09-10' })
    const existing = await continueWith(id, otherSourceId)
    expect(existing.id).toBe(a.id)
    expect((await sessionRow(a.id)).sourceSessionId).toBe(sourceId)
    expect(await db().select().from(gameSessions).where(and(eq(gameSessions.userId, id), eq(gameSessions.puzzleDate, YESTERDAY)))).toHaveLength(1)
    await expectNoCharge(id)
  })

  it('does not retrofit a historical archive session with a source or new attribution', async () => {
    const id = await guest()
    const historical = await startGame(db(), id, { kind: 'archive', mode: 'diagnosis', archiveDate: YESTERDAY }, null, 'player', config)
    const sourceId = await source(id)
    const continued = await continueWith(id, sourceId)
    expect(continued.id).toBe(historical.id)
    expect(await sessionRow(continued.id)).toMatchObject({ sourceSessionId: null, accessSource: null, growthStage: null })
    await expectNoCharge(id)
  })

  it('rejects another guest’s source', async () => {
    const ownerId = await guest()
    const callerId = await guest()
    await expect(continueWith(callerId, await source(ownerId))).rejects.toMatchObject({ code: 'INVALID_REPLAY_SOURCE' })
    await expectNoCharge(callerId)
  })

  it.each([
    ['unfinished', { finished: false }],
    ['another mode', { mode: 'movie' as const }],
    ['private pack', { pack: true }],
  ])('rejects an %s source without creating an archive session', async (_label, options) => {
    const id = await guest()
    await expect(continueWith(id, await source(id, options))).rejects.toMatchObject({ code: 'INVALID_REPLAY_SOURCE' })
    expect(await db().select().from(gameSessions).where(and(eq(gameSessions.userId, id), eq(gameSessions.puzzleDate, YESTERDAY)))).toHaveLength(0)
    await expectNoCharge(id)
  })

  it('rejects the same puzzle, a future date and a date outside the free archive', async () => {
    const id = await guest()
    const sourceId = await source(id)
    await expect(continueWith(id, sourceId, TODAY)).rejects.toMatchObject({ code: 'INVALID_REPLAY_SOURCE' })
    await expect(continueWith(id, sourceId, '2026-09-13')).rejects.toMatchObject({ code: 'ARCHIVE_DATE_IN_FUTURE' })
    await expect(continueWith(id, sourceId, '2026-09-05')).rejects.toMatchObject({ code: 'ARCHIVE_CLUB_REQUIRED' })
    await expectNoCharge(id)
  })

  it('does not silently use paid archive rights when a previously free date has left the free window', async () => {
    const id = await guest()
    const sourceId = await source(id)
    await db().insert(userEntitlements).values({
      userId: id, entitlementKey: 'club', sourceType: 'admin', sourceId: `continuation-test:${id}`,
      startsAt: new Date('2026-09-01T00:00:00Z'), endsAt: new Date('2026-10-01T00:00:00Z'),
    })
    await expect(continueWith(id, sourceId, '2026-09-05')).rejects.toMatchObject({ code: 'FREE_ARCHIVE_WINDOW_MOVED' })
    await expectNoCharge(id)
  })
})
