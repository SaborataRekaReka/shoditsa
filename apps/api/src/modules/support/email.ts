import nodemailer from 'nodemailer'
import type { AppConfig } from '@shoditsa/config'
import { SUPPORT_EMAIL, SUPPORT_TOPICS, type SupportMessageBody } from '@shoditsa/contracts'

export type SupportEmailSender = {
  send: (body: SupportMessageBody, requestId: string) => Promise<void>
  close: () => void
}

export const createSupportEmailSender = (config: AppConfig): SupportEmailSender | null => {
  if (!config.smtp.host || !config.smtp.from) return null
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    requireTLS: config.smtp.port === 587,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  })
  return {
    async send(body, requestId) {
      const result = await transport.sendMail({
        from: config.smtp.from,
        to: SUPPORT_EMAIL,
        replyTo: { address: body.email, name: '' },
        subject: `Поддержка «Сходится!» — ${SUPPORT_TOPICS[body.topic]}`,
        text: `Тема: ${SUPPORT_TOPICS[body.topic]}\nEmail для ответа: ${body.email}\nОбращение: ${requestId}\n\n${body.message}`,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
      if (!result.accepted?.includes(SUPPORT_EMAIL)) throw new Error('Support recipient was not accepted')
    },
    close: () => transport.close(),
  }
}
