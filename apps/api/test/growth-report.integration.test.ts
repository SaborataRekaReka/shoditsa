import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import type { GrowthReport } from '@shoditsa/contracts'
import { contentItemVersions, createDatabase, gameSessions, playerProfiles, user } from '@shoditsa/database'
import { growthReport } from '../src/modules/growth/service.js'

describe('linked repeat report definitions (isolated PostgreSQL fixtures)', () => {
  let database: ReturnType<typeof createDatabase> | undefined
  let before: GrowthReport
  const users = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  const firstFreeArchive = '2026-09-10T13:00:00.000Z'
  const report = (days = 7) => growthReport(database!.db, days) as Promise<GrowthReport>

  beforeAll(async () => {
    const config = loadConfig()
    if (config.production || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.databaseUrl).hostname)) {
      throw new Error('Growth report integration tests require a local, non-production PostgreSQL database')
    }
    database = createDatabase(config)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'))
    before = await report()
    const item = (await database.db.select().from(contentItemVersions).where(eq(contentItemVersions.mode, 'diagnosis')).limit(1))[0]
    if (!item) throw new Error('Seed the local test database with Diagnosis content before running this test')
    await database.db.insert(user).values(users.map((id) => ({ id, name: 'Report QA', email: `${id}@example.test`, isAnonymous: true })))
    await database.db.insert(playerProfiles).values(users.map((userId, index) => ({ userId, role: index === 2 ? 'admin' as const : 'player' as const })))
    const insertSession = async (userId: string, startedAt: string, options: {
      sourceSessionId?: string; accessSource?: string | null; completedAt?: string; mode?: 'diagnosis' | 'movie'
    } = {}) => {
      const id = crypto.randomUUID()
      await database!.db.insert(gameSessions).values({
        id, userId, kind: options.sourceSessionId ? 'archive' : 'daily', mode: options.mode ?? 'diagnosis',
        period: 'all', puzzleDate: startedAt.slice(0, 10), revisionId: item.revisionId,
        answerItemVersionId: item.id, rulesVersion: 1, startedAt: new Date(startedAt),
        sourceSessionId: options.sourceSessionId, accessSource: options.accessSource,
        status: options.completedAt ? 'won' : 'playing', completionType: options.completedAt ? 'direct_win' : null,
        completedAt: options.completedAt ? new Date(options.completedAt) : null,
      })
      return id
    }
    const source = await insertSession(users[0], '2026-09-09T10:00:00Z', { completedAt: '2026-09-09T11:00:00Z' })
    await insertSession(users[1], '2026-09-10T08:00:00Z', { completedAt: '2026-09-10T09:00:00Z' })
    for (const [hour, accessSource, finished] of [
      [10, 'tickets', true], [11, 'club', false], [12, 'registration_bonus', true],
      [13, 'free_archive', true], [14, null, false], [15, 'free_archive', false],
    ] as const) {
      await insertSession(users[0], `2026-09-10T${hour}:00:00Z`, {
        sourceSessionId: source, accessSource,
        ...(finished ? { completedAt: `2026-09-10T${hour}:30:00Z` } : {}),
      })
    }
    // Staff, other modes and the incomplete current UTC day must not enter the cohort or first-observed date.
    const adminSource = await insertSession(users[2], '2026-09-09T10:00:00Z', { completedAt: '2026-09-09T11:00:00Z' })
    await insertSession(users[2], '2026-09-09T12:00:00Z', { sourceSessionId: adminSource, accessSource: 'free_archive' })
    await insertSession(users[0], '2026-09-08T12:00:00Z', { accessSource: 'free_archive', mode: 'movie' })
    await insertSession(users[0], '2026-09-11T01:00:00Z', { sourceSessionId: source, accessSource: 'free_archive' })
  })

  afterAll(async () => {
    vi.useRealTimers()
    if (!database) return
    try {
      await database.db.delete(gameSessions).where(inArray(gameSessions.userId, users))
      await database.db.delete(playerProfiles).where(inArray(playerProfiles.userId, users))
      await database.db.delete(user).where(inArray(user.id, users))
    } finally { await database.client.end() }
  })

  it('versions the definitions without moving the original September 8 measurement boundary', async () => {
    const result = await report()
    expect(result.measurement).toEqual({
      from: '2026-09-08T00:00:00.000Z', coverage: 'partial',
      definitionsVersion: 'linked-repeat-v2-free-archive', offerVisibilityVersion: 'visible-v2',
      freeArchiveFirstObservedAt: before.measurement.freeArchiveFirstObservedAt && before.measurement.freeArchiveFirstObservedAt < firstFreeArchive
        ? before.measurement.freeArchiveFirstObservedAt : firstFreeArchive,
    })
    expect(JSON.stringify(result)).not.toMatch(/example\.test|Report QA/)
  })

  it('breaks down exactly the existing cohort; unknown stays explicit and unique completers are not additive', async () => {
    const result = await report()
    expect(result.sessions.completions - before.sessions.completions).toBe(5)
    expect(result.sessions.firstCompleters - before.sessions.firstCompleters).toBe(2)
    expect(result.sessions.measuredCompleters! - before.sessions.measuredCompleters!).toBe(2)
    expect(result.sessions.repeatStarts! - before.sessions.repeatStarts!).toBe(6)
    expect(result.sessions.repeatCompletions! - before.sessions.repeatCompletions!).toBe(3)
    expect(result.sessions.repeatingCompleters! - before.sessions.repeatingCompleters!).toBe(1)
    const rows = result.sessions.repeatByAccessSource!
    expect(rows.reduce((sum, row) => sum + row.repeatStarts, 0)).toBe(result.sessions.repeatStarts)
    expect(rows.reduce((sum, row) => sum + row.repeatCompletions, 0)).toBe(result.sessions.repeatCompletions)
    for (const [accessSource, starts, completions] of [
      ['tickets', 1, 1], ['club', 1, 0], ['registration_bonus', 1, 1], ['free_archive', 2, 1], ['unknown', 1, 0],
    ] as const) {
      const row = rows.find((row) => row.accessSource === accessSource)!
      const old = before.sessions.repeatByAccessSource!.find((row) => row.accessSource === accessSource)
      expect(row.repeatStarts - (old?.repeatStarts ?? 0)).toBe(starts)
      expect(row.repeatCompletions - (old?.repeatCompletions ?? 0)).toBe(completions)
      expect(row.repeatingCompleters - (old?.repeatingCompleters ?? 0)).toBe(1)
    }
  })

  it('keeps the first observed free-archive date when it falls outside the selected activity window', async () => {
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'))
    try {
      const result = await report()
      expect(result.period.from).toBe('2026-09-13T00:00:00.000Z')
      expect(result.measurement.freeArchiveFirstObservedAt).toBe(before.measurement.freeArchiveFirstObservedAt && before.measurement.freeArchiveFirstObservedAt < firstFreeArchive
        ? before.measurement.freeArchiveFirstObservedAt : firstFreeArchive)
    } finally { vi.setSystemTime(new Date('2026-09-11T12:00:00Z')) }
  })

  it('returns null, not an empty or zero breakdown, before linkage measurement began', async () => {
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'))
    try {
      const result = await report()
      expect(result.measurement).toMatchObject({ coverage: 'not_started', freeArchiveFirstObservedAt: null })
      expect(result.sessions).toMatchObject({ measuredCompleters: null, repeatStarts: null, repeatCompletions: null, repeatingCompleters: null, repeatByAccessSource: null })
    } finally { vi.setSystemTime(new Date('2026-09-11T12:00:00Z')) }
  })
})
