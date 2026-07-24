import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { loadConfig, type AppConfig } from '@shoditsa/config'
import { createDatabase, user } from '@shoditsa/database'
import { buildApp } from '../src/app.js'
import { REGISTRATION_REFERRAL_HEADER } from '../src/modules/users/badges.js'

const requestOrigin = 'http://localhost:5173'

const responseCookie = (headers: Record<string, unknown>) => {
  const raw = headers['set-cookie']
  const values = Array.isArray(raw) ? raw : raw ? [raw] : []
  return values.map((value) => String(value).split(';')[0]).join('; ')
}

describe('registration badges', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let database: ReturnType<typeof createDatabase>
  let config: AppConfig
  const createdEmails: string[] = []

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET ||= 'user-badges-secret-at-least-32-characters'
    process.env.BETTER_AUTH_URL ||= 'http://localhost:3001'
    process.env.TRUSTED_ORIGINS ||= requestOrigin
    process.env.PROMO_CODE_PEPPER ||= 'user-badges-pepper-at-least-32-characters'
    config = Object.freeze({
      ...loadConfig(),
      authEmailEnabled: true,
      smtp: { host: '', port: 587, user: '', password: '', from: '' },
    })
    database = createDatabase(config)
    app = await buildApp({ config, db: database.db })
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    if (createdEmails.length) await database?.db.delete(user).where(inArray(user.email, createdEmails))
    await database?.client.end()
  })

  const signUp = async (referral?: string) => {
    const email = `badge-${crypto.randomUUID()}@example.test`
    createdEmails.push(email)
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: {
        origin: requestOrigin,
        ...(referral ? { [REGISTRATION_REFERRAL_HEADER]: referral } : {}),
      },
      payload: { name: 'Badge Test', email, password: 'Strong-password-123' },
    })
    expect(response.statusCode, response.body).toBe(200)
    return {
      email,
      cookie: responseCookie(response.headers),
    }
  }

  const me = async (cookie: string) => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })
    expect(response.statusCode, response.body).toBe(200)
    return response.json()
  }

  it('awards DTF only when a new account is created through the DTF referral', async () => {
    const invited = await signUp('dtf')
    expect((await me(invited.cookie)).badges).toEqual([
      expect.objectContaining({
        key: 'dtf',
        shortLabel: 'DTF',
        description: 'Участник сообщества DTF',
        styleKey: 'dtf',
      }),
    ])

    const regular = await signUp()
    expect((await me(regular.cookie)).badges).toEqual([])

    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: requestOrigin, [REGISTRATION_REFERRAL_HEADER]: 'dtf' },
      payload: { email: regular.email, password: 'Strong-password-123' },
    })
    expect(signIn.statusCode, signIn.body).toBe(200)
    expect((await me(responseCookie(signIn.headers))).badges).toEqual([])
  })
})
