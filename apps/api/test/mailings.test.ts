import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { createDatabase } from '@shoditsa/database'
import type { Auth } from '../src/modules/auth/auth.js'
import { sendError } from '../src/lib/errors.js'
import { registerMailingRoutes } from '../src/modules/mailings/routes.js'
import { classifyMailingError, createMailingSender, emailHash, loadMailingContent } from '../src/modules/mailings/content.js'
import { claimMailingRecipient, deliverMailingRecipient, findUnsubscribeRecipient, mailingOverview, queueMailing, suppressMailingAddress, unsubscribeUrl } from '../src/modules/mailings/service.js'

const url = process.env.MAILING_TEST_DATABASE_URL
const integration = url ? describe : describe.skip
const adminId = randomUUID()
const actor = { id: adminId, email: 'breneize@yandex.ru' }
const config = { ...loadConfig(), databaseUrl: url ?? '', authUrl: 'https://shoditsa.ru', trustedOrigins: ['https://shoditsa.ru'],
  adminUserIds: [adminId], adminEmails: [actor.email], smtp: { host: 'smtp.example.test', from: 'support@shoditsa.ru', port: 465, user: '', password: '' } }
const consent = 'Owner confirmed separate marketing consent for all registered users, 2026-10-23.'
const transport = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), verify: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => transport } }))

describe('mailing error handling and approved content', () => {
  it('distinguishes definite RCPT rejection from an ambiguous timeout and redacts provider responses', () => {
    expect(classifyMailingError({ code: 'ETIMEDOUT', response: 'private@example.com' })).toEqual({ status: 'unknown', code: 'SMTP_RESULT_UNKNOWN', pause: true })
    expect(classifyMailingError({ responseCode: 550, command: 'RCPT TO' })).toEqual({ status: 'failed', code: 'SMTP_RECIPIENT_REJECTED', pause: false })
    expect(classifyMailingError({ responseCode: 450, command: 'DATA' }).pause).toBe(true)
    expect(classifyMailingError({ code: 'EAUTH' }).code).toBe('SMTP_AUTH')
  })
  it('loads the approved CID assets and requires a personal unsubscribe in both alternatives', async () => {
    const content = await loadMailingContent()
    expect(content.attachments.map(a => a.cid)).toEqual(['shoditsa-logo', 'shoditsa-territory'])
    expect(content.attachments.every(a => a.content.length > 1000)).toBe(true)
    expect(content.html).toContain('href="{{unsubscribeUrl}}"')
    expect(content.text).toContain('{{unsubscribeUrl}}')
    expect(content.text).toContain('рейтинг игроков')
    expect(content.text).toContain('два спецпоказа')
    expect((await loadMailingContent()).hash).toBe(content.hash)
  })
  it('sends one private recipient with CID attachments and matching RFC one-click headers', async () => {
    const content = await loadMailingContent()
    const recipient = { id: randomUUID(), email: 'player@example.com', kind: 'campaign' }
    const link = unsubscribeUrl(config, recipient.id, emailHash(recipient.email))
    transport.sendMail.mockResolvedValueOnce({ accepted: [recipient.email] })
    await createMailingSender(config).send(content, recipient, link)
    const message = transport.sendMail.mock.calls.at(-1)![0]
    expect(message.to).toEqual({ address: recipient.email, name: '' })
    expect(message.bcc).toBeUndefined()
    expect(message.cc).toBeUndefined()
    expect(message.html).not.toContain('{{unsubscribeUrl}}')
    expect(message.html).toContain(link)
    expect(message.text).toContain(link)
    expect(message.headers['List-Unsubscribe']).toContain(`<${link}>`)
    expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(message.attachments).toHaveLength(2)
    expect(message.disableFileAccess && message.disableUrlAccess).toBe(true)
  })
})

