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
}

export type CreatePaymentResult = {
  providerPaymentId: string
  status: 'pending' | 'paid'
  checkoutUrl: string | null
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
  acknowledgment?: string
}

export type VerifiedPaymentState = Omit<VerifiedPaymentEvent, 'providerEventId' | 'eventType' | 'payload'>

export interface CommerceProvider {
  category: 'stub' | 'web' | 'robokassa'
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
  parseAndVerifyWebhook(rawBody: Buffer, headers: Record<string, unknown>): Promise<VerifiedPaymentEvent>
  getPayment(providerPaymentId: string): Promise<VerifiedPaymentState>
}
