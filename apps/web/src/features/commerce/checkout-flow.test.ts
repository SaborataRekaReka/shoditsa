import { describe, expect, it, vi } from 'vitest'
import type { CheckoutResponse, CloudPaymentsWidgetIntent } from '@shoditsa/contracts'
import { checkoutDestination } from './checkout-flow'

const orderId = 'b0cd3666-0db6-4a1d-9e35-f7116f1311b3'
const order = {
  id: orderId,
  productId: 'tip_paper_99',
  status: 'pending' as const,
  amountMinor: 9_900,
  currency: 'RUB',
  createdAt: '2026-07-27T17:38:39.458Z',
  paidAt: null,
}
const widget = {
  provider: 'cloudpayments',
  scriptUrl: 'https://widget.cloudpayments.ru/bundles/cloudpayments.js',
  publicTerminalId: 'pk_test',
  description: 'Бумажный жетон',
  paymentSchema: 'Single',
  currency: 'RUB',
  culture: 'ru-RU',
  amount: 99,
  skin: 'modern',
  externalId: orderId,
  userInfo: { accountId: 'user-1', email: 'player@example.test' },
  receiptEmail: 'player@example.test',
  emailBehavior: 'Hidden',
  items: [{ id: 'tip_paper_99', name: 'Бумажный жетон', count: 1, price: 99 }],
  tokenize: false,
} satisfies CloudPaymentsWidgetIntent

const response = (overrides: Partial<CheckoutResponse> = {}): CheckoutResponse => ({
  order,
  checkoutUrl: null,
  widget,
  ...overrides,
})

describe('checkoutDestination', () => {
  it('opens the CloudPayments widget before returning to order polling', async () => {
    const openWidget = vi.fn(async () => ({ type: 'payment' as const, status: 'success' as const }))

    await expect(checkoutDestination(response(), openWidget)).resolves.toBe(
      `/purchase/return?orderId=${orderId}`,
    )
    expect(openWidget).toHaveBeenCalledOnce()
    expect(openWidget).toHaveBeenCalledWith(widget)
  })

  it('stays on the offer when the customer closes the widget', async () => {
    await expect(checkoutDestination(
      response(),
      async () => ({ type: 'cancel', status: 'cancel' }),
    )).resolves.toBeNull()
  })

  it('surfaces a failed widget result', async () => {
    await expect(checkoutDestination(
      response(),
      async () => ({ type: 'error', status: 'fail', message: 'Платёж отклонён' }),
    )).rejects.toThrow('Платёж отклонён')
  })

  it('uses a hosted checkout URL without opening a widget', async () => {
    const openWidget = vi.fn()
    await expect(checkoutDestination(
      response({ widget: null, checkoutUrl: 'https://pay.example.test/order' }),
      openWidget,
    )).resolves.toBe('https://pay.example.test/order')
    expect(openWidget).not.toHaveBeenCalled()
  })
})
