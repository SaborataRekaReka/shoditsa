import { createHash, timingSafeEqual } from 'node:crypto'
import { ApiError } from '../../../lib/errors.js'
import type { CommerceProvider, CreatePaymentInput, VerifiedPaymentState } from './types.js'

export type RobokassaHashAlgorithm = 'md5' | 'sha256' | 'sha512'

export type RobokassaCredentials = {
  merchantLogin: string
  password1: string
  password2: string
  hashAlgorithm: RobokassaHashAlgorithm
  testMode: boolean
  receiptTax: string
  receiptSno?: string
}

const CHECKOUT_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx'
const STATE_URL = 'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt'
const VALID_STATUSES = new Set(['pending', 'paid', 'failed', 'canceled', 'expired', 'refunded', 'chargeback'])

const digest = (algorithm: RobokassaHashAlgorithm, value: string) => createHash(algorithm).update(value, 'utf8').digest('hex')

const secureEqual = (provided: string, expected: string) => {
  const left = Buffer.from(provided.toLocaleLowerCase('en-US'), 'utf8')
  const right = Buffer.from(expected.toLocaleLowerCase('en-US'), 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

const money = (amountMinor: number) => {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new ApiError(400, 'PAYMENT_AMOUNT_INVALID', 'Сумма платежа должна быть положительным целым числом копеек')
  }
  return (amountMinor / 100).toFixed(2)
}

const amountMinorFromProvider = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Некорректная сумма платежа')
  const [rubles, kopecks = ''] = value.split('.')
  const amountMinor = Number(rubles) * 100 + Number(kopecks.padEnd(2, '0'))
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Некорректная сумма платежа')
  return amountMinor
}

const requiredParameter = (params: URLSearchParams, name: string) => {
  const found = [...params.entries()].find(([key]) => key.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))
  if (!found?.[1]) throw new ApiError(400, 'PAYMENT_EVENT_INVALID', `В уведомлении отсутствует ${name}`)
  return found[1]
}

const customParameters = (params: URLSearchParams) => [...params.entries()]
  .filter(([key]) => key.toLocaleLowerCase('en-US').startsWith('shp_'))
  .sort(([left], [right]) => left.localeCompare(right, 'en-US'))

const stateStatus = (code: number): VerifiedPaymentState['status'] => {
  if (code === 100) return 'paid'
  if (code === 10) return 'canceled'
  if (code === 60) return 'refunded'
  return 'pending'
}

const xmlCode = (xml: string, element: 'Result' | 'State') => {
  const match = xml.match(new RegExp(`<${element}\\b[\\s\\S]*?<Code>(-?\\d+)</Code>`, 'i'))
  return match ? Number(match[1]) : null
}

