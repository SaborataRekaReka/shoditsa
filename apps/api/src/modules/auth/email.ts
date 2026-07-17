import nodemailer from 'nodemailer'
import type { AppConfig } from '@shoditsa/config'

type AuthEmailKind = 'verification' | 'password-reset'

const copy = {
  verification: {
    subject: 'Подтвердите email — Сходится!',
    heading: 'Подтвердите email',
    intro: 'Остался один шаг: подтвердите адрес, чтобы сохранить игры, билеты и статистику в аккаунте.',
    action: 'Подтвердить email',
    fallback: 'Если вы не создавали аккаунт на shoditsa.ru, просто проигнорируйте это письмо.',
  },
  'password-reset': {
    subject: 'Восстановление пароля — Сходится!',
    heading: 'Восстановите доступ',
    intro: 'Мы получили запрос на смену пароля. Откройте защищённую ссылку и задайте новый пароль.',
    action: 'Сменить пароль',
    fallback: 'Если вы не запрашивали восстановление пароля, ничего делать не нужно.',
  },
} satisfies Record<AuthEmailKind, Record<string, string>>

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

export const renderAuthEmail = (kind: AuthEmailKind, url: string) => {
  const content = copy[kind]
  const safeUrl = escapeHtml(url)
  return {
    subject: content.subject,
    text: `${content.heading}\n\n${content.intro}\n\n${content.action}: ${url}\n\n${content.fallback}\n\nСходится! — https://shoditsa.ru`,
    html: `<!doctype html>
<html lang="ru"><body style="margin:0;background:#111827;color:#f8fafc;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px">
    <div style="background:#1f2937;border:1px solid #374151;border-radius:18px;padding:32px">
      <div style="font-size:24px;font-weight:800;color:#fbbf24;margin-bottom:28px">Сходится!</div>
      <h1 style="font-size:26px;line-height:1.2;margin:0 0 16px">${content.heading}</h1>
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 28px">${content.intro}</p>
      <a href="${safeUrl}" style="display:inline-block;background:#fbbf24;color:#111827;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">${content.action}</a>
      <p style="font-size:13px;line-height:1.5;color:#9ca3af;margin:28px 0 0">${content.fallback}</p>
      <p style="font-size:12px;line-height:1.5;color:#6b7280;word-break:break-all;margin:20px 0 0">Если кнопка не работает: ${safeUrl}</p>
    </div>
  </div>
</body></html>`,
  }
}

export const createAuthEmailSender = (config: AppConfig) => {
  const configured = Boolean(config.smtp.host && config.smtp.from)
  if (!configured) return null

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    requireTLS: config.smtp.port === 587,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  })

  return async (to: string, kind: AuthEmailKind, url: string) => {
    const message = renderAuthEmail(kind, url)
    await transport.sendMail({ from: config.smtp.from, to, ...message })
  }
}
