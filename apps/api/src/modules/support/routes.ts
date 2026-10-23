import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '@shoditsa/config'
import { SupportMessageBodySchema, type SupportMessageBody } from '@shoditsa/contracts'
import { ApiError } from '../../lib/errors.js'
import { createSupportEmailSender, type SupportEmailSender } from './email.js'

export const registerSupportRoutes = (
  app: FastifyInstance,
  config: AppConfig,
  sender: SupportEmailSender | null = createSupportEmailSender(config),
) => {
  app.addHook('onClose', async () => sender?.close())
  app.post('/api/v1/support/messages', {
    bodyLimit: 24 * 1024,
    schema: { body: SupportMessageBodySchema },
    config: { rateLimit: { max: 5, timeWindow: '1 hour', keyGenerator: (request) => `support:${request.ip}` } },
  }, async (request) => {
    const body = request.body as SupportMessageBody
    if (body.website || body.message.trim().length < 10) {
      throw new ApiError(400, 'SUPPORT_INVALID_MESSAGE', 'Напишите сообщение длиной от 10 до 5000 символов.')
    }
    if (!sender) throw new ApiError(503, 'SUPPORT_UNAVAILABLE', 'Форма временно недоступна. Напишите нам на email ниже.')
    try {
      await sender.send({ ...body, email: body.email.trim(), message: body.message.trim() }, request.id)
    } catch {
      request.log.warn('Support email delivery failed')
      throw new ApiError(503, 'SUPPORT_DELIVERY_FAILED', 'Не удалось отправить сообщение. Попробуйте позже или напишите нам на email ниже.')
    }
    return { sent: true as const }
  })
}