export const createRobokassaProvider = (credentials: RobokassaCredentials): CommerceProvider => ({
  category: 'robokassa',

  async createPayment(input: CreatePaymentInput) {
    if (input.currency !== 'RUB') throw new ApiError(409, 'PAYMENT_CURRENCY_INVALID', 'Robokassa принимает этот заказ только в рублях')
    if (!Number.isSafeInteger(input.invoiceId) || input.invoiceId < 1) {
      throw new ApiError(500, 'PAYMENT_CREATION_FAILED', 'Для заказа не сформирован номер счёта')
    }

    const outSum = money(input.amountMinor)
    const receipt = {
      sno: credentials.receiptSno || undefined,
      items: [{
        name: input.description.slice(0, 100),
        quantity: 1,
        sum: Number(outSum),
        payment_method: 'full_payment',
        payment_object: 'service',
        tax: credentials.receiptTax,
      }],
    }
    const encodedReceipt = encodeURIComponent(JSON.stringify(receipt))
    const custom = `Shp_order=${input.orderId}`
    const signatureValue = digest(
      credentials.hashAlgorithm,
      `${credentials.merchantLogin}:${outSum}:${input.invoiceId}:${encodedReceipt}:${credentials.password1}:${custom}`,
    )
    const checkout = new URL(CHECKOUT_URL)
    checkout.searchParams.set('MerchantLogin', credentials.merchantLogin)
    checkout.searchParams.set('OutSum', outSum)
    checkout.searchParams.set('InvId', String(input.invoiceId))
    checkout.searchParams.set('Description', input.description.slice(0, 100))
    checkout.searchParams.set('Email', input.email)
    checkout.searchParams.set('Culture', 'ru')
    checkout.searchParams.set('Encoding', 'utf-8')
    checkout.searchParams.set('Receipt', encodedReceipt)
    checkout.searchParams.set('Shp_order', input.orderId)
    checkout.searchParams.set('SignatureValue', signatureValue)
    if (credentials.testMode) checkout.searchParams.set('IsTest', '1')

    return {
      providerPaymentId: String(input.invoiceId),
      status: 'pending',
      checkoutUrl: checkout.toString(),
      widget: null,
      rawStatus: credentials.testMode ? 'test_pending' : 'pending',
    }
  },

  async parseAndVerifyWebhook(rawBody) {
    let params: URLSearchParams
    try { params = new URLSearchParams(rawBody.toString('utf8')) } catch {
      throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Некорректное платёжное событие')
    }
    const outSum = requiredParameter(params, 'OutSum')
    const invoiceId = requiredParameter(params, 'InvId')
    const signatureValue = requiredParameter(params, 'SignatureValue')
    if (!/^\d+$/.test(invoiceId)) throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'Некорректный номер счёта')
    const custom = customParameters(params)
    const signatureParts = [outSum, invoiceId, credentials.password2, ...custom.map(([key, value]) => `${key}=${value}`)]
    const expected = digest(credentials.hashAlgorithm, signatureParts.join(':'))
    if (!secureEqual(signatureValue, expected)) {
      throw new ApiError(401, 'PAYMENT_SIGNATURE_INVALID', 'Не удалось проверить подпись платежа')
    }
    const orderId = custom.find(([key]) => key.toLocaleLowerCase('en-US') === 'shp_order')?.[1]
    if (!orderId) throw new ApiError(400, 'PAYMENT_EVENT_INVALID', 'В уведомлении отсутствует номер заказа')
    const amountMinor = amountMinorFromProvider(outSum)
    const payload = Object.fromEntries(params.entries())

    return {
      providerEventId: `result:${invoiceId}:${signatureValue.toLocaleLowerCase('en-US')}`,
      eventType: 'payment.succeeded',
      providerPaymentId: invoiceId,
      status: 'paid',
      occurredAt: new Date(),
      amountMinor,
      currency: 'RUB',
      orderId,
      acknowledgment: `OK${invoiceId}`,
      payload,
    }
  },

  async getPayment(providerPaymentId) {
    if (!/^\d+$/.test(providerPaymentId)) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Платёж не найден у провайдера')
    if (credentials.testMode) return { providerPaymentId, status: 'pending', occurredAt: new Date() }

    const request = new URL(STATE_URL)
    request.searchParams.set('MerchantLogin', credentials.merchantLogin)
    request.searchParams.set('InvoiceID', providerPaymentId)
    request.searchParams.set('Signature', digest(credentials.hashAlgorithm, `${credentials.merchantLogin}:${providerPaymentId}:${credentials.password2}`))
    let response: Response
    try {
      response = await fetch(request, { headers: { Accept: 'application/xml, text/xml' }, signal: AbortSignal.timeout(15_000) })
    } catch {
      throw new ApiError(503, 'COMMERCE_PROVIDER_UNAVAILABLE', 'Платёжный сервис временно недоступен. Попробуйте позже')
    }
    if (!response.ok) {
      throw new ApiError(502, 'COMMERCE_PROVIDER_REQUEST_FAILED', 'Robokassa не приняла запрос проверки платежа', { providerStatus: response.status })
    }
    const xml = await response.text()
    const resultCode = xmlCode(xml, 'Result')
    if (resultCode === 3) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Платёж не найден у провайдера')
    if (resultCode !== 0) throw new ApiError(502, 'COMMERCE_PROVIDER_RESPONSE_INVALID', 'Robokassa вернула ошибку проверки платежа', { providerStatus: resultCode })
    const providerState = xmlCode(xml, 'State')
    if (providerState == null) throw new ApiError(502, 'COMMERCE_PROVIDER_RESPONSE_INVALID', 'Robokassa вернула некорректный статус платежа')
    const status = stateStatus(providerState)
    if (!VALID_STATUSES.has(status)) throw new ApiError(502, 'COMMERCE_PROVIDER_RESPONSE_INVALID', 'Robokassa вернула неподдерживаемый статус платежа')
    return { providerPaymentId, status, occurredAt: new Date() }
  },
})
