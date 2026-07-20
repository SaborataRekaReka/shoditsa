import { afterEach, describe, expect, it, vi } from 'vitest'
import { createYooKassaProvider } from '../src/modules/commerce/providers/yookassa.js'

afterEach(() => vi.unstubAllGlobals())

describe('YooKassa provider adapter', () => {
  it('creates a redirect payment with server amount and idempotence key', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({
        id: 'payment-1', status: 'pending', amount: { value: '149.00', currency: 'RUB' },
        confirmation: { confirmation_url: 'https://yoomoney.ru/pay/1' }, metadata: { order_id: 'order-1' },
        echoed: body,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createYooKassaProvider({ shopId: 'shop', secretKey: 'secret' })
    const payment = await provider.createPayment({
      orderId: 'order-1', amountMinor: 14_900, currency: 'RUB', description: 'Спецпоказ',
      returnUrl: 'https://example.test/purchase/return', idempotencyKey: 'idem-1', metadata: { userId: 'user-1', productId: 'pack-1' },
    })
    expect(payment.checkoutUrl).toBe('https://yoomoney.ru/pay/1')
    const init = fetchMock.mock.calls[0][1]!
    expect((init.headers as Record<string, string>)['Idempotence-Key']).toBe('idem-1')
    expect(JSON.parse(String(init.body)).amount).toEqual({ value: '149.00', currency: 'RUB' })
  })

  it('verifies a succeeded notification against the authenticated API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'payment-1', status: 'succeeded', captured_at: '2026-07-20T10:00:00.000Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const provider = createYooKassaProvider({ shopId: 'shop', secretKey: 'secret' })
    const event = await provider.parseAndVerifyWebhook(Buffer.from(JSON.stringify({ type: 'notification', event: 'payment.succeeded', object: { id: 'payment-1', status: 'succeeded' } })), {})
    expect(event).toMatchObject({ providerPaymentId: 'payment-1', status: 'paid', eventType: 'payment.succeeded' })
    expect(event.payload).toEqual({ event: 'payment.succeeded', objectId: 'payment-1', status: 'succeeded' })
  })
})
