import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { ApiError } from '../../../lib/errors.js'
import type {
  CommerceProvider,
  CreatePaymentInput,
  VerifiedPaymentEvent,
  VerifiedPaymentState,
} from './types.js'

export type CloudPaymentsCredentials = {
  publicId: string
  apiSecret: string
}

type CloudPaymentsModel = {
  TransactionId?: number | string
  Amount?: number | string
  Currency?: string
  InvoiceId?: string
  AccountId?: string
  SubscriptionId?: string
  Status?: string
  CreatedDateIso?: string
  AuthDateIso?: string
  ConfirmDateIso?: string
  Refunded?: boolean
}

type CloudPaymentsResponse<T> = {
  Model?: T | null
  Success?: boolean
  Message?: string | null
}

const API_URL = 'https://api.cloudpayments.ru'
const WIDGET_URL = 'https://widget.cloudpayments.ru/bundles/cloudpayments.js' as const
const WEBHOOK_EVENT_HEADER = 'x-shoditsa-cloudpayments-event'
const supportedEvents = new Set(['check', 'pay', 'fail', 'refund', 'cancel', 'recurrent'])

const headerValue = (headers: Record<string, unknown>, name: string) => {
  const value = headers[name] ?? headers[name.toLocaleLowerCase('en-US')]
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}

const secureEqual = (provided: string, expected: string) => {
  const left = Buffer.from(provided, 'utf8')
  const right = Buffer.from(expected, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

const parseBody = (rawBody: Buffer, contentType: string): Record<string, unknown> => {
  try {
    if (contentType.toLocaleLowerCase('en-US').includes('application/json')) {
      const parsed = JSON.parse(rawBody.toString('utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid payload')
      return parsed as Record<string, unknown>
    }
    return Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')).entries())
  } catch {
    throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Некорректное уведомление CloudPayments')
  }
}

const value = (payload: Record<string, unknown>, name: string) => {
  const found = Object.entries(payload).find(([key]) => key.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))
  return found?.[1]
}

const optionalString = (payload: Record<string, unknown>, name: string) => {
  const found = value(payload, name)
  return found == null || found === '' ? undefined : String(found)
}

const requiredString = (payload: Record<string, unknown>, name: string) => {
  const found = optionalString(payload, name)
  if (!found) throw new ApiError(400, 'PAYMENT_EVENT_INVALID', `В уведомлении CloudPayments отсутствует ${name}`)
  return found
}

const amountMinor = (raw: unknown) => {
  const normalized = String(raw ?? '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'CloudPayments передал некорректную сумму')
  }
  const [whole, fraction = ''] = normalized.split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'CloudPayments передал некорректную сумму')
  }
  return result
}

const parsedDateOrNull = (raw: unknown) => {
  const text = String(raw ?? '').trim()
  const dotNet = text.match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/)
  if (dotNet) {
    const date = new Date(Number(dotNet[1]))
    return Number.isNaN(date.getTime()) ? null : date
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text
  const date = normalized ? new Date(normalized) : null
  return !date || Number.isNaN(date.getTime()) ? null : date
}

const parsedDate = (raw: unknown) => parsedDateOrNull(raw) ?? new Date()

const optionalDate = (raw: unknown) => {
  if (raw == null || raw === '') return null
  return parsedDateOrNull(raw)
}

const transactionStatus = (model: CloudPaymentsModel): VerifiedPaymentState['status'] => {
  if (model.Refunded) return 'refunded'
  if (model.Status === 'Completed') return 'paid'
  if (model.Status === 'Cancelled') return 'canceled'
  if (model.Status === 'Declined') return 'failed'
  return 'pending'
}

const providerReference = (invoiceId: string | undefined, transactionId: string | undefined) => {
  if (transactionId) return `transaction:${transactionId}`
  if (invoiceId) return `invoice:${invoiceId}`
  throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'В уведомлении CloudPayments отсутствует идентификатор платежа')
}

