import { ApiError } from '../../../lib/errors.js'
import type { CommerceProvider, CreatePaymentInput, VerifiedPaymentEvent, VerifiedPaymentState } from './types.js'

type YooAmount = { value?: string; currency?: string }
type YooPayment = {
  id?: string
  status?: string
  amount?: YooAmount
  confirmation?: { confirmation_url?: string }
  metadata?: Record<string, unknown>
  created_at?: string
  captured_at?: string
  cancellation_details?: { reason?: string }
}
type YooRefund = { id?: string; payment_id?: string; status?: string; created_at?: string }
type YooNotification = { type?: string; event?: string; object?: YooPayment & YooRefund }

const API_URL = 'https://api.yookassa.ru/v3'
const paymentStatus = (status: string | undefined): VerifiedPaymentState['status'] => {
  if (status === 'succeeded') return 'paid'
  if (status === 'canceled') return 'canceled'
  return 'pending'
}
const parsedDate = (value: string | undefined) => {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

export const createYooKassaProvider = (credentials: { shopId: string; secretKey: string }): CommerceProvider => {
  const authorization = `Basic ${Buffer.from(`${credentials.shopId}:${credentials.secretKey}`).toString('base64')}`
  const call = async <T>(path: string, init: RequestInit = {}) => {
    let response: Response
    try {
      response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { Accept: 'application/json', Authorization: authorization, ...init.headers },
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new ApiError(503, 'COMMERCE_PROVIDER_UNAVAILABLE', 'Платёжный сервис временно недоступен. Попробуйте позже')
    }
    if (!response.ok) throw new ApiError(502, 'PAYMENT_CREATION_FAILED', 'ЮKassa не приняла запрос. Проверьте настройки магазина или попробуйте позже')
    try { return await response.json() as T } catch { throw new ApiError(502, 'PAYMENT_CREATION_FAILED', 'Платёжный сервис вернул некорректный ответ') }
  }
  const currentPayment = async (providerPaymentId: string) => call<YooPayment>(`/payments/${encodeURIComponent(providerPaymentId)}`)

  return {
    category: 'web',
    async createPayment(input: CreatePaymentInput) {
      const body = {
        amount: { value: (input.amountMinor / 100).toFixed(2), currency: input.currency },
        capture: true,
        confirmation: { type: 'redirect', return_url: input.returnUrl },
        description: input.description.slice(0, 128),
        metadata: { order_id: input.orderId, product_id: input.metadata.productId },
      }
      const payment = await call<YooPayment>('/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotence-Key': input.idempotencyKey },
        body: JSON.stringify(body),
      })
      if (!payment.id || payment.metadata?.order_id !== input.orderId || payment.amount?.currency !== input.currency || payment.amount?.value !== body.amount.value) {
        throw new ApiError(502, 'PAYMENT_CREATION_FAILED', 'Платёжный сервис вернул несогласованные данные заказа')
      }
      return {
        providerPaymentId: payment.id,
        status: paymentStatus(payment.status) === 'paid' ? 'paid' : 'pending',
        checkoutUrl: payment.confirmation?.confirmation_url ?? null,
        rawStatus: payment.status ?? 'pending',
      }
    },
    async parseAndVerifyWebhook(rawBody: Buffer): Promise<VerifiedPaymentEvent> {
      let notification: YooNotification
      try { notification = JSON.parse(rawBody.toString('utf8')) as YooNotification } catch { throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Некорректное платёжное событие') }
      if (notification.type !== 'notification' || !notification.event || !notification.object?.id) throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Некорректное платёжное событие')

      if (notification.event === 'refund.succeeded') {
        const refund = await call<YooRefund>(`/refunds/${encodeURIComponent(notification.object.id)}`)
        if (refund.status !== 'succeeded' || !refund.payment_id) throw new ApiError(401, 'PAYMENT_SIGNATURE_INVALID', 'Не удалось подтвердить уведомление ЮKassa')
        return {
          providerEventId: `refund.succeeded:${refund.id}`,
          eventType: notification.event,
          providerPaymentId: refund.payment_id,
          status: 'refunded',
          occurredAt: parsedDate(refund.created_at),
          payload: { event: notification.event, objectId: refund.id, status: refund.status },
        }
      }

      if (!notification.event.startsWith('payment.')) throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Неподдерживаемое платёжное событие')
      const payment = await currentPayment(notification.object.id)
      if (!payment.id || payment.status !== notification.object.status) throw new ApiError(401, 'PAYMENT_SIGNATURE_INVALID', 'Статус уведомления ЮKassa не подтверждён API')
      const status = paymentStatus(payment.status)
      return {
        providerEventId: `${notification.event}:${payment.id}:${payment.status}`,
        eventType: notification.event,
        providerPaymentId: payment.id,
        status,
        occurredAt: parsedDate(payment.captured_at ?? payment.created_at),
        payload: { event: notification.event, objectId: payment.id, status: payment.status },
      }
    },
    async getPayment(providerPaymentId) {
      const payment = await currentPayment(providerPaymentId)
      if (!payment.id) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Платёж не найден')
      return { providerPaymentId: payment.id, status: paymentStatus(payment.status), occurredAt: parsedDate(payment.captured_at ?? payment.created_at) }
    },
  }
}
