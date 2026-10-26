import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { contentItemVersions, createDatabase, gameSessions, wordActions, wordSessionState } from '@shoditsa/database'
import { isPlayableModeId, type WordActionBody } from '@shoditsa/contracts'
import { buildApp } from '../src/app.js'
import { applyWordAction, getWordSession, startWordSession } from '../src/modules/word/service.js'
import { readWordPack } from '../src/modules/word/runtime.js'

describe('semantic words with real immutable ranks and PostgreSQL', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let database: ReturnType<typeof createDatabase>
  let userId: string
  let cookie: string
  let sessionId: string
  let answer: string
  let guesses: string[]
  let snapshot: Awaited<ReturnType<typeof getWordSession>>
  let firstKey: string
  let firstResponse: Awaited<ReturnType<typeof applyWordAction>>
  const config = loadConfig()
  const act = (body: WordActionBody, key: string = crypto.randomUUID()) => applyWordAction(database.db, userId, sessionId, body, key)
  beforeAll(async () => {
    if (config.production || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.databaseUrl).hostname)) throw new Error('Requires isolated local PostgreSQL')
    database = createDatabase(config)
    app = await buildApp({ config })
    await app.ready()
    const guest = await app.inject({ method: 'POST', url: '/api/v1/auth/guest' })
    expect(guest.statusCode).toBe(200)
    cookie = [guest.headers['set-cookie']].flat().filter(Boolean).map(value => String(value).split(';')[0]).join('; ')
    userId = (await app.inject({ url: '/api/v1/me', headers: { cookie } })).json().user.id
    const sessions = await Promise.all([0, 1].map(() => startWordSession(database.db, userId, { kind: 'daily' }, null, 'admin', config)))
    expect(sessions[0].id).toBe(sessions[1].id)
    snapshot = sessions[0]
    sessionId = snapshot.id
    const [version] = await database.db.select({ payload: contentItemVersions.payload }).from(gameSessions).innerJoin(contentItemVersions, eq(contentItemVersions.id, gameSessions.answerItemVersionId)).where(eq(gameSessions.id, sessionId))
    const payload = version.payload as { titleRu: string; semanticDatasetHash: string; semanticWordKey: string }
    answer = payload.titleRu
    const pack = await readWordPack(payload.semanticDatasetHash)
    guesses = pack.words.filter((_, index) => pack.rank(payload.semanticWordKey, index) > 2000).slice(0, 17)
  })
  afterAll(async () => { await app?.close(); await database?.client.end() })
  it('hides the answer and exact dataset from snapshots and public cards', async () => {
    expect(JSON.stringify(snapshot)).not.toMatch(/semanticDatasetHash|semanticWordKey|answerItemVersionId|"answer"/)
    expect(snapshot.word.unlimitedAttempts).toBe(true)
    const card = await app.inject({ url: `/api/v1/catalog/items/${encodeURIComponent(`word:${answer.replaceAll('ё', 'е')}`)}`, headers: { cookie } })
    expect(card.statusCode).toBe(404)
  })
  it('protects ownership, does not consume unknown input, and keeps hints locked', async () => {
    await expect(getWordSession(database.db, crypto.randomUUID(), sessionId)).rejects.toMatchObject({ statusCode: 404 })
    await expect(act({ action: 'guess', word: 'not-a-word' })).rejects.toMatchObject({ code: 'WORD_NOT_IN_DICTIONARY' })
    await expect(act({ action: 'hint' })).rejects.toMatchObject({ code: 'WORD_HINT_UNAVAILABLE' })
    expect((await getWordSession(database.db, userId, sessionId)).attemptsCount).toBe(0)
  })
  it('serializes concurrent retries and recognizes duplicate input', async () => {
    const key = crypto.randomUUID()
    const responses = await Promise.all([act({ action: 'guess', word: guesses[0] }, key), act({ action: 'guess', word: guesses[0] }, key)])
    firstKey = key
    firstResponse = responses[0]
    expect(responses[0]).toEqual(responses[1])
    expect(responses[0].session.attemptsCount).toBe(1)
    await expect(act({ action: 'guess', word: guesses[1] }, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect((await act({ action: 'guess', word: `  ${guesses[0].toUpperCase()}  ` })).result).toBe('duplicate')
    expect((await getWordSession(database.db, userId, sessionId)).attemptsCount).toBe(1)
  })
  it('allows more than ten attempts, offers three closer hints and survives reload', async () => {
    for (const word of guesses.slice(1, 5)) await act({ action: 'guess', word })
    let state = await getWordSession(database.db, userId, sessionId)
    expect(state.word.hintAvailable).toBe(true)
    const first = await act({ action: 'hint' })
    expect(first.session.word.guesses.at(-1)!.rank).toBeLessThan(state.word.bestRank!)
    expect(first.session.word.guesses.at(-1)!.rank).toBeGreaterThan(1)
    expect(first.session.attemptsCount).toBe(5)
    for (const word of guesses.slice(5, 10)) await act({ action: 'guess', word })
    await act({ action: 'hint' })
    for (const word of guesses.slice(10, 16)) await act({ action: 'guess', word })
    state = (await act({ action: 'hint' })).session
    expect(state.attemptsCount).toBe(16)
    expect(state.word.hintsUsed).toBe(3)
    expect(state.word.answer).toBeUndefined()
    await expect(act({ action: 'hint' })).rejects.toMatchObject({ code: 'WORD_HINT_UNAVAILABLE' })
    const reload = await app.inject({ url: `/api/v1/games/${sessionId}`, headers: { cookie } })
    expect(reload.statusCode).toBe(200)
    expect(reload.json().session.word).toEqual(state.word)
  })
  it('wins once, replays the reward once, resumes terminal daily and validates dates', async () => {
    const key = crypto.randomUUID()
    const response = await act({ action: 'guess', word: answer.replaceAll('ё', 'е') }, key)
    expect(response.result).toBe('won')
    expect(response.session.word.answer).toBe(answer)
    expect(response.session.word.bestRank).toBe(1)
    expect(await act({ action: 'guess', word: answer.replaceAll('ё', 'е') }, key)).toEqual(response)
    const oldReplay = await act({ action: 'guess', word: guesses[0] }, firstKey)
    expect(oldReplay).toEqual(firstResponse)
    expect(oldReplay.session.word.answer).toBeUndefined()
    expect(oldReplay.session.word.guesses).toHaveLength(1)
    const journal = await database.db.select({ snapshot: wordActions.responseSnapshot }).from(wordActions).where(eq(wordActions.sessionId, sessionId))
    expect(journal.every(row => (row.snapshot as { response: { session: { word: { guesses: unknown[] } } } }).response.session.word.guesses.length === 0)).toBe(true)
    await expect(act({ action: 'give_up' })).rejects.toMatchObject({ code: 'GAME_ALREADY_FINISHED' })
    const resumed = await startWordSession(database.db, userId, { kind: 'daily' }, null, 'admin', config)
    expect(resumed.id).toBe(sessionId)
    expect(resumed.status).toBe('won')
    for (const archiveDate of ['2026-10-25', '2099-01-01', '2026-99-99']) await expect(startWordSession(database.db, userId, { kind: 'archive', archiveDate }, null, 'admin', config)).rejects.toMatchObject({ code: 'WORD_DATE_UNAVAILABLE' })
  })
  it('serves actions through the authenticated route and reveals only after giving up', async () => {
    const second = await app.inject({ method: 'POST', url: '/api/v1/auth/guest' })
    const otherCookie = [second.headers['set-cookie']].flat().filter(Boolean).map(value => String(value).split(';')[0]).join('; ')
    const otherId = (await app.inject({ url: '/api/v1/me', headers: { cookie: otherCookie } })).json().user.id
    const other = await startWordSession(database.db, otherId, { kind: 'daily' }, null, 'admin', config)
    expect(other.word.answer).toBeUndefined()
    const denied = await app.inject({ method: 'POST', url: `/api/v1/word/sessions/${other.id}/actions`, headers: { cookie, 'idempotency-key': crypto.randomUUID() }, payload: { action: 'give_up' } })
    expect(denied.statusCode).toBe(404)
    const response = await app.inject({ method: 'POST', url: `/api/v1/word/sessions/${other.id}/actions`, headers: { cookie: otherCookie, 'idempotency-key': crypto.randomUUID() }, payload: { action: 'give_up' } })
    expect(response.statusCode).toBe(200)
    expect(response.json().session.word.answer).toBe(answer)
    expect(response.json().session.status).toBe('lost')
    const state = await database.db.select().from(wordSessionState).where(and(eq(wordSessionState.sessionId, other.id)))
    expect(state[0].guesses).toEqual([])
    if (isPlayableModeId('word')) {
      const publicStart = await app.inject({ method: 'POST', url: '/api/v1/games/start', headers: { cookie, 'idempotency-key': crypto.randomUUID() }, payload: { kind: 'daily', mode: 'word', period: 'all' } })
      expect(publicStart.statusCode).toBe(200)
    }
  })
})
