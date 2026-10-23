import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '@shoditsa/config'
import { SUPPORT_EMAIL, type SupportMessageBody } from '@shoditsa/contracts'
import { sendError } from '../src/lib/errors.js'
import { registerSupportRoutes } from '../src/modules/support/routes.js'
import { createSupportEmailSender, type SupportEmailSender } from '../src/modules/support/email.js'

const mail = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => mail } }))

const config = { smtp: { host: 'smtp.example.test', port: 587, from: 'site@example.test', user: '', password: '' } } as AppConfig
const body: SupportMessageBody = { email: 'player@example.test', topic: 'problem', message: 'В игре не открывается следующий раунд.', consent: true }
const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.clearAllMocks() })

async function setup(sender: SupportEmailSender | null) {
  const app = Fastify()
  apps.push(app)
  app.setErrorHandler((error, request, reply) => sendError(request, reply, error))
  await app.register(rateLimit)
  registerSupportRoutes(app, config, sender)
  return app
}

describe('support form API', () => {
  it('accepts a guest message only after mail sending completes and closes the sender', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined), close: vi.fn() }
    const app = await setup(sender)
    const result = await app.inject({ method: 'POST', url: '/api/v1/support/messages', payload: { ...body, message: `  ${body.message}  ` } })
    expect(result.statusCode).toBe(200)
    expect(result.json()).toEqual({ sent: true })
    expect(sender.send).toHaveBeenCalledWith(body, expect.any(String))
    expect(result.body).not.toContain(body.email)
    await app.close()
    expect(sender.close).toHaveBeenCalledOnce()
  })

  it.each([
    { ...body, consent: false },
    { ...body, consent: undefined },
    { ...body, email: 'invalid-email' },
    { ...body, email: 'player@example.test\r\nBcc: other@example.test' },
    { ...body, topic: 'made-up' },
    { ...body, message: '     '.repeat(3) },
    { ...body, message: 'a'.repeat(5001) },
    { ...body, website: 'spam.example.test' },
  ])('rejects invalid input before sending', async payload => {
    const sender = { send: vi.fn(), close: vi.fn() }
    const app = await setup(sender)
    const result = await app.inject({ method: 'POST', url: '/api/v1/support/messages', payload })
    expect(result.statusCode).toBe(400)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('never reports success when SMTP is unavailable or rejects delivery', async () => {
    for (const sender of [null, { send: vi.fn().mockRejectedValue(new Error('SMTP failed')), close: vi.fn() }]) {
      const app = await setup(sender)
      const result = await app.inject({ method: 'POST', url: '/api/v1/support/messages', payload: body })
      expect(result.statusCode).toBe(503)
      expect(result.json().sent).toBeUndefined()
    }
  })

  it('limits support submissions independently to five per IP per hour', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined), close: vi.fn() }
    const app = await setup(sender)
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'POST', url: '/api/v1/support/messages', payload: body })).statusCode).toBe(200)
    }
    const blocked = await app.inject({ method: 'POST', url: '/api/v1/support/messages', payload: body })
    expect(blocked.statusCode).toBe(429)
    expect(sender.send).toHaveBeenCalledTimes(5)
  })
})

describe('support mail delivery', () => {
  it('uses a fixed recipient and sender with the player address in Reply-To', async () => {
    mail.sendMail.mockResolvedValue({ accepted: [SUPPORT_EMAIL] })
    const sender = createSupportEmailSender(config)!
    await sender.send({ ...body, message: '<script>alert(1)</script>' }, 'request-1')
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: config.smtp.from, to: SUPPORT_EMAIL, replyTo: { address: body.email, name: '' },
      text: expect.stringContaining('<script>alert(1)</script>'), disableFileAccess: true, disableUrlAccess: true,
    }))
    expect(mail.sendMail.mock.calls[0][0].html).toBeUndefined()
  })

  it('rejects a result without an accepted support recipient', async () => {
    mail.sendMail.mockResolvedValue({ accepted: [], rejected: [SUPPORT_EMAIL] })
    await expect(createSupportEmailSender(config)!.send(body, 'request-2')).rejects.toThrow('not accepted')
    expect(createSupportEmailSender({ smtp: { host: '', from: '' } } as AppConfig)).toBeNull()
  })
})