integration('mailing queue with an isolated PostgreSQL database', () => {
  const database = createDatabase(config)
  const db = database.db
  let content: Awaited<ReturnType<typeof loadMailingContent>>
  const sender = { send: vi.fn().mockResolvedValue(undefined) }
  const addUser = async (email: string, anonymous = false, blocked = false) => {
    const id = randomUUID()
    await db.execute(sql`insert into "user"(id,name,email,is_anonymous) values(${id}::uuid,'Test',${email},${anonymous})`)
    await db.execute(sql`insert into player_profiles(user_id,account_status) values(${id}::uuid,${blocked ? 'blocked' : 'active'})`)
    return id
  }
  const allowNext = () => db.execute(sql`update mailing_campaigns set next_send_at=now()-interval '1 second'`)
  const acceptTest = async () => {
    await queueMailing(db, config, actor, 'test')
    const test = await claimMailingRecipient(db)
    expect(test?.kind).toBe('test')
    await deliverMailingRecipient(db, config, test!, content, sender)
    await allowNext()
    sender.send.mockClear()
  }
  beforeAll(async () => {
    if (!/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):5457\/mailings_test$/.test(url!)) throw new Error('Use only the isolated local mailings_test database')
    await migrate(db, { migrationsFolder: resolve('packages/database/migrations') })
    content = await loadMailingContent()
  }, 60_000)
  beforeEach(async () => {
    await db.execute(sql`truncate mailing_recipients,mailing_campaigns,mailing_suppressions`)
    await db.execute(sql`delete from "user"`)
    await db.execute(sql`insert into "user"(id,name,email) values(${adminId}::uuid,'Administrator',${actor.email})`)
    await db.execute(sql`insert into player_profiles(user_id,role) values(${adminId}::uuid,'admin')`)
    sender.send.mockReset().mockResolvedValue(undefined)
  })
  afterAll(async () => { await database.client.end() })

  it('requires an accepted test and a consent source before first launch', async () => {
    await expect(queueMailing(db, config, actor, 'start', consent)).rejects.toMatchObject({ code: 'MAILING_TEST_REQUIRED' })
    await acceptTest()
    await expect(queueMailing(db, config, actor, 'start', '')).rejects.toMatchObject({ code: 'MAILING_CONSENT_REQUIRED' })
  })
  it('includes unverified registered accounts, deduplicates email and fixes the audience only once', async () => {
    await addUser('player@example.com')
    await addUser('PLAYER@example.com')
    await addUser('anonymous@example.com', true)
    await addUser('blocked@example.com', false, true)
    await addUser('suppressed@example.com')
    await suppressMailingAddress(db, emailHash('suppressed@example.com'))
    await acceptTest()
    await Promise.all([queueMailing(db, config, actor, 'start', consent), queueMailing(db, config, actor, 'start', consent)])
    await addUser('later@example.com')
    await queueMailing(db, config, actor, 'start', consent)
    const rows = await db.execute(sql`select email,status from mailing_recipients where kind='campaign' order by email`)
    expect(rows.map(r => r.email)).toEqual([actor.email, 'player@example.com', 'suppressed@example.com'])
    expect(rows.at(-1)?.status).toBe('suppressed')
  })
  it('claims only one recipient with concurrent workers, enforces pace and never repeats acceptance', async () => {
    await acceptTest(); await queueMailing(db, config, actor, 'start', consent)
    const claims = await Promise.all(Array.from({ length: 6 }, () => claimMailingRecipient(db)))
    expect(claims.filter(Boolean)).toHaveLength(1)
    const recipient = claims.find(Boolean)!
    await deliverMailingRecipient(db, config, recipient, content, sender)
    expect(await claimMailingRecipient(db)).toBeNull()
    await allowNext(); expect(await claimMailingRecipient(db)).toBeNull()
    expect(sender.send).toHaveBeenCalledOnce()
    expect((await mailingOverview(db)).campaign?.status).toBe('completed')
    await queueMailing(db, config, actor, 'start', consent)
    expect(await claimMailingRecipient(db)).toBeNull()
  })
  it('suppresses pending recipients, including an address which unsubscribes after claim', async () => {
    await acceptTest(); await queueMailing(db, config, actor, 'start', consent)
    const recipient = (await claimMailingRecipient(db))!
    await suppressMailingAddress(db, recipient.email_hash)
    await deliverMailingRecipient(db, config, recipient, content, sender)
    expect(sender.send).not.toHaveBeenCalled()
    expect((await db.execute(sql`select status from mailing_recipients where id=${recipient.id}::uuid`))[0]?.status).toBe('suppressed')
  })
  it('pauses after an ambiguous SMTP result and never auto-retries after restart or start', async () => {
    await acceptTest(); await queueMailing(db, config, actor, 'start', consent)
    const recipient = (await claimMailingRecipient(db))!
    sender.send.mockRejectedValueOnce({ code: 'ETIMEDOUT', response: 'private address' })
    await deliverMailingRecipient(db, config, recipient, content, sender)
    await allowNext()
    expect(await claimMailingRecipient(db)).toBeNull()
    expect((await mailingOverview(db)).campaign?.status).toBe('paused')
    await expect(queueMailing(db, config, actor, 'start', consent)).rejects.toMatchObject({ code: 'MAILING_RESULT_UNKNOWN' })
    expect(sender.send).toHaveBeenCalledOnce()
  })
  it('marks a lost in-flight job unknown instead of requeuing it', async () => {
    await acceptTest(); await queueMailing(db, config, actor, 'start', consent)
    const recipient = (await claimMailingRecipient(db))!
    await db.execute(sql`update mailing_recipients set claimed_at=now()-interval '3 minutes' where id=${recipient.id}::uuid`)
    await allowNext()
    expect(await claimMailingRecipient(db)).toBeNull()
    expect((await db.execute(sql`select status from mailing_recipients where id=${recipient.id}::uuid`))[0]?.status).toBe('unknown')
  })
  it('rejects content changes after sealing and excludes changed/deleted accounts', async () => {
    await acceptTest(); await queueMailing(db, config, actor, 'start', consent)
    const recipient = (await claimMailingRecipient(db))!
    await db.execute(sql`update "user" set email='changed@example.com' where id=${recipient.user_id}::uuid`)
    await deliverMailingRecipient(db, config, recipient, content, sender)
    expect(sender.send).not.toHaveBeenCalled()
  })
  it('protects admin reads and mutations, keeps unsubscribe GET read-only and supports one-click POST', async () => {
    await acceptTest()
    const [recipient] = await db.execute(sql`select id,email_hash from mailing_recipients limit 1`)
    const link = unsubscribeUrl(config, String(recipient!.id), String(recipient!.email_hash))
    let authenticated = false
    const auth = { api: { getSession: async () => authenticated ? { user: { ...actor, name: 'Admin' }, session: { id: randomUUID() } } : null } } as unknown as Auth
    const app = Fastify()
    app.setErrorHandler((e, req, reply) => sendError(req, reply, e))
    await app.register(rateLimit)
    registerMailingRoutes(app, { db, config, auth })
    try {
      expect((await app.inject('/api/v1/admin/mailings')).statusCode).toBe(401)
      authenticated = true
      expect((await app.inject('/api/v1/admin/mailings/console')).statusCode).toBe(200)
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/mailings/actions/start', headers: { origin: 'https://evil.example' }, payload: { consentSource: consent } })).statusCode).toBe(403)
      expect((await app.inject(link)).statusCode).toBe(200)
      expect((await db.execute(sql`select * from mailing_suppressions`))).toHaveLength(0)
      const bad = link.slice(0, -1) + (link.endsWith('0') ? '1' : '0')
      expect(await findUnsubscribeRecipient(db, config, String(recipient!.id), bad.split('/').at(-1)!)).toBeNull()
      for (let i = 0; i < 2; i++) expect((await app.inject({ method: 'POST', url: link, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' })).statusCode).toBe(200)
      expect((await db.execute(sql`select * from mailing_suppressions`))).toHaveLength(1)
    } finally { await app.close() }
  })
})
