import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOAuthState } from 'better-auth/api'
import type { Database } from '@shoditsa/database'
import { authAnalyticsEventId, createAuthAnalytics, parseAuthAcquisition, withOAuthAcquisition } from '../src/modules/auth/analytics.js'

vi.mock('better-auth/api', () => ({ getOAuthState: vi.fn() }))
const USER = '10000000-0000-4000-8000-000000000001'
const SESSION = '10000000-0000-4000-8000-000000000002'
const ACQUISITION = '10000000-0000-4000-8000-000000000003'
const at = new Date('2026-09-03T08:00:00Z')
const header = JSON.stringify({ acquisition_id: ACQUISITION, entry_source: 'organic_search', entry_search_engine: 'google', entry_path: '/games/diagnosis', entry_referrer_host: 'www.google.com' })
const context = (path: string, acquisition: string | null = header) => ({
  path, getHeader: (name: string) => name === 'x-shoditsa-acquisition' ? acquisition : 'request-test',
  context: { logger: { error: vi.fn() } },
})
const fakeDb = (anonymous = false) => {
  const saved = new Map<string, Record<string, unknown>>()
  const insert = vi.fn(() => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: async () => {
    if (!saved.has(value.id as string)) saved.set(value.id as string, value)
  } }) }))
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [{ isAnonymous: anonymous }] }) }) }))
  const update = vi.fn(() => ({ set: (value: Record<string, unknown>) => ({ where: () => ({ returning: async () => {
    const row = saved.get(authAnalyticsEventId('sign_up', USER))
    if (!row || row.authSessionId) return []
    Object.assign(row, value)
    return [{ id: row.id }]
  } }) }) }))
  return { saved, insert, db: { insert, select, update } as unknown as Database }
}

describe('server auth analytics', () => {
  beforeEach(() => { vi.mocked(getOAuthState).mockReset().mockResolvedValue(null) })

  it('keeps only safe consented acquisition data in verified OAuth state', () => {
    const body = withOAuthAcquisition({ providerId: 'yandex', additionalData: { shoditsaAcquisition: header } }, undefined)
    expect(body.additionalData.shoditsaAcquisition).toBeNull()
    const safe = withOAuthAcquisition({ providerId: 'yandex' }, header)
    expect(parseAuthAcquisition(safe.additionalData.shoditsaAcquisition)).toMatchObject({ acquisitionId: ACQUISITION, searchEngine: 'google', entryPath: '/games/diagnosis' })
    for (const invalid of ['null', '[]', '{', header.replace('/games/diagnosis', '/login?token=private'), header.replace('/games/diagnosis', '//external.test')]) {
      expect(parseAuthAcquisition(invalid)).toBeNull()
    }
  })

  it.each(['/sign-up/email', '/oauth2/callback/yandex'])('counts actual creation once, not a second login, for %s', async (path) => {
    const { db, saved } = fakeDb()
    vi.mocked(getOAuthState).mockResolvedValue({ shoditsaAcquisition: header } as never)
    const analytics = createAuthAnalytics(db)
    const ctx = context(path)
    await analytics.userCreated({ id: USER, createdAt: at }, ctx)
    await analytics.userCreated({ id: USER, createdAt: at }, ctx)
    await analytics.sessionCreated({ id: SESSION, userId: USER, createdAt: at }, ctx)
    await analytics.sessionCreated({ id: SESSION, userId: USER, createdAt: at }, ctx)
    expect(saved.size).toBe(1)
    expect([...saved.values()][0]).toMatchObject({ eventName: 'sign_up', result: 'success', userId: USER, authSessionId: SESSION, acquisitionId: ACQUISITION, occurredAt: at })
  })

  it('counts an existing OAuth account as sign_in and uses the verified state, not callback headers', async () => {
    const { db, saved } = fakeDb()
    vi.mocked(getOAuthState).mockResolvedValue({ shoditsaAcquisition: header } as never)
    const analytics = createAuthAnalytics(db)
    await analytics.sessionCreated({ id: SESSION, userId: USER, createdAt: at }, context('/oauth2/callback/yandex', null))
    await analytics.sessionCreated({ id: SESSION, userId: USER, createdAt: at }, context('/oauth2/callback/yandex', null))
    expect(saved.size).toBe(1)
    expect([...saved.values()][0]).toMatchObject({ eventName: 'sign_in', authSessionId: SESSION, acquisitionId: ACQUISITION })
  })

  it('keeps signup without a session for pending email verification, then binds the first verified session', async () => {
    const { db, saved } = fakeDb()
    const analytics = createAuthAnalytics(db)
    await analytics.userCreated({ id: USER, createdAt: at }, context('/sign-up/email'))
    expect([...saved.values()][0]?.authSessionId).toBeUndefined()
    await analytics.sessionCreated({ id: SESSION, userId: USER, createdAt: at }, context('/verify-email', null))
    expect(saved.size).toBe(1)
    expect([...saved.values()][0]).toMatchObject({ eventName: 'sign_up', authSessionId: SESSION })
  })

  it('does not invent direct attribution or include anonymous accounts', async () => {
    const real = fakeDb()
    await createAuthAnalytics(real.db).userCreated({ id: USER, createdAt: at }, context('/sign-up/email', null))
    expect([...real.saved.values()][0]).not.toHaveProperty('entrySource')
    const guest = fakeDb(true)
    const analytics = createAuthAnalytics(guest.db)
    await analytics.userCreated({ id: USER, createdAt: at, isAnonymous: true }, context('/sign-in/anonymous'))
    await analytics.sessionCreated({ id: SESSION, userId: USER, createdAt: at }, context('/sign-in/anonymous'))
    expect(guest.saved.size).toBe(0)
  })

  it('retains the actual account when OAuth acquisition cannot be read', async () => {
    const { db, saved } = fakeDb()
    vi.mocked(getOAuthState).mockRejectedValue(new Error('request state unavailable'))
    const analytics = createAuthAnalytics(db)
    const ctx = context('/oauth2/callback/yandex', null)
    await expect(analytics.beforeCreate({}, ctx)).resolves.toBeUndefined()
    await expect(analytics.userCreated({ id: USER, createdAt: at }, ctx)).resolves.toBeUndefined()
    await expect(analytics.sessionCreated({ id: SESSION, userId: USER, createdAt: at }, ctx)).resolves.toBeUndefined()
    expect(saved.size).toBe(1)
    expect([...saved.values()][0]).toMatchObject({ eventName: 'sign_up', authSessionId: SESSION })
    expect([...saved.values()][0]).not.toHaveProperty('entrySource')
    expect(ctx.context.logger.error).toHaveBeenCalledTimes(1)
  })

  it('does not break authentication or disclose payloads when the analytics write fails', async () => {
    const { db, insert } = fakeDb()
    insert.mockImplementationOnce(() => { throw new Error('private database payload') })
    const ctx = context('/sign-up/email')
    await expect(createAuthAnalytics(db).userCreated({ id: USER, createdAt: at }, ctx)).resolves.toBeUndefined()
    expect(ctx.context.logger.error).toHaveBeenCalledWith('AUTH_ANALYTICS_WRITE_FAILED action=sign_up')
  })
})
