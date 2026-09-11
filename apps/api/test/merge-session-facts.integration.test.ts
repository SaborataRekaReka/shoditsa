import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import type { GrowthReport } from '@shoditsa/contracts'
import {
  contentItemVersions, createDatabase, dailyChallenges, gameSessionFacts, gameSessions,
  playerProfiles, user,
} from '@shoditsa/database'
import { mergeAnonymousAccount } from '../src/modules/auth/merge.js'
import { growthReport } from '../src/modules/growth/service.js'

describe('original session facts survive account linking (isolated PostgreSQL)', () => {
  let database: ReturnType<typeof createDatabase> | undefined
  let item: typeof contentItemVersions.$inferSelect
  const fixtureUsers: string[] = []
  const fixtureChallenges: string[] = []
  const report = () => growthReport(database!.db, 7) as Promise<GrowthReport>
  const live = async (id: string) => (await database!.db.select().from(gameSessions).where(eq(gameSessions.id, id)))[0]
  const fact = async (id: string) => (await database!.db.select().from(gameSessionFacts).where(eq(gameSessionFacts.id, id)))[0]

  beforeAll(async () => {
    const config = loadConfig()
    if (config.production || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.databaseUrl).hostname)) {
      throw new Error('Session-fact merge tests require a local, non-production PostgreSQL database')
    }
    database = createDatabase(config)
    const seededItem = (await database.db.select().from(contentItemVersions).where(eq(contentItemVersions.mode, 'diagnosis')).limit(1))[0]
    if (!seededItem) throw new Error('Seed the local test database with Diagnosis content before running this test')
    item = seededItem
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'))
  })

  // Only the generated fixture owners/challenges are removed. Do not truncate,
  // change app_settings, or mutate the seeded content used by other tests.
  afterEach(async () => {
    if (!database || fixtureUsers.length === 0) return
    await database.db.delete(gameSessions).where(inArray(gameSessions.userId, fixtureUsers))
    for (const owner of fixtureUsers) {
      await database.db.execute(sql`delete from audit_log where actor_user_id=${owner}::uuid`)
      await database.db.execute(sql`delete from user_mode_stats where user_id=${owner}::uuid`)
      await database.db.execute(sql`delete from wallet_accounts where user_id=${owner}::uuid`)
    }
    await database.db.delete(playerProfiles).where(inArray(playerProfiles.userId, fixtureUsers))
    await database.db.delete(user).where(inArray(user.id, fixtureUsers))
    if (fixtureChallenges.length) await database.db.delete(dailyChallenges).where(inArray(dailyChallenges.id, fixtureChallenges))
    fixtureUsers.length = 0
    fixtureChallenges.length = 0
  })

  afterAll(async () => {
    vi.useRealTimers()
    await database?.client.end()
  })

  const newUser = async (anonymous = true, admin = false) => {
    const id = crypto.randomUUID()
    fixtureUsers.push(id)
    await database!.db.insert(user).values({ id, name: 'Merge fact fixture', email: `${id}@example.test`, isAnonymous: anonymous })
    await database!.db.insert(playerProfiles).values({ userId: id, role: admin ? 'admin' : 'player' })
    return id
  }

  const challenge = async () => {
    const id = crypto.randomUUID()
    fixtureChallenges.push(id)
    await database!.db.insert(dailyChallenges).values({
      id, challengeKey: `merge-fact-fixture:${id}`, puzzleDate: '2026-09-09', mode: 'diagnosis',
      period: 'all', variantKey: id, revisionId: item.revisionId, answerItemVersionId: item.id,
      globalSalt: 0, algorithmVersion: 1,
    })
    return id
  }

  const newSession = async (userId: string, options: {
    challengeId?: string; sourceSessionId?: string; mode?: 'diagnosis' | 'movie';
    kind?: 'daily' | 'archive' | 'free_play' | 'pack'; startedAt?: string;
    completedAt?: string; lost?: boolean; attempts?: number;
  } = {}) => {
    const id = crypto.randomUUID()
    await database!.db.insert(gameSessions).values({
      id, userId, challengeId: options.challengeId,
      kind: options.kind ?? (options.sourceSessionId ? 'archive' : 'daily'), mode: options.mode ?? 'diagnosis',
      period: 'all', puzzleDate: '2026-09-09', revisionId: item.revisionId, answerItemVersionId: item.id,
      rulesVersion: 1, startedAt: new Date(options.startedAt ?? '2026-09-09T09:00:00Z'),
      sourceSessionId: options.sourceSessionId, accessSource: options.sourceSessionId ? 'free_archive' : null,
      growthStage: 'baseline', status: options.completedAt ? (options.lost ? 'lost' : 'won') : 'playing',
      completedAt: options.completedAt ? new Date(options.completedAt) : null,
      completionType: options.completedAt ? (options.lost ? 'attempts_exhausted' : 'direct_win') : null,
      attemptsCount: options.attempts ?? 1,
      ...(options.kind === 'pack' ? { packId: 'fixture-private-pack', packPosition: 1 } : {}),
    })
    return id
  }

  it('keeps the guest source and its real chronology when a later target result wins', async () => {
    const before = await report()
    const guest = await newUser()
    const target = await newUser(false)
    const shared = await challenge()
    const source = await newSession(guest, { challengeId: shared, completedAt: '2026-09-09T10:00:00Z', attempts: 3 })
    const winner = await newSession(target, { challengeId: shared, startedAt: '2026-09-09T11:00:00Z', completedAt: '2026-09-09T12:00:00Z' })
    const repeat = await newSession(guest, { sourceSessionId: source, startedAt: '2026-09-09T10:05:00Z', completedAt: '2026-09-09T10:10:00Z' })

    await mergeAnonymousAccount(database!.db, guest, target)
    expect(await live(source)).toBeUndefined()
    expect(await live(winner)).toMatchObject({ userId: target })
    expect(await live(repeat)).toMatchObject({ userId: target, sourceSessionId: null })
    expect(await fact(source)).toMatchObject({ userId: target, completedAt: new Date('2026-09-09T10:00:00Z'), completionStatus: 'won' })
    expect(await fact(repeat)).toMatchObject({ userId: target, sourceSessionId: source, startedAt: new Date('2026-09-09T10:05:00Z'), accessSource: 'free_archive' })
    const after = await report()
    expect(Number(after.sessions.completions) - Number(before.sessions.completions)).toBe(3)
    expect(Number(after.sessions.repeatStarts) - Number(before.sessions.repeatStarts)).toBe(1)
    expect(Number(after.sessions.repeatCompletions) - Number(before.sessions.repeatCompletions)).toBe(1)

    // Better Auth removes the anonymous owner after merge returns. A second link
    // callback and that deletion must neither duplicate nor erase episode facts.
    await mergeAnonymousAccount(database!.db, guest, target)
    await database!.db.delete(user).where(eq(user.id, guest))
    const facts = await database!.db.select().from(gameSessionFacts).where(eq(gameSessionFacts.userId, target))
    expect(facts).toHaveLength(3)
    expect((await fact(repeat)).sourceSessionId).toBe(source)
  })

  it('also preserves target-side history when the guest source wins the duplicate', async () => {
    const before = await report()
    const guest = await newUser()
    const target = await newUser(false)
    const shared = await challenge()
    const source = await newSession(target, { challengeId: shared, completedAt: '2026-09-09T10:00:00Z', attempts: 4 })
    const repeat = await newSession(target, { sourceSessionId: source, startedAt: '2026-09-09T10:05:00Z', completedAt: '2026-09-09T10:10:00Z' })
    const winner = await newSession(guest, { challengeId: shared, startedAt: '2026-09-09T11:00:00Z', completedAt: '2026-09-09T12:00:00Z' })
    await mergeAnonymousAccount(database!.db, guest, target)
    expect(await live(source)).toBeUndefined()
    expect(await live(winner)).toMatchObject({ userId: target })
    expect(await fact(source)).toMatchObject({ userId: target, completedAt: new Date('2026-09-09T10:00:00Z') })
    expect(await fact(repeat)).toMatchObject({ sourceSessionId: source, startedAt: new Date('2026-09-09T10:05:00Z') })
    const after = await report()
    expect(Number(after.sessions.repeatStarts) - Number(before.sessions.repeatStarts)).toBe(1)
    expect(Number(after.sessions.repeatCompletions) - Number(before.sessions.repeatCompletions)).toBe(1)
  })

  it('retains a deleted repeat episode and an incoming third episode without promoting either to the winner', async () => {
    const before = await report()
    const guest = await newUser()
    const target = await newUser(false)
    const sharedRepeat = await challenge()
    const source = await newSession(guest, { completedAt: '2026-09-09T10:00:00Z' })
    const repeat = await newSession(guest, { challengeId: sharedRepeat, sourceSessionId: source, startedAt: '2026-09-09T10:05:00Z', completedAt: '2026-09-09T10:10:00Z', lost: true, attempts: 10 })
    const third = await newSession(guest, { sourceSessionId: repeat, startedAt: '2026-09-09T10:15:00Z' })
    const winner = await newSession(target, { challengeId: sharedRepeat, startedAt: '2026-09-09T11:00:00Z', completedAt: '2026-09-09T12:00:00Z' })
    await mergeAnonymousAccount(database!.db, guest, target)
    expect(await live(repeat)).toBeUndefined()
    expect(await live(winner)).toMatchObject({ userId: target, sourceSessionId: null })
    expect(await fact(repeat)).toMatchObject({ userId: target, sourceSessionId: source, completionStatus: 'lost', completedAt: new Date('2026-09-09T10:10:00Z') })
    expect(await fact(third)).toMatchObject({ userId: target, sourceSessionId: repeat })
    expect((await fact(winner)).sourceSessionId).toBeNull()
    const after = await report()
    // Preserve the existing report definition: direct children of the first
    // measured completion, not every later link of a three-game chain.
    expect(Number(after.sessions.repeatStarts) - Number(before.sessions.repeatStarts)).toBe(1)
    expect(Number(after.sessions.repeatCompletions) - Number(before.sessions.repeatCompletions)).toBe(1)
  })

  it('captures completion once and never rewrites the original source, access or start', async () => {
    const owner = await newUser()
    const source = await newSession(owner, { completedAt: '2026-09-09T10:00:00Z' })
    const repeat = await newSession(owner, { sourceSessionId: source, startedAt: '2026-09-09T10:05:00Z' })
    expect(await fact(repeat)).toMatchObject({ completionStatus: null, completedAt: null, origin: 'live' })
    await database!.db.update(gameSessions).set({ status: 'won', completionType: 'direct_win', completedAt: new Date('2026-09-09T10:10:00Z') }).where(eq(gameSessions.id, repeat))
    await database!.db.update(gameSessions).set({
      status: 'lost', completionType: 'attempts_exhausted', completedAt: new Date('2026-09-09T12:00:00Z'),
      startedAt: new Date('2026-09-09T11:00:00Z'), sourceSessionId: null, accessSource: 'club', growthStage: 'club',
    }).where(eq(gameSessions.id, repeat))
    expect(await fact(repeat)).toMatchObject({
      sourceSessionId: source, startedAt: new Date('2026-09-09T10:05:00Z'),
      completedAt: new Date('2026-09-09T10:10:00Z'), completionStatus: 'won', accessSource: 'free_archive', growthStage: 'baseline',
    })

    const preExistingArchive = await newSession(owner, { kind: 'archive', startedAt: '2026-09-09T12:30:00Z' })
    await database!.db.update(gameSessions).set({ sourceSessionId: source, accessSource: 'free_archive', status: 'won', completionType: 'direct_win', completedAt: new Date('2026-09-09T13:00:00Z') }).where(eq(gameSessions.id, preExistingArchive))
    expect(await fact(preExistingArchive)).toMatchObject({ sourceSessionId: null, accessSource: null, completedAt: new Date('2026-09-09T13:00:00Z') })
  })

  it('excludes invalid chronology, other owners/modes, staff, private games and today from linked cohorts', async () => {
    const before = await report()
    const owner = await newUser()
    const foreign = await newUser()
    const admin = await newUser(true, true)
    const source = await newSession(owner, { completedAt: '2026-09-09T10:00:00Z' })
    await newSession(owner, { sourceSessionId: source, startedAt: '2026-09-09T09:59:00Z' })
    await newSession(foreign, { sourceSessionId: source, startedAt: '2026-09-09T10:01:00Z' })
    await newSession(owner, { mode: 'movie', sourceSessionId: source, startedAt: '2026-09-09T10:02:00Z' })
    await newSession(owner, { kind: 'pack', sourceSessionId: source, startedAt: '2026-09-09T10:03:00Z' })
    await newSession(owner, { sourceSessionId: source, startedAt: '2026-09-11T00:01:00Z' })
    const adminSource = await newSession(admin, { completedAt: '2026-09-09T10:00:00Z' })
    await newSession(admin, { sourceSessionId: adminSource, startedAt: '2026-09-09T10:04:00Z' })
    const after = await report()
    expect(Number(after.sessions.repeatStarts) - Number(before.sessions.repeatStarts)).toBe(0)
    expect(Number(after.sessions.repeatCompletions) - Number(before.sessions.repeatCompletions)).toBe(0)
  })

  it('keeps original facts for other game modes and removes them on ordinary owner deletion', async () => {
    const guest = await newUser()
    const target = await newUser(false)
    const source = await newSession(guest, { mode: 'movie', completedAt: '2026-09-09T10:00:00Z' })
    const repeat = await newSession(guest, { mode: 'movie', sourceSessionId: source, startedAt: '2026-09-09T10:05:00Z' })
    await mergeAnonymousAccount(database!.db, guest, target)
    expect(await fact(source)).toMatchObject({ userId: target, mode: 'movie' })
    expect(await fact(repeat)).toMatchObject({ userId: target, sourceSessionId: source, mode: 'movie' })
    // Existing application tables have their own deletion workflow. Once those
    // references are removed, the new historical facts must cascade with owner.
    await database!.db.delete(gameSessions).where(eq(gameSessions.userId, target))
    expect(await fact(source)).toBeDefined()
    await database!.db.execute(sql`delete from audit_log where actor_user_id=${target}::uuid`)
    await database!.db.execute(sql`delete from user_mode_stats where user_id=${target}::uuid`)
    await database!.db.execute(sql`delete from wallet_accounts where user_id=${target}::uuid`)
    await database!.db.delete(user).where(eq(user.id, target))
    expect(await fact(source)).toBeUndefined()
    expect(await fact(repeat)).toBeUndefined()
  })
})
