import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRobokassaProvider } from '../src/modules/commerce/providers/robokassa.js'

const credentials = {
  merchantLogin: 'shoditsa-test',
  password1: 'password-one',
  password2: 'password-two',
  hashAlgorithm: 'sha256' as const,
  testMode: true,
  receiptTax: 'none',
}

const paymentInput = {
  orderId: '6f5df218-689d-47de-a57b-ccfd7d579994',
  invoiceId: 42,
  amountMinor: 14_900,
  currency: 'RUB',
  description: 'Клуб на 30 дней',
  email: 'player@example.test',
  returnUrl: 'https://shoditsa.ru/purchase/return',
  idempotencyKey: '6f5df218-689d-47de-a57b-ccfd7d579994',
  metadata: { userId: 'user-1', productId: 'club_30d' },
}

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

afterEach(() => vi.unstubAllGlobals())

describe('Robokassa provider adapter', () => {
  it('creates a signed test checkout with a fiscal receipt and internal order id', async () => {
    const payment = await createRobokassaProvider(credentials).createPayment(paymentInput)
    const checkout = new URL(payment.checkoutUrl!)
    const receipt = checkout.searchParams.get('Receipt')!
    const expectedSignature = hash(`shoditsa-test:149.00:42:${receipt}:password-one:Shp_order=${paymentInput.orderId}`)

    expect(checkout.origin).toBe('https://auth.robokassa.ru')
    expect(checkout.searchParams.get('MerchantLogin')).toBe('shoditsa-test')
    expect(checkout.searchParams.get('OutSum')).toBe('149.00')
    expect(checkout.searchParams.get('InvId')).toBe('42')
    expect(checkout.searchParams.get('Email')).toBe('player@example.test')
    expect(checkout.searchParams.get('IsTest')).toBe('1')
    expect(checkout.searchParams.get('Shp_order')).toBe(paymentInput.orderId)
    expect(checkout.searchParams.get('SignatureValue')).toBe(expectedSignature)
    expect(JSON.parse(decodeURIComponent(receipt))).toEqual({
      items: [{
        name: 'Клуб на 30 дней',
        quantity: 1,
        sum: 149,
        payment_method: 'full_payment',
        payment_object: 'service',
        tax: 'none',
      }],
    })
    expect(payment).toMatchObject({ providerPaymentId: '42', status: 'pending', rawStatus: 'test_pending' })
  })

  it('verifies ResultURL signature and returns the required acknowledgement', async () => {
    const signature = hash(`149.00:42:password-two:Shp_order=${paymentInput.orderId}`)
    const body = new URLSearchParams({
      OutSum: '149.00',
      InvId: '42',
      SignatureValue: signature.toUpperCase(),
      Shp_order: paymentInput.orderId,
    })
    const event = await createRobokassaProvider(credentials).parseAndVerifyWebhook(Buffer.from(body.toString()), {})

    expect(event).toMatchObject({
      providerPaymentId: '42',
      status: 'paid',
      amountMinor: 14_900,
      currency: 'RUB',
      orderId: paymentInput.orderId,
      acknowledgment: 'OK42',
    })
  })

  it('rejects a notification with an invalid signature', async () => {
    const body = new URLSearchParams({
      OutSum: '149.00',
      InvId: '42',
      SignatureValue: '0'.repeat(64),
      Shp_order: paymentInput.orderId,
    })
    await expect(createRobokassaProvider(credentials).parseAndVerifyWebhook(Buffer.from(body.toString()), {})).rejects.toMatchObject({
      statusCode: 401,
      code: 'PAYMENT_SIGNATURE_INVALID',
    })
  })

  it('maps a production operation state to a paid order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<OperationStateResponse><Result><Code>0</Code></Result><State><Code>100</Code></State></OperationStateResponse>',
      { status: 200, headers: { 'content-type': 'application/xml' } },
    )))
    const provider = createRobokassaProvider({ ...credentials, testMode: false })
    await expect(provider.getPayment('42')).resolves.toMatchObject({ providerPaymentId: '42', status: 'paid' })
  })
})
