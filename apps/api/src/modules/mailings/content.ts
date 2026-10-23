import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AppConfig } from '@shoditsa/config'
import nodemailer from 'nodemailer'

export const CAMPAIGN_ID = 'autumn-2026-v1'
export type MailingContent = Awaited<ReturnType<typeof loadMailingContent>>
export const normalizeEmail = (email: string) => email.trim().toLowerCase()
export const emailHash = (email: string) => createHash('sha256').update(normalizeEmail(email)).digest('hex')
export const validEmail = (email: string) => email.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)

export async function loadMailingContent() {
  const root = resolve(process.env.MAILING_CONTENT_ROOT || 'docs/communications/autumn-2026')
  const manifest = JSON.parse(await readFile(resolve(root, 'message.json'), 'utf8')) as {
    campaignId: string; subject: string; replyTo: string; htmlFile: string; textFile: string
    attachments: Array<{ filename: string; path: string; cid: string; contentType: string }>
  }
  if (manifest.campaignId !== CAMPAIGN_ID || manifest.htmlFile !== 'email.smtp.html' || manifest.textFile !== 'email.body.txt'
    || manifest.replyTo !== 'breneize@yandex.ru' || /[\r\n]/.test(manifest.subject)) throw new Error('MAILING_CONTENT_INVALID')
  const [html, text, ...images] = await Promise.all([
    readFile(resolve(root, manifest.htmlFile), 'utf8'), readFile(resolve(root, manifest.textFile), 'utf8'),
    ...manifest.attachments.map(a => {
      if (!/^assets\/[a-z0-9-]+\.png$/.test(a.path)) throw new Error('MAILING_ASSET_INVALID')
      return readFile(resolve(root, a.path))
    }),
  ])
  const htmlTemplate = String(html).replace(/Чтобы отписаться, ответьте на это письмо «Отписаться» или <a href="mailto:[^"]+"([^>]*)>напишите нам<\/a>\./, '<a href="{{unsubscribeUrl}}"$1>Отписаться от новостей</a>.')
  const textTemplate = String(text).replace('Чтобы отписаться, ответьте на это письмо «Отписаться».', 'Отписаться от новостей: {{unsubscribeUrl}}')
  if (!htmlTemplate.includes('{{unsubscribeUrl}}') || !textTemplate.includes('{{unsubscribeUrl}}')) throw new Error('MAILING_UNSUBSCRIBE_MISSING')
  const hash = createHash('sha256').update(manifest.subject).update(manifest.replyTo).update(htmlTemplate).update(textTemplate)
  const attachments = manifest.attachments.map((a, i) => {
    const content = Buffer.from(images[i]!)
    hash.update(JSON.stringify(a)).update(content)
    return { filename: a.filename, cid: a.cid, contentType: a.contentType, contentDisposition: 'inline' as const, content }
  })
  return { subject: manifest.subject, replyTo: manifest.replyTo, html: htmlTemplate, text: textTemplate, attachments, hash: hash.digest('hex') }
}

export function createMailingSender(config: AppConfig) {
  if (!config.smtp.host || !config.smtp.from) throw new Error('MAILING_SMTP_UNAVAILABLE')
  const transport = nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
    requireTLS: config.smtp.port === 587,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 15_000,
  })
  return {
    verify: () => transport.verify(),
    close: () => transport.close(),
    async send(content: MailingContent, recipient: { id: string; email: string; kind: string }, unsubscribeUrl: string) {
      const result = await transport.sendMail({
        from: { name: 'Сходится!', address: config.smtp.from }, to: { address: recipient.email, name: '' }, replyTo: content.replyTo,
        subject: `${recipient.kind === 'test' ? '[Тест] ' : ''}${content.subject}`,
        html: content.html.replaceAll('{{unsubscribeUrl}}', unsubscribeUrl), text: content.text.replaceAll('{{unsubscribeUrl}}', unsubscribeUrl),
        attachments: content.attachments, messageId: `<${CAMPAIGN_ID}.${recipient.id}@shoditsa.ru>`,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${content.replyTo}?subject=unsubscribe%20shoditsa>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        disableFileAccess: true, disableUrlAccess: true,
      })
      if (!result.accepted?.some(a => normalizeEmail(typeof a === 'string' ? a : a.address) === recipient.email)) {
        throw Object.assign(new Error('MAILING_RECIPIENT_REJECTED'), { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' })
      }
    },
  }
}
export type MailingSender = ReturnType<typeof createMailingSender>

// Never persist SMTP response text: it can contain an address or server credentials.
export function classifyMailingError(error: unknown) {
  const e = error as { code?: string; responseCode?: number; command?: string }
  if (e.code === 'EAUTH') return { status: 'failed', code: 'SMTP_AUTH', pause: true }
  if ((e.responseCode ?? 0) >= 500 && /^RCPT TO/i.test(e.command ?? '')) return { status: 'failed', code: 'SMTP_RECIPIENT_REJECTED', pause: false }
  if ((e.responseCode ?? 0) >= 400) return { status: 'failed', code: 'SMTP_REJECTED', pause: true }
  return { status: 'unknown', code: 'SMTP_RESULT_UNKNOWN', pause: true }
}
