import { createHmac, timingSafeEqual } from 'node:crypto'
import { ApiError } from '../../../lib/errors.js'
import type { CommerceProvider, CreatePaymentInput, VerifiedPaymentEvent } from './types.js'

type StubPayload = {
  eventId: string
  eventType?: string
  providerPaymentId: string
  status: VerifiedPaymentEvent['status']
  occurredAt?: string
}

export const createStubProvider = (secret: string): CommerceProvider => ({
  category: 'stub',
  async createPayment(input: CreatePaymentInput) {
    const returnUrl = new URL(input.returnUrl)
    returnUrl.searchParams.set('orderId', input.orderId)
    return { providerPaymentId: `stub_${input.orderId}`, status: 'pending', checkoutUrl: returnUrl.toString(), rawStatus: 'pending' }
  },
  async parseAndVerifyWebhook(rawBody, headers) {
    const signature = headers['x-commerce-signature']
    if (typeof signature !== 'string') throw new ApiError(401, 'PAYMENT_SIGNATURE_INVALID', 'Не удалось проверить подпись платежа')
    const expected = createHmac('sha256', secret || 'development-stub-webhook-secret').update(rawBody).digest('hex')
    const provided = Buffer.from(signature, 'utf8')
    const expectedBuffer = Buffer.from(expected, 'utf8')
    if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
      throw new ApiError(401, 'PAYMENT_SIGNATURE_INVALID', 'Не удалось проверить подпись платежа')
    }
    let payload: StubPayload
    try { payload = JSON.parse(rawBody.toString('utf8')) as StubPayload } catch { throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Некорректное платёжное событие') }
    if (!payload.eventId || !payload.providerPaymentId || !['pending', 'paid', 'failed', 'canceled', 'expired', 'refunded', 'chargeback'].includes(payload.status)) {
      throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Некорректное платёжное событие')
    }
    return {
      providerEventId: payload.eventId,
      eventType: payload.eventType || `payment.${payload.status}`,
      providerPaymentId: payload.providerPaymentId,
      status: payload.status,
      occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : new Date(),
      payload: { status: payload.status },
    }
  },
  async getPayment(providerPaymentId) {
    return { providerPaymentId, status: 'pending', occurredAt: new Date() }
  },
})
