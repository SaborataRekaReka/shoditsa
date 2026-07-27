export type CreatePaymentInput = {
  orderId: string
  invoiceId: number
  amountMinor: number
  currency: string
  description: string
  email: string
  returnUrl: string
  idempotencyKey: string
  metadata: { userId: string; productId: string }
  recurrence?: {
    interval: 'Day' | 'Week' | 'Month'
    period: number
    startDate: string
  }
}

export type CloudPaymentsWidgetIntent = {
  provider: 'cloudpayments'
  scriptUrl: 'https://widget.cloudpayments.ru/bundles/cloudpayments.js'
  publicTerminalId: string
  description: string
  paymentSchema: 'Single'
  currency: string
  culture: 'ru-RU'
  amount: number
  skin: 'modern'
  externalId: string
  userInfo: { accountId: string; email: string }
  receiptEmail: string
  emailBehavior: 'Hidden'
  items: Array<{ id: string; name: string; count: number; price: number }>
  tokenize: boolean
  recurrent?: {
    interval: 'Day' | 'Week' | 'Month'
    period: number
    startDate: string
  }
}

export type CreatePaymentResult = {
  providerPaymentId: string
  status: 'pending' | 'paid'
  checkoutUrl: string | null
  widget: CloudPaymentsWidgetIntent | null
  rawStatus: string
}

export type VerifiedPaymentEvent = {
  providerEventId: string
  eventType: string
  providerPaymentId: string
  status: 'pending' | 'paid' | 'failed' | 'canceled' | 'expired' | 'refunded' | 'chargeback'
  occurredAt: Date
  payload: Record<string, unknown>
  amountMinor?: number
  currency?: string
  orderId?: string
  accountId?: string
  subscriptionId?: string
  subscriptionStatus?: string
  nextPaymentAt?: Date | null
  acknowledgment?: string
}

export type VerifiedPaymentState = Omit<VerifiedPaymentEvent, 'providerEventId' | 'eventType' | 'payload'>

export interface CommerceProvider {
  category: 'stub' | 'cloudpayments' | 'robokassa'
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
  parseAndVerifyWebhook(rawBody: Buffer, headers: Record<string, unknown>): Promise<VerifiedPaymentEvent>
  getPayment(providerPaymentId: string): Promise<VerifiedPaymentState>
  cancelSubscription?(providerSubscriptionId: string, idempotencyKey: string): Promise<void>
  configureNotifications?(baseUrl: string): Promise<void>
}
