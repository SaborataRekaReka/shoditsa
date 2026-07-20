import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getFreeArchiveStart } from '../src/modules/archive/access.js'
import { createStubProvider } from '../src/modules/commerce/providers/stub.js'

describe('commerce primitives', () => {
  it('calculates an inclusive seven-day archive window', () => {
    expect(getFreeArchiveStart('2026-07-20', 7)).toBe('2026-07-14')
    expect(getFreeArchiveStart('2026-03-01', 7)).toBe('2026-02-23')
  })

  it('verifies stub webhook bytes before parsing', async () => {
    const provider = createStubProvider('test-secret')
    const body = Buffer.from(JSON.stringify({ eventId: 'event-1', providerPaymentId: 'stub_order', status: 'paid' }))
    const signature = createHmac('sha256', 'test-secret').update(body).digest('hex')
    await expect(provider.parseAndVerifyWebhook(body, { 'x-commerce-signature': signature })).resolves.toMatchObject({ providerEventId: 'event-1', status: 'paid' })
    await expect(provider.parseAndVerifyWebhook(body, { 'x-commerce-signature': '0'.repeat(64) })).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' })
  })
})
