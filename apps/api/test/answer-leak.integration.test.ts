import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { buildApp } from '../src/app.js'
import { contentItemVersions, createDatabase, gameSessions } from '@shoditsa/database'

const forbiddenKeys = new Set(['answer', 'answerid', 'answeritemversionid', 'seed'])

const findLeak = (value: unknown, answerId: string, path = '$'): string | null => {
  if (typeof value === 'string' && value === answerId) return path
  if (!value || typeof value !== 'object') return null

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const leak = findLeak(value[index], answerId, `${path}[${index}]`)
      if (leak) return leak
    }
    return null
  }

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLowerCase())) return `${path}.${key}`
    const leak = findLeak(child, answerId, `${path}.${key}`)
    if (leak) return leak
  }

  return null
}

const expectNoLeak = (payload: unknown, answerId: string) => {
  expect(findLeak(payload, answerId)).toBeNull()
}

describe('unfinished game payload contract', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let cookie = ''
  let sessionId = ''
  let answerId = ''

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

    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/games/start',
      headers: { cookie },
      payload: { kind: 'daily', mode: 'movie', period: 'all', difficulty: null, archiveDate: null },
    })
    expect(start.statusCode).toBe(200)
    sessionId = start.json().session.id

    const database = createDatabase(loadConfig())
    try {
      const rows = await database.db
        .select({ answerId: contentItemVersions.itemId })
        .from(gameSessions)
        .innerJoin(contentItemVersions, eq(contentItemVersions.id, gameSessions.answerItemVersionId))
        .where(eq(gameSessions.id, sessionId))
        .limit(1)
      answerId = rows[0].answerId
    } finally {
      await database.client.end()
    }
  })

  afterAll(async () => {
    await app?.close()
  })

  it('does not leak answer in playing start/resume snapshots', async () => {
    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/games/start',
      headers: { cookie },
      payload: { kind: 'daily', mode: 'movie', period: 'all', difficulty: null, archiveDate: null },
    })
    expect(start.statusCode).toBe(200)
    expect(start.json().session.status).toBe('playing')
    expectNoLeak(start.json(), answerId)

    const resume = await app.inject({ method: 'GET', url: `/api/v1/games/${sessionId}`, headers: { cookie } })
    expect(resume.statusCode).toBe(200)
    expect(resume.json().session.status).toBe('playing')
    expectNoLeak(resume.json(), answerId)
  })

  it('does not leak answer in attempt response while session is playing', async () => {
    const search = await app.inject({
      method: 'GET',
      url: `/api/v1/catalog/search?mode=movie&q=а&sessionId=${sessionId}&limit=20`,
      headers: { cookie },
    })
    expect(search.statusCode).toBe(200)

    const wrong = search
      .json()
      .items
      .find((entry: { id: string }) => entry.id !== answerId)

    expect(wrong).toBeDefined()

    const attempt = await app.inject({
      method: 'POST',
      url: `/api/v1/games/${sessionId}/attempts`,
      headers: { cookie, 'idempotency-key': crypto.randomUUID() },
      payload: { itemId: wrong.id },
    })

    expect(attempt.statusCode).toBe(200)
    expect(attempt.json().session.status).toBe('playing')
    expectNoLeak(attempt.json(), answerId)
  })

  it('reveals answer only after terminal state', async () => {
    const finalAttempt = await app.inject({
      method: 'POST',
      url: `/api/v1/games/${sessionId}/attempts`,
      headers: { cookie, 'idempotency-key': crypto.randomUUID() },
      payload: { itemId: answerId },
    })

    expect(finalAttempt.statusCode).toBe(200)
    expect(finalAttempt.json().session.status).toBe('won')
    expect(finalAttempt.json().answer.id).toBe(answerId)
  })
})