export const createCloudPaymentsProvider = (credentials: CloudPaymentsCredentials): CommerceProvider => {
  const authorization = `Basic ${Buffer.from(`${credentials.publicId}:${credentials.apiSecret}`).toString('base64')}`

  const call = async <T>(path: string, body: Record<string, unknown>, requestId?: string): Promise<CloudPaymentsResponse<T>> => {
    let response: Response
    try {
      response = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: authorization,
          'Content-Type': 'application/json',
          ...(requestId ? { 'X-Request-ID': requestId } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new ApiError(503, 'COMMERCE_PROVIDER_UNAVAILABLE', 'CloudPayments временно недоступен. Попробуйте позже')
    }
    if (response.status === 404) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Платёж не найден в CloudPayments')
    if (!response.ok) {
      throw new ApiError(
        502,
        'COMMERCE_PROVIDER_REQUEST_FAILED',
        'CloudPayments не принял запрос. Проверьте Public ID и API Secret',
        { providerStatus: response.status },
      )
    }
    try {
      return await response.json() as CloudPaymentsResponse<T>
    } catch {
      throw new ApiError(502, 'COMMERCE_PROVIDER_RESPONSE_INVALID', 'CloudPayments вернул некорректный ответ')
    }
  }

  return {
    category: 'cloudpayments',

    async createPayment(input: CreatePaymentInput) {
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
        throw new ApiError(400, 'PAYMENT_AMOUNT_INVALID', 'Сумма платежа должна быть положительным целым числом копеек')
      }
      const amount = Number((input.amountMinor / 100).toFixed(2))
      return {
        providerPaymentId: `invoice:${input.orderId}`,
        status: 'pending',
        checkoutUrl: null,
        widget: {
          provider: 'cloudpayments',
          scriptUrl: WIDGET_URL,
          publicTerminalId: credentials.publicId,
          description: input.description.slice(0, 128),
          paymentSchema: 'Single',
          currency: input.currency,
          culture: 'ru-RU',
          amount,
          skin: 'modern',
          externalId: input.orderId,
          userInfo: { accountId: input.metadata.userId, email: input.email },
          receiptEmail: input.email,
          emailBehavior: 'Hidden',
          items: [{ id: input.metadata.productId, name: input.description.slice(0, 128), count: 1, price: amount }],
          tokenize: Boolean(input.recurrence),
          ...(input.recurrence ? { recurrent: input.recurrence } : {}),
        },
        rawStatus: 'widget_pending',
      }
    },

    async parseAndVerifyWebhook(rawBody, headers) {
      const signature = headerValue(headers, 'content-hmac') || headerValue(headers, 'x-content-hmac')
      const expected = createHmac('sha256', credentials.apiSecret).update(rawBody).digest('base64')
      if (!signature || !secureEqual(signature, expected)) {
        throw new ApiError(401, 'PAYMENT_SIGNATURE_INVALID', 'Не удалось проверить подпись CloudPayments')
      }

      const eventType = headerValue(headers, WEBHOOK_EVENT_HEADER).toLocaleLowerCase('en-US')
      if (!supportedEvents.has(eventType)) {
        throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Неизвестный тип уведомления CloudPayments')
      }
      const payload = parseBody(rawBody, headerValue(headers, 'content-type'))
      const transactionId = optionalString(payload, 'TransactionId')
      const paymentTransactionId = optionalString(payload, 'PaymentTransactionId')
      const orderId = optionalString(payload, 'InvoiceId')
      const accountId = optionalString(payload, 'AccountId')
      const subscriptionId = optionalString(payload, eventType === 'recurrent' ? 'Id' : 'SubscriptionId')
      const currency = optionalString(payload, 'Currency')?.toUpperCase()
      const rawAmount = value(payload, 'Amount')
      const occurredAt = parsedDate(
        value(payload, 'DateTime')
        ?? value(payload, 'LastTransactionDateIso')
        ?? value(payload, 'LastTransactionDate')
        ?? new Date(),
      )
      const acknowledgment = '{"code":0}'
      const safePayload: Record<string, unknown> = {
        event: eventType,
        ...(transactionId ? { transactionId } : {}),
        ...(paymentTransactionId ? { paymentTransactionId } : {}),
        ...(orderId ? { invoiceId: orderId } : {}),
        ...(accountId ? { accountId } : {}),
        ...(subscriptionId ? { subscriptionId } : {}),
        ...(optionalString(payload, 'Status') ? { status: optionalString(payload, 'Status') } : {}),
        ...(optionalString(payload, 'ReasonCode') ? { reasonCode: optionalString(payload, 'ReasonCode') } : {}),
      }

      if (eventType === 'recurrent') {
        const subscriptionStatus = requiredString(payload, 'Status')
        return {
          providerEventId: `recurrent:${requiredString(payload, 'Id')}:${createHash('sha256').update(rawBody).digest('hex')}`,
          eventType,
          providerPaymentId: `subscription:${requiredString(payload, 'Id')}`,
          status: 'pending',
          occurredAt,
          payload: safePayload,
          accountId: requiredString(payload, 'AccountId'),
          subscriptionId: requiredString(payload, 'Id'),
          subscriptionStatus,
          nextPaymentAt: optionalDate(value(payload, 'NextTransactionDateIso') ?? value(payload, 'NextTransactionDate')),
          ...(rawAmount == null ? {} : { amountMinor: amountMinor(rawAmount) }),
          ...(currency ? { currency } : {}),
          acknowledgment,
        }
      }

      if (!orderId && !subscriptionId) {
        throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'В уведомлении CloudPayments отсутствует номер заказа или подписки')
      }
      if (rawAmount == null || (!currency && eventType !== 'refund')) {
        throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'В уведомлении CloudPayments отсутствует сумма или валюта')
      }

      const status: VerifiedPaymentEvent['status'] = eventType === 'pay'
        ? (requiredString(payload, 'Status') === 'Completed' ? 'paid' : 'pending')
        : eventType === 'refund'
          ? 'refunded'
          : eventType === 'cancel'
            ? 'canceled'
            : 'pending'
      const eventId = transactionId
        ? `${eventType}:${transactionId}`
        : `${eventType}:${createHash('sha256').update(rawBody).digest('hex')}`
      return {
        providerEventId: eventId,
        eventType,
        providerPaymentId: eventType === 'refund' && paymentTransactionId
          ? `transaction:${paymentTransactionId}`
          : providerReference(orderId, transactionId),
        status,
        occurredAt,
        payload: safePayload,
        amountMinor: amountMinor(rawAmount),
        ...(currency ? { currency } : {}),
        ...(orderId ? { orderId } : {}),
        ...(accountId ? { accountId } : {}),
        ...(subscriptionId ? { subscriptionId } : {}),
        acknowledgment,
      }
    },

    async getPayment(providerPaymentId) {
      const invoicePrefix = 'invoice:'
      const transactionPrefix = 'transaction:'
      const byInvoice = providerPaymentId.startsWith(invoicePrefix)
      const identifier = providerPaymentId.slice(byInvoice ? invoicePrefix.length : transactionPrefix.length)
      if (!identifier || (!byInvoice && !providerPaymentId.startsWith(transactionPrefix))) {
        throw new ApiError(404, 'ORDER_NOT_FOUND', 'Платёж не найден в CloudPayments')
      }
      const response = await call<CloudPaymentsModel>(
        byInvoice ? '/v2/payments/find' : '/payments/get',
        byInvoice ? { InvoiceId: identifier } : { TransactionId: identifier },
      )
      if (!response.Success || !response.Model?.TransactionId) {
        throw new ApiError(404, 'ORDER_NOT_FOUND', 'Платёж не найден в CloudPayments')
      }
      const model = response.Model
      return {
        providerPaymentId,
        status: transactionStatus(model),
        occurredAt: parsedDate(model.ConfirmDateIso ?? model.AuthDateIso ?? model.CreatedDateIso),
        ...(model.Amount == null ? {} : { amountMinor: amountMinor(model.Amount) }),
        ...(model.Currency ? { currency: model.Currency } : {}),
        ...(model.InvoiceId ? { orderId: model.InvoiceId } : {}),
        ...(model.AccountId ? { accountId: model.AccountId } : {}),
        ...(model.SubscriptionId ? { subscriptionId: model.SubscriptionId } : {}),
      }
    },

    async cancelSubscription(providerSubscriptionId, idempotencyKey) {
      const response = await call<unknown>(
        '/subscriptions/cancel',
        { Id: providerSubscriptionId },
        idempotencyKey,
      )
      if (!response.Success) {
        throw new ApiError(502, 'SUBSCRIPTION_CANCEL_FAILED', response.Message || 'CloudPayments не отменил автопродление')
      }
    },

    async configureNotifications(baseUrl) {
      const origin = new URL(baseUrl)
      if (origin.protocol !== 'https:') {
        throw new ApiError(422, 'CLOUDPAYMENTS_WEBHOOK_URL_INVALID', 'Для уведомлений CloudPayments нужен публичный HTTPS-адрес')
      }
      const eventTypes = ['pay', 'fail', 'refund', 'cancel', 'recurrent'] as const
      await Promise.all(eventTypes.map(async (eventType) => {
        const address = new URL(`/api/v1/commerce/webhooks/cloudpayments/${eventType}`, origin).toString()
        const response = await call<unknown>(`/site/notifications/${eventType}/update`, {
          IsEnabled: true,
          Address: address,
          HttpMethod: 'POST',
          Encoding: 'UTF8',
          Format: 'CloudPayments',
        })
        if (!response.Success) {
          throw new ApiError(
            502,
            'CLOUDPAYMENTS_WEBHOOK_SETUP_FAILED',
            response.Message || `CloudPayments не настроил уведомление ${eventType}`,
          )
        }
      }))
    },
  }
}
