import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudPaymentsProvider } from '../src/modules/commerce/providers/cloudpayments.js'

const credentials = { publicId: 'pk_test_public', apiSecret: 'api-test-secret' }
const provider = () => createCloudPaymentsProvider(credentials)
const input = {
  orderId: '6f5df218-689d-47de-a57b-ccfd7d579994',
  invoiceId: 42,
  amountMinor: 19_900,
  currency: 'RUB',
  description: 'Клубный билет на 30 дней',
  email: 'player@example.test',
  returnUrl: 'https://shoditsa.ru/purchase/return',
  idempotencyKey: '6f5df218-689d-47de-a57b-ccfd7d579994',
  metadata: { userId: '4ec5716f-49e6-4eb4-8e48-8c436907f140', productId: 'club_30d' },
}

const signedHeaders = (body: Buffer, event: string) => ({
  'content-type': 'application/x-www-form-urlencoded',
  'content-hmac': createHmac('sha256', credentials.apiSecret).update(body).digest('base64'),
  'x-shoditsa-cloudpayments-event': event,
})

afterEach(() => vi.unstubAllGlobals())

describe('CloudPayments provider adapter', () => {
  it('builds the official widget intent without exposing the API secret', async () => {
    const result = await provider().createPayment({
      ...input,
      recurrence: { interval: 'Day', period: 30, startDate: '2026-08-26T12:00:00.000Z' },
    })

    expect(result).toMatchObject({
      providerPaymentId: `invoice:${input.orderId}`,
      checkoutUrl: null,
      widget: {
        provider: 'cloudpayments',
        publicTerminalId: credentials.publicId,
        amount: 199,
        externalId: input.orderId,
        tokenize: true,
        recurrent: { interval: 'Day', period: 30 },
      },
    })
    expect(JSON.stringify(result)).not.toContain(credentials.apiSecret)
  })

  it('verifies Pay notification HMAC and returns server-verifiable order data', async () => {
    const body = Buffer.from(new URLSearchParams({
      TransactionId: '897749645',
      Amount: '199.00',
      Currency: 'RUB',
      DateTime: '2026-07-27 12:30:00',
      Status: 'Completed',
      OperationType: 'Payment',
      InvoiceId: input.orderId,
      AccountId: input.metadata.userId,
      SubscriptionId: 'sc_test_subscription',
      Token: 'must-not-be-persisted',
    }).toString())

    await expect(provider().parseAndVerifyWebhook(body, signedHeaders(body, 'pay'))).resolves.toMatchObject({
      providerEventId: 'pay:897749645',
      providerPaymentId: 'transaction:897749645',
      eventType: 'pay',
      status: 'paid',
      amountMinor: 19_900,
      currency: 'RUB',
      orderId: input.orderId,
      accountId: input.metadata.userId,
      subscriptionId: 'sc_test_subscription',
      acknowledgment: '{"code":0}',
    })
    const event = await provider().parseAndVerifyWebhook(body, signedHeaders(body, 'pay'))
    expect(JSON.stringify(event.payload)).not.toContain('must-not-be-persisted')
  })

  it('rejects a notification with a forged HMAC', async () => {
    const body = Buffer.from('TransactionId=1&Amount=199.00&Currency=RUB')
    await expect(provider().parseAndVerifyWebhook(body, {
      ...signedHeaders(body, 'pay'),
      'content-hmac': 'forged',
    })).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' })
  })

  it('parses subscription status notifications and CloudPayments date format', async () => {
    const nextPaymentAt = new Date('2026-08-26T12:00:00.000Z')
    const body = Buffer.from(new URLSearchParams({
      Id: 'sc_test_subscription',
      AccountId: input.metadata.userId,
      Amount: '199.00',
      Currency: 'RUB',
      Status: 'Active',
      LastTransactionDateIso: '2026-07-27T12:30:00Z',
      NextTransactionDate: `/Date(${nextPaymentAt.getTime()})/`,
    }).toString())

    await expect(provider().parseAndVerifyWebhook(body, signedHeaders(body, 'recurrent'))).resolves.toMatchObject({
      eventType: 'recurrent',
      providerPaymentId: 'subscription:sc_test_subscription',
      accountId: input.metadata.userId,
      subscriptionId: 'sc_test_subscription',
      subscriptionStatus: 'Active',
      amountMinor: 19_900,
      currency: 'RUB',
      nextPaymentAt,
    })
  })

  it('maps a refund to the original payment transaction without requiring Currency', async () => {
    const body = Buffer.from(new URLSearchParams({
      TransactionId: '900000002',
      PaymentTransactionId: '897749645',
      Amount: '199.00',
      DateTime: '2026-07-28 12:30:00',
      OperationType: 'Refund',
      InvoiceId: input.orderId,
      AccountId: input.metadata.userId,
    }).toString())

    await expect(provider().parseAndVerifyWebhook(body, signedHeaders(body, 'refund'))).resolves.toMatchObject({
      providerEventId: 'refund:900000002',
      providerPaymentId: 'transaction:897749645',
      eventType: 'refund',
      status: 'refunded',
      amountMinor: 19_900,
      orderId: input.orderId,
      accountId: input.metadata.userId,
    })
  })

  it('polls by InvoiceId using HTTP Basic Auth', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({
      Success: true,
      Model: {
        TransactionId: 897749645,
        InvoiceId: input.orderId,
        AccountId: input.metadata.userId,
        Amount: 199,
        Currency: 'RUB',
        Status: 'Completed',
        CreatedDateIso: '2026-07-27T12:30:00Z',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().getPayment(`invoice:${input.orderId}`)).resolves.toMatchObject({
      status: 'paid',
      amountMinor: 19_900,
      orderId: input.orderId,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.cloudpayments.ru/v2/payments/find')
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`${credentials.publicId}:${credentials.apiSecret}`).toString('base64')}`)
  })

  it('configures all state-changing notification URLs over HTTPS', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify({ Success: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await provider().configureNotifications?.('https://shoditsa.ru')

    expect(fetchMock).toHaveBeenCalledTimes(5)
    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    }))
    expect(calls.map(({ url }) => url).sort()).toEqual([
      'https://api.cloudpayments.ru/site/notifications/cancel/update',
      'https://api.cloudpayments.ru/site/notifications/fail/update',
      'https://api.cloudpayments.ru/site/notifications/pay/update',
      'https://api.cloudpayments.ru/site/notifications/recurrent/update',
      'https://api.cloudpayments.ru/site/notifications/refund/update',
    ])
    expect(calls.find(({ url }) => url.includes('/pay/'))?.body).toMatchObject({
      IsEnabled: true,
      Address: 'https://shoditsa.ru/api/v1/commerce/webhooks/cloudpayments/pay',
      HttpMethod: 'POST',
      Format: 'CloudPayments',
    })
  })
})
