import { describe, expect, it } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '@shoditsa/database'
import { createAuthAnalytics, withOAuthAcquisition } from '../src/modules/auth/analytics.js'

describe('actual Better Auth callback lifecycle without network or a database service', () => {
  it('carries acquisition through verified OAuth state and separates a new account from its later login', async () => {
    const memory: Record<string, Array<Record<string, unknown>>> = { user: [], session: [], account: [], verification: [] }
    const events = new Map<string, Record<string, unknown>>()
    const dialect = new PgDialect()
    const db = {
      insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: async () => {
        if (!events.has(String(value.id))) events.set(String(value.id), value)
      } }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ isAnonymous: false }] }) }) }),
      update: () => ({ set: (value: Record<string, unknown>) => ({ where: (condition: Parameters<PgDialect['sqlToQuery']>[0]) => ({ returning: async () => {
        const id = String(dialect.sqlToQuery(condition).params[0])
        const event = events.get(id)
        if (!event || event.authSessionId) return []
        Object.assign(event, value)
        return [{ id }]
      } }) }) }),
    } as unknown as Database
    const analytics = createAuthAnalytics(db)
    const auth = betterAuth({
      baseURL: 'http://localhost:3001', basePath: '/api/auth',
      secret: 'fixture-only-secret-not-a-production-credential',
      trustedOrigins: ['http://localhost:5173'],
      database: memoryAdapter(memory),
      advanced: { database: { generateId: 'uuid' } },
      databaseHooks: {
        user: { create: { before: analytics.beforeCreate, after: analytics.userCreated } },
        session: { create: { before: analytics.beforeCreate, after: analytics.sessionCreated } },
      },
      plugins: [genericOAuth({ config: [{
        providerId: 'fixture-provider', clientId: 'fixture-client', clientSecret: 'fixture-secret',
        authorizationUrl: 'https://oauth.example.test/authorize', tokenUrl: 'https://oauth.example.test/token',
        getToken: async () => ({ accessToken: 'fixture-token', scopes: [], accessTokenExpiresAt: new Date(Date.now() + 60_000) }),
        getUserInfo: async () => ({ id: 'fixture-provider-user', name: 'Fixture', email: 'fixture@example.test', emailVerified: true }),
      }] })],
    })
    const flow = async (acquisition?: string) => {
      const start = await auth.handler(new Request('http://localhost:3001/api/auth/sign-in/oauth2', {
        method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify(withOAuthAcquisition({ providerId: 'fixture-provider', callbackURL: 'http://localhost:5173/login' }, acquisition)),
      }))
      expect(start.status).toBe(200)
      const payload = await start.json() as { url: string }
      const state = new URL(payload.url).searchParams.get('state')!
      const cookies = start.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
      const callback = await auth.handler(new Request(`http://localhost:3001/api/auth/oauth2/callback/fixture-provider?code=fixture&state=${encodeURIComponent(state)}`, { headers: { cookie: cookies } }))
      expect(callback.status).toBe(302)
      expect(callback.headers.get('location')).toBe('http://localhost:5173/login')
    }

    await flow(JSON.stringify({ acquisition_id: '10000000-0000-4000-8000-000000000003', entry_source: 'organic_search', entry_search_engine: 'google', entry_path: '/games/diagnosis' }))
    expect(memory.user).toHaveLength(1)
    expect(events.size).toBe(1)
    expect([...events.values()][0]).toMatchObject({ eventName: 'sign_up', acquisitionId: '10000000-0000-4000-8000-000000000003', authSessionId: expect.any(String) })

    await flow()
    expect(memory.user).toHaveLength(1)
    expect(events.size).toBe(2)
    const login = [...events.values()].find((event) => event.eventName === 'sign_in')
    expect(login).toMatchObject({ result: 'success', authSessionId: expect.any(String) })
    expect(login).not.toHaveProperty('entrySource')
  })
})
