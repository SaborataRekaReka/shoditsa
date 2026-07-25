import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  contentItemVersions,
  contentRevisions,
  createDatabase,
  gameFinalChoices,
  gameSessions,
  userModeStats,
} from '@shoditsa/database'
import type { FinalChoiceSnapshot, TitleItem } from '@shoditsa/contracts'
import { buildApp } from '../src/app.js'
import { getMoscowDate } from '../src/lib/time.js'

describe('game final choice API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let cookie = ''
  let userId = ''
  let database: ReturnType<typeof createDatabase>
  let versions: Array<{ id: string; itemId: string; revisionId: string; payload: TitleItem }> = []

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET ||= 'integration-secret-at-least-32-characters'
    process.env.BETTER_AUTH_URL ||= 'http://localhost:3001'
    process.env.TRUSTED_ORIGINS ||= 'http://localhost:5173'
    process.env.PROMO_CODE_PEPPER ||= 'integration-pepper-at-least-32-characters'
    process.env.AUTH_EMAIL_ENABLED = 'false'
    const config = loadConfig()
    app = await buildApp({ config })
    await app.ready()
    const guest = await app.inject({ method: 'POST', url: '/api/v1/auth/guest' })
    const cookies = guest.headers['set-cookie']
    cookie = (Array.isArray(cookies) ? cookies : [cookies]).filter(Boolean).map((value) => String(value).split(';')[0]).join('; ')
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })
    userId = me.json().user.id
    database = createDatabase(config)
    const active = (await database.db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
    versions = await database.db.select({
      id: contentItemVersions.id,
      itemId: contentItemVersions.itemId,
      revisionId: contentItemVersions.revisionId,
      payload: contentItemVersions.payload,
    }).from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, active.id),
      eq(contentItemVersions.mode, 'movie'),
      eq(contentItemVersions.allowedInGame, true),
    )).limit(4) as typeof versions
    expect(versions).toHaveLength(4)
  })

  afterAll(async () => {
    await database?.client.end()
    await app?.close()
  })

  const createFinalSession = async () => {
    const answer = versions[0]
    const candidates = versions.map((version) => {
      const item = version.payload
      return {
        item: {
          id: item.id,
          titleRu: item.titleRu,
          ...(item.titleOriginal ? { titleOriginal: item.titleOriginal } : {}),
          ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
        },
        primaryMeta: String(item.year ?? '—'),
        facts: [
          { key: 'countries', value: item.countries?.slice(0, 2).join(' · ') || 'Нет данных', ariaLabel: `Страны: ${item.countries?.join(', ') || 'нет данных'}` },
          { key: 'genres', value: item.genres?.slice(0, 2).join(' · ') || 'Нет данных', ariaLabel: `Жанры: ${item.genres?.join(', ') || 'нет данных'}` },
          { key: 'runtime_rating', value: item.runtimeMinutes ? `${item.runtimeMinutes} мин` : 'Нет данных', ariaLabel: `Хронометраж: ${item.runtimeMinutes ?? 'нет данных'}` },
        ],
      }
    }) as FinalChoiceSnapshot['candidates']
    const session = (await database.db.insert(gameSessions).values({
      userId,
      kind: 'daily',
      mode: 'movie',
      period: 'all',
      puzzleDate: getMoscowDate(),
      revisionId: answer.revisionId,
      answerItemVersionId: answer.id,
      status: 'final_choice',
      attemptsCount: 10,
      rulesVersion: 3,
    }).returning())[0]
    const snapshot: FinalChoiceSnapshot = {
      candidates,
      displayKeys: ['countries', 'genres', 'runtime_rating'],
      choicesRemaining: 1,
    }
    await database.db.insert(gameFinalChoices).values({
      sessionId: session.id,
      candidateItemVersionIds: versions.map((version) => version.id),
      displayKeys: snapshot.displayKeys,
      candidateSnapshot: snapshot,
      generationSource: 'runtime',
      algorithmVersion: 1,
    })
    return { session, snapshot, answer }
  }

  it('resolves a correct choice once and replays the same idempotency key', async () => {
    const fixture = await createFinalSession()
    const key = crypto.randomUUID()
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/games/${fixture.session.id}/final-choice`,
      headers: { cookie, 'idempotency-key': key },
      payload: { action: 'choose', itemId: fixture.answer.itemId },
    })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({
      session: { status: 'won', attemptsCount: 10, attemptsRemaining: 0, completionType: 'final_choice_win' },
      selectedItemId: fixture.answer.itemId,
      correct: true,
    })
    expect(first.json().reward.components).toMatchObject({ completion: 0, win: 0, efficiency: 0, finalChoiceWin: 5 })

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/games/${fixture.session.id}/final-choice`,
      headers: { cookie, 'idempotency-key': key },
      payload: { action: 'choose', itemId: fixture.answer.itemId },
    })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toEqual(first.json())

    const conflicting = await app.inject({
      method: 'POST',
      url: `/api/v1/games/${fixture.session.id}/final-choice`,
      headers: { cookie, 'idempotency-key': crypto.randomUUID() },
      payload: { action: 'reveal' },
    })
    expect(conflicting.statusCode).toBe(409)
    expect(conflicting.json().error.code).toBe('GAME_FINAL_CHOICE_ALREADY_RESOLVED')

    const stats = (await database.db.select().from(userModeStats).where(and(
      eq(userModeStats.userId, userId),
      eq(userModeStats.mode, 'movie'),
    )).limit(1))[0]
    expect(stats).toMatchObject({ played: 1, won: 1, finalChoiceWins: 1 })
    expect(stats.distribution).toEqual(Array(10).fill(0))
  })

  it('rejects an item outside the snapshot and supports reveal', async () => {
    const invalidFixture = await createFinalSession()
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/games/${invalidFixture.session.id}/final-choice`,
      headers: { cookie, 'idempotency-key': crypto.randomUUID() },
      payload: { action: 'choose', itemId: 'outside-the-four' },
    })
    expect(invalid.statusCode).toBe(422)
    expect(invalid.json().error.code).toBe('GAME_FINAL_CHOICE_INVALID_CANDIDATE')

    const revealed = await app.inject({
      method: 'POST',
      url: `/api/v1/games/${invalidFixture.session.id}/final-choice`,
      headers: { cookie, 'idempotency-key': crypto.randomUUID() },
      payload: { action: 'reveal' },
    })
    expect(revealed.statusCode).toBe(200)
    expect(revealed.json()).toMatchObject({
      session: { status: 'lost', completionType: 'answer_revealed' },
      selectedItemId: null,
      correct: false,
    })
    expect(revealed.json().reward.components).toMatchObject({ completion: 0, win: 0, finalChoiceWin: 0 })
  })
})
