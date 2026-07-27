import { createHash } from 'node:crypto'
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import { ECONOMY_RULES_VERSION } from '@shoditsa/contracts'
import {
  commerceProducts,
  commerceSubscriptions,
  clientEvents,
  paymentEvents,
  paymentOrders,
  userEntitlements,
  walletAccounts,
  walletLedger,
  type Database,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getActiveEntitlements, getMembershipSummary, grantProductEntitlement, revokeOrderEntitlements } from './entitlements.js'
import { publicProduct } from './products.js'
import { settlePositiveWalletCredit, walletCreditMetadata } from '../economy/wallet-credit.js'
import { createRobokassaProvider } from './providers/robokassa.js'
import { createStubProvider } from './providers/stub.js'
import { createCloudPaymentsProvider } from './providers/cloudpayments.js'
import { loadIntegrationEnvironment } from '../admin/integration-secrets.js'
import type { CommerceProvider, VerifiedPaymentEvent, VerifiedPaymentState } from './providers/types.js'

type Order = typeof paymentOrders.$inferSelect
type Product = typeof commerceProducts.$inferSelect
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

const ticketAmount = (product: Product) => {
  if (product.kind !== 'tickets' || !product.metadata || typeof product.metadata !== 'object') return 0
  const amount = Number((product.metadata as Record<string, unknown>).ticketAmount)
  return Number.isInteger(amount) && amount > 0 ? amount : 0
}

const lockWallet = async (tx: Transaction, userId: string) => {
  await tx.insert(walletAccounts).values({ userId }).onConflictDoNothing()
  return (await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for('update').limit(1))[0]
}

const grantTicketBundle = async (tx: Transaction, order: Order, product: Product) => {
  const tickets = ticketAmount(product)
  if (!tickets) return
  const operationKey = `ticket-purchase:${order.id}`
  await tx.insert(clientEvents).values({
    eventId: order.id,
    eventName: 'ticket_bundle_purchased',
    occurredAt: order.paidAt ?? new Date(),
    userId: order.userId,
    route: 'server:commerce',
    properties: {
      orderId: order.id,
      productId: product.id,
      ticketAmount: tickets,
      providerStatus: order.providerStatus ?? 'paid',
      source: 'server',
    },
  }).onConflictDoNothing()
  if ((await tx.select({ id: walletLedger.id }).from(walletLedger).where(eq(walletLedger.operationKey, operationKey)).limit(1))[0]) return
  const wallet = await lockWallet(tx, order.userId)
  const credit = settlePositiveWalletCredit(wallet, tickets)
  await tx.insert(walletLedger).values({
    userId: order.userId,
    operationKey,
    type: 'earn',
    reason: 'ticket-purchase',
    amount: credit.spendableAmount,
    balanceAfter: credit.balanceAfter,
    rulesVersion: ECONOMY_RULES_VERSION,
    metadata: walletCreditMetadata(credit, {
      orderId: order.id,
      productId: product.id,
      providerStatus: order.providerStatus ?? 'paid',
      ticketAmount: tickets,
      source: 'purchase',
    }),
  })
  await tx.update(walletAccounts).set({
    balance: credit.balanceAfter,
    purchaseDebt: credit.purchaseDebtAfter,
    version: sql`${walletAccounts.version} + 1`,
    updatedAt: order.paidAt ?? new Date(),
  }).where(eq(walletAccounts.userId, order.userId))
}

const reverseTicketBundle = async (tx: Transaction, order: Order, product: Product, occurredAt: Date) => {
  const tickets = ticketAmount(product)
  if (!tickets) return
  const operationKey = `ticket-reversal:${order.id}`
  if ((await tx.select({ id: walletLedger.id }).from(walletLedger).where(eq(walletLedger.operationKey, operationKey)).limit(1))[0]) return
  const grant = (await tx.select({ metadata: walletLedger.metadata }).from(walletLedger)
    .where(eq(walletLedger.operationKey, `ticket-purchase:${order.id}`)).limit(1))[0]
  if (!grant) return
  const wallet = await lockWallet(tx, order.userId)
  const metadata = grant.metadata && typeof grant.metadata === 'object' ? grant.metadata as Record<string, unknown> : {}
  const purchasedAmount = Math.max(0, Number(metadata.grossAmount) || tickets)
  const deductNow = Math.min(wallet.balance, purchasedAmount)
  const balanceAfter = wallet.balance - deductNow
  const debtAdded = purchasedAmount - deductNow
  const purchaseDebt = wallet.purchaseDebt + debtAdded
  await tx.insert(walletLedger).values({
    userId: order.userId,
    operationKey,
    type: 'adjustment',
    reason: order.status === 'chargeback' ? 'ticket-chargeback' : 'ticket-refund',
    amount: -deductNow,
    balanceAfter,
    rulesVersion: ECONOMY_RULES_VERSION,
    metadata: {
      grossAmount: purchasedAmount,
      spendableAmount: -deductNow,
      debtAdded,
      debtSettled: 0,
      orderId: order.id,
      productId: product.id,
      providerStatus: order.status,
      ticketAmount: tickets,
      purchaseDebt,
    },
  })
  await tx.update(walletAccounts).set({
    balance: balanceAfter,
    purchaseDebt,
    version: sql`${walletAccounts.version} + 1`,
    updatedAt: occurredAt,
  }).where(eq(walletAccounts.userId, order.userId))
}

const providerFor = async (db: Database, config: AppConfig, requested = config.commerce.provider): Promise<CommerceProvider> => {
  if (requested === 'stub' && !config.production) return createStubProvider(config.commerce.webhookSecret)
  if (requested === 'robokassa' || requested === 'web' || requested === 'cloudpayments') {
    const environment = await loadIntegrationEnvironment(db, config)
    if (requested === 'robokassa') {
      const password1 = config.commerce.robokassa.testMode
        ? environment.ROBOKASSA_TEST_PASSWORD1
        : environment.ROBOKASSA_PASSWORD1
      const password2 = config.commerce.robokassa.testMode
        ? environment.ROBOKASSA_TEST_PASSWORD2
        : environment.ROBOKASSA_PASSWORD2
      if (environment.ROBOKASSA_MERCHANT_LOGIN && password1 && password2) {
        return createRobokassaProvider({
          merchantLogin: environment.ROBOKASSA_MERCHANT_LOGIN,
          password1,
          password2,
          hashAlgorithm: config.commerce.robokassa.hashAlgorithm,
          testMode: config.commerce.robokassa.testMode,
          receiptTax: config.commerce.robokassa.receiptTax,
          receiptSno: config.commerce.robokassa.receiptSno || undefined,
        })
      }
    }
    const publicId = environment.CLOUDPAYMENTS_PUBLIC_ID || config.commerce.shopId
    const apiSecret = environment.CLOUDPAYMENTS_API_SECRET || config.commerce.secretKey
    if ((requested === 'web' || requested === 'cloudpayments') && publicId && apiSecret) {
      return createCloudPaymentsProvider({ publicId, apiSecret })
    }
  }
  throw new ApiError(503, 'COMMERCE_PROVIDER_UNAVAILABLE', 'Оплата временно недоступна. Попробуйте позже')
}

const applyPaymentState = async (
  tx: Transaction,
  order: Order,
  product: Product,
  state: Pick<VerifiedPaymentState, 'status' | 'occurredAt'>,
) => {
  if (['refunded', 'chargeback'].includes(order.status)) return order.status
  if (state.status === 'paid') {
    const updated = order.status === 'paid' ? order : (await tx.update(paymentOrders).set({
      status: 'paid',
      providerStatus: state.status,
      paidAt: order.paidAt ?? state.occurredAt,
      closedAt: state.occurredAt,
      updatedAt: state.occurredAt,
    }).where(eq(paymentOrders.id, order.id)).returning())[0]
    await grantProductEntitlement(tx, {
      userId: order.userId,
      order: updated,
      product,
      occurredAt: updated.paidAt ?? state.occurredAt,
    })
    await grantTicketBundle(tx, updated, product)
    return updated.status
  }
  if (state.status === 'refunded' || state.status === 'chargeback') {
    await tx.update(paymentOrders).set({
      status: state.status,
      providerStatus: state.status,
      closedAt: state.occurredAt,
      updatedAt: state.occurredAt,
    }).where(eq(paymentOrders.id, order.id))
    await revokeOrderEntitlements(tx, order.id, state.occurredAt)
    await reverseTicketBundle(tx, { ...order, status: state.status }, product, state.occurredAt)
    return state.status
  }
  if (order.status === 'paid') return order.status
  await tx.update(paymentOrders).set({
    status: state.status,
    providerStatus: state.status,
    updatedAt: state.occurredAt,
    ...(['failed', 'canceled', 'expired'].includes(state.status) ? { closedAt: state.occurredAt } : {}),
  }).where(eq(paymentOrders.id, order.id))
  return state.status
}

const providerStateError = (order: Order, state: VerifiedPaymentState) => {
  if (state.orderId && state.orderId !== order.id) {
    return new ApiError(409, 'PAYMENT_ORDER_MISMATCH', 'Платёж относится к другому заказу')
  }
  if (state.accountId && state.accountId !== order.userId) {
    return new ApiError(409, 'PAYMENT_ACCOUNT_MISMATCH', 'Платёж относится к другому аккаунту')
  }
  if (state.amountMinor != null && state.amountMinor !== order.amountMinor) {
    return new ApiError(409, 'PAYMENT_AMOUNT_MISMATCH', 'Сумма платежа не совпадает с суммой заказа')
  }
  if (state.currency && state.currency !== order.currency) {
    return new ApiError(409, 'PAYMENT_CURRENCY_MISMATCH', 'Валюта платежа не совпадает с валютой заказа')
  }
  return null
}

const safeProviderError = (error: unknown) => error instanceof ApiError
  ? `${error.code}${typeof error.details.providerStatus === 'number' ? ` (${error.details.providerStatus})` : ''}: ${error.message}`
  : (error instanceof Error ? error.message : String(error))

const latestProviderCheckAt = (order: Order) => {
  if (!order.metadata || typeof order.metadata !== 'object') return null
  const metadata = order.metadata as Record<string, unknown>
  const candidates = [metadata.lastReconciledAt, metadata.lastReconciliationFailedAt]
    .map((raw) => typeof raw === 'string' ? new Date(raw) : null)
    .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
  if (!candidates.length) return null
  return new Date(Math.max(...candidates.map((date) => date.getTime())))
}

const recordReconciliationFailure = async (db: Database, orderId: string, error: unknown, now: Date) => {
  const message = safeProviderError(error).slice(0, 300)
  await db.update(paymentOrders).set({
    metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({
      lastReconciliationFailedAt: now.toISOString(),
      lastReconciliationError: message,
    })}::jsonb`,
  }).where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.status, 'pending')))
  return message
}

const applyReconciledPaymentState = async (
  db: Database,
  orderId: string,
  state: VerifiedPaymentState,
  now: Date,
  touchPendingUpdatedAt: boolean,
) => db.transaction(async (tx) => {
  const joined = (await tx.select({ order: paymentOrders, product: commerceProducts }).from(paymentOrders)
    .innerJoin(commerceProducts, eq(commerceProducts.id, paymentOrders.productId))
    .where(eq(paymentOrders.id, orderId)).for('update').limit(1))[0]
  if (!joined) return { joined: null, status: 'missing' }
  if (joined.order.status !== 'pending') return { joined, status: joined.order.status }
  const mismatch = providerStateError(joined.order, state)
  if (mismatch) throw mismatch
  const status = await applyPaymentState(tx, joined.order, joined.product, state)
  await upsertCommerceSubscription(tx, joined.order.provider, joined.order, joined.product, state)
  await tx.update(paymentOrders).set({
    metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ lastReconciledAt: now.toISOString() })}::jsonb`,
    ...(status === 'pending' && touchPendingUpdatedAt ? { updatedAt: now } : {}),
  }).where(eq(paymentOrders.id, joined.order.id))
  const refreshed = (await tx.select().from(paymentOrders).where(eq(paymentOrders.id, joined.order.id)).limit(1))[0]
  return {
    joined: refreshed ? { order: refreshed, product: joined.product } : null,
    status,
  }
})

export const publicOrder = (order: Order) => ({
  id: order.id,
  productId: order.productId,
  status: order.status as 'created' | 'pending' | 'paid' | 'failed' | 'canceled' | 'expired' | 'refunded' | 'chargeback',
  amountMinor: order.amountMinor,
  currency: order.currency,
  createdAt: order.createdAt.toISOString(),
  paidAt: order.paidAt?.toISOString() ?? null,
})

export const meCommerce = async (db: Database, userId: string, now = new Date()) => {
  const [membership, entitlements, subscriptions] = await Promise.all([
    getMembershipSummary(db, userId, now),
    getActiveEntitlements(db, userId, now),
    db.select().from(commerceSubscriptions)
      .where(eq(commerceSubscriptions.userId, userId))
      .orderBy(desc(commerceSubscriptions.createdAt))
      .limit(20),
  ])
  return {
    membership,
    entitlements: entitlements.map((entry) => ({ key: entry.entitlementKey, scope: entry.scope, startsAt: entry.startsAt.toISOString(), endsAt: entry.endsAt?.toISOString() ?? null })),
    subscriptions: subscriptions.map((entry) => ({
      id: entry.id,
      productId: entry.productId,
      status: entry.status as 'pending' | 'active' | 'past_due' | 'canceled' | 'rejected' | 'expired',
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      interval: entry.interval as 'Day' | 'Week' | 'Month',
      period: entry.period,
      nextPaymentAt: entry.nextPaymentAt?.toISOString() ?? null,
      canceledAt: entry.canceledAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
    })),
  }
}

const loadOwnedOrder = async (db: Database, userId: string, orderId: string) => {
  const rows = await db.select({ order: paymentOrders, product: commerceProducts }).from(paymentOrders)
    .innerJoin(commerceProducts, eq(commerceProducts.id, paymentOrders.productId))
    .where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.userId, userId))).limit(1)
  if (!rows[0]) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Заказ не найден')
  return rows[0]
}

export const getOrder = async (db: Database, config: AppConfig, userId: string, orderId: string, now = new Date()) => {
  let result = await loadOwnedOrder(db, userId, orderId)
  const lastCheckedAt = latestProviderCheckAt(result.order)
  const providerCheckDue = !lastCheckedAt || now.getTime() - lastCheckedAt.getTime() >= 5_000
  if (result.order.status === 'pending' && result.order.providerPaymentId && providerCheckDue) {
    try {
      const provider = await providerFor(db, config, result.order.provider)
      const state = await provider.getPayment(result.order.providerPaymentId)
      const reconciled = await applyReconciledPaymentState(db, result.order.id, state, now, false)
      if (reconciled.joined) result = reconciled.joined
    } catch (error) {
      await recordReconciliationFailure(db, result.order.id, error, now)
    }
  }
  return { order: publicOrder(result.order), product: publicProduct(result.product) }
}

export const startCheckout = async (
  db: Database,
  config: AppConfig,
  actor: { id: string; email: string; isAnonymous: boolean },
  productId: string,
  idempotencyKey: string,
  acceptance: { offerVersion: string; termsAccepted: true; autoRenew?: boolean },
) => {
  if (!config.commerce.enabled) throw new ApiError(503, 'COMMERCE_DISABLED', 'Оплата пока не включена. Вы можете продолжать играть бесплатно')
  if (actor.isAnonymous) throw new ApiError(403, 'COMMERCE_ACCOUNT_REQUIRED', 'Создайте постоянный аккаунт, чтобы покупка сохранилась')
  const product = (await db.select().from(commerceProducts).where(and(eq(commerceProducts.id, productId), eq(commerceProducts.enabled, true))).limit(1))[0]
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_AVAILABLE', 'Этот продукт сейчас недоступен')
  if (product.kind === 'pack' || (product.kind === 'tickets' && !config.commerce.ticketBundlesEnabled)) {
    throw new ApiError(404, 'PRODUCT_NOT_AVAILABLE', 'Этот продукт сейчас недоступен')
  }
  if (product.currency !== config.commerce.currency) throw new ApiError(409, 'PRODUCT_NOT_AVAILABLE', 'Валюта продукта временно недоступна')

  let order = (await db.select().from(paymentOrders).where(and(
    eq(paymentOrders.userId, actor.id),
    eq(paymentOrders.idempotencyKey, idempotencyKey),
  )).limit(1))[0]
  if (order && order.productId !== product.id) throw new ApiError(409, 'ORDER_ALREADY_CLOSED', 'Этот ключ уже использован для другого заказа')

  let recurrence: { interval: 'Day'; period: number; startDate: string } | undefined
  if (!order && acceptance.autoRenew) {
    if (product.kind !== 'club' || !product.durationDays) {
      throw new ApiError(422, 'SUBSCRIPTION_NOT_AVAILABLE', 'Автопродление доступно только для клубного доступа')
    }
    const existing = (await db.select({ id: commerceSubscriptions.id }).from(commerceSubscriptions).where(and(
      eq(commerceSubscriptions.userId, actor.id),
      or(
        eq(commerceSubscriptions.status, 'pending'),
        eq(commerceSubscriptions.status, 'active'),
        eq(commerceSubscriptions.status, 'past_due'),
      ),
    )).limit(1))[0]
    if (existing) {
      throw new ApiError(409, 'SUBSCRIPTION_ALREADY_ACTIVE', 'Автопродление уже подключено. Для разовой покупки отключите его перед оплатой')
    }
    const membership = await getMembershipSummary(db, actor.id)
    const paidPeriodStartsAt = membership.active && membership.endsAt ? new Date(membership.endsAt) : new Date()
    const firstRecurringPayment = new Date(paidPeriodStartsAt.getTime() + product.durationDays * 86_400_000)
    if (firstRecurringPayment.getTime() - Date.now() > 366 * 86_400_000) {
      throw new ApiError(409, 'SUBSCRIPTION_START_TOO_LATE', 'CloudPayments не может запланировать первое продление позже чем через год. Отключите автопродление для этой покупки')
    }
    recurrence = { interval: 'Day', period: product.durationDays, startDate: firstRecurringPayment.toISOString() }
  }

  if (!order) {
    const inserted = await db.insert(paymentOrders).values({
      userId: actor.id,
      productId: product.id,
      provider: config.commerce.provider,
      amountMinor: product.priceMinor,
      currency: product.currency,
      idempotencyKey,
      metadata: {
        offerVersion: acceptance.offerVersion,
        termsAccepted: acceptance.termsAccepted,
        termsAcceptedAt: new Date().toISOString(),
        autoRenew: Boolean(recurrence),
        ...(recurrence ? { recurrence } : {}),
      },
    }).onConflictDoNothing().returning()
    order = inserted[0] ?? (await db.select().from(paymentOrders).where(and(eq(paymentOrders.userId, actor.id), eq(paymentOrders.idempotencyKey, idempotencyKey))).limit(1))[0]
  }
  if (!order) throw new ApiError(500, 'PAYMENT_CREATION_FAILED', 'Не удалось создать заказ. Попробуйте ещё раз')
  const provider = await providerFor(db, config, order.provider)
  const storedMetadata = order.metadata && typeof order.metadata === 'object'
    ? order.metadata as Record<string, unknown>
    : {}
  const storedRecurrence = storedMetadata.recurrence && typeof storedMetadata.recurrence === 'object'
    ? storedMetadata.recurrence as { interval: 'Day' | 'Week' | 'Month'; period: number; startDate: string }
    : undefined
  const createInput = {
    orderId: order.id,
    invoiceId: order.providerInvoiceId,
    amountMinor: order.amountMinor,
    currency: order.currency,
    description: product.title,
    email: actor.email,
    returnUrl: config.commerce.returnUrl,
    idempotencyKey: order.id,
    metadata: { userId: actor.id, productId: product.id },
    ...(storedRecurrence ? { recurrence: storedRecurrence } : {}),
  }
  if (order.status !== 'created') {
    if (order.status !== 'pending') return { order: publicOrder(order), checkoutUrl: null, widget: null }
    const prepared = await provider.createPayment(createInput)
    return { order: publicOrder(order), checkoutUrl: prepared.checkoutUrl, widget: prepared.widget }
  }

  try {
    const created = await provider.createPayment(createInput)
    const updated = (await db.update(paymentOrders).set({
      providerPaymentId: created.providerPaymentId,
      providerStatus: created.rawStatus,
      status: created.status,
      updatedAt: new Date(),
      ...(created.status === 'paid' ? { paidAt: new Date(), closedAt: new Date() } : {}),
    }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, 'created'))).returning())[0]
    order = updated ?? (await db.select().from(paymentOrders).where(eq(paymentOrders.id, order.id)).limit(1))[0]
    if (created.status === 'paid') {
      await db.transaction(async (tx) => {
        await grantProductEntitlement(tx, { userId: actor.id, order, product, occurredAt: order.paidAt ?? new Date() })
        await grantTicketBundle(tx, order, product)
      })
    }
    return { order: publicOrder(order), checkoutUrl: created.checkoutUrl, widget: created.widget }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(502, 'PAYMENT_CREATION_FAILED', 'Платёжный сервис не ответил. Повторите попытку — новый заказ не создастся')
  }
}

const deterministicUuid = (seed: string) => {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const localSubscriptionStatus = (status: string | undefined) => {
  if (status === 'Active') return 'active' as const
  if (status === 'PastDue') return 'past_due' as const
  if (status === 'Cancelled') return 'canceled' as const
  if (status === 'Rejected') return 'rejected' as const
  if (status === 'Expired') return 'expired' as const
  return 'pending' as const
}

const recurrenceFromOrder = (order: Order) => {
  if (!order.metadata || typeof order.metadata !== 'object') return null
  const raw = (order.metadata as Record<string, unknown>).recurrence
  if (!raw || typeof raw !== 'object') return null
  const recurrence = raw as Record<string, unknown>
  const interval = recurrence.interval
  const period = Number(recurrence.period)
  const startDate = typeof recurrence.startDate === 'string' ? new Date(recurrence.startDate) : null
  if (!['Day', 'Week', 'Month'].includes(String(interval)) || !Number.isInteger(period) || period <= 0 || !startDate || Number.isNaN(startDate.getTime())) return null
  return { interval: interval as 'Day' | 'Week' | 'Month', period, startDate }
}

const upsertCommerceSubscription = async (
  tx: Transaction,
  providerName: string,
  order: Order,
  product: Product,
  state: Pick<VerifiedPaymentState, 'status' | 'subscriptionId' | 'occurredAt'>,
) => {
  const recurrence = recurrenceFromOrder(order)
  if (state.status !== 'paid' || !state.subscriptionId || !recurrence || product.kind !== 'club') return
  await tx.insert(commerceSubscriptions).values({
    provider: providerName,
    providerSubscriptionId: state.subscriptionId,
    userId: order.userId,
    productId: order.productId,
    initialOrderId: order.id,
    status: 'active',
    amountMinor: order.amountMinor,
    currency: order.currency,
    interval: recurrence.interval,
    period: recurrence.period,
    startsAt: recurrence.startDate,
    nextPaymentAt: recurrence.startDate,
    metadata: { createdBy: 'cloudpayments_widget' },
  }).onConflictDoUpdate({
    target: commerceSubscriptions.initialOrderId,
    set: {
      providerSubscriptionId: state.subscriptionId,
      status: 'active',
      nextPaymentAt: recurrence.startDate,
      canceledAt: null,
      updatedAt: state.occurredAt,
    },
  })
}

const processEvent = async (db: Database, providerName: string, event: VerifiedPaymentEvent, rawBody: Buffer) => db.transaction(async (tx) => {
  const insertedEvent = await tx.insert(paymentEvents).values({
    provider: providerName,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    payloadHash: createHash('sha256').update(rawBody).digest('hex'),
    payload: event.payload,
  }).onConflictDoNothing().returning()
  if (!insertedEvent[0]) return { duplicate: true }

  if (event.eventType === 'recurrent') {
    const subscription = event.subscriptionId
      ? (await tx.select().from(commerceSubscriptions).where(and(
        eq(commerceSubscriptions.provider, providerName),
        eq(commerceSubscriptions.providerSubscriptionId, event.subscriptionId),
      )).for('update').limit(1))[0]
      : null
    if (!subscription) {
      throw new ApiError(409, 'SUBSCRIPTION_NOT_FOUND', 'Подписка ещё не зарегистрирована; уведомление нужно повторить')
    }
    if (event.accountId && event.accountId !== subscription.userId) throw new ApiError(409, 'PAYMENT_ACCOUNT_MISMATCH', 'Уведомление относится к другому аккаунту')
    if (event.amountMinor != null && event.amountMinor !== subscription.amountMinor) throw new ApiError(409, 'PAYMENT_AMOUNT_MISMATCH', 'Сумма подписки не совпадает')
    if (event.currency && event.currency !== subscription.currency) throw new ApiError(409, 'PAYMENT_CURRENCY_MISMATCH', 'Валюта подписки не совпадает')
    const status = localSubscriptionStatus(event.subscriptionStatus)
    const now = event.occurredAt
    await tx.update(commerceSubscriptions).set({
      status,
      nextPaymentAt: event.nextPaymentAt ?? null,
      updatedAt: now,
      ...(['canceled', 'rejected', 'expired'].includes(status) ? { canceledAt: now } : {}),
    }).where(eq(commerceSubscriptions.id, subscription.id))
    await tx.update(paymentEvents).set({ status: 'processed', processedAt: new Date() }).where(eq(paymentEvents.id, insertedEvent[0].id))
    return { processed: true }
  }

  const findByOrderId = async () => event.orderId
    ? (await tx.select({ order: paymentOrders, product: commerceProducts }).from(paymentOrders)
      .innerJoin(commerceProducts, eq(commerceProducts.id, paymentOrders.productId))
      .where(and(eq(paymentOrders.provider, providerName), eq(paymentOrders.id, event.orderId))).for('update').limit(1))[0]
    : undefined
  const findByProviderPayment = async () => (await tx.select({ order: paymentOrders, product: commerceProducts }).from(paymentOrders)
      .innerJoin(commerceProducts, eq(commerceProducts.id, paymentOrders.productId))
      .where(and(eq(paymentOrders.provider, providerName), eq(paymentOrders.providerPaymentId, event.providerPaymentId))).for('update').limit(1))[0]
  const providerReferenceFirst = event.eventType === 'refund' || event.eventType === 'cancel'
  let joined = providerReferenceFirst ? await findByProviderPayment() : await findByOrderId()
  joined ??= providerReferenceFirst ? await findByOrderId() : await findByProviderPayment()

  const isLaterSubscriptionPayment = Boolean(
    event.subscriptionId
    && event.status === 'paid'
    && (!joined || (joined.order.status === 'paid' && joined.order.providerPaymentId !== event.providerPaymentId)),
  )
  if (isLaterSubscriptionPayment) {
    const subscription = (await tx.select().from(commerceSubscriptions).where(and(
      eq(commerceSubscriptions.provider, providerName),
      eq(commerceSubscriptions.providerSubscriptionId, event.subscriptionId!),
    )).for('update').limit(1))[0]
    if (!subscription) throw new ApiError(409, 'SUBSCRIPTION_NOT_FOUND', 'Подписка ещё не зарегистрирована; уведомление нужно повторить')
    if (event.accountId && event.accountId !== subscription.userId) throw new ApiError(409, 'PAYMENT_ACCOUNT_MISMATCH', 'Платёж относится к другому аккаунту')
    const insertedOrder = await tx.insert(paymentOrders).values({
      userId: subscription.userId,
      productId: subscription.productId,
      provider: providerName,
      status: 'pending',
      amountMinor: subscription.amountMinor,
      currency: subscription.currency,
      idempotencyKey: deterministicUuid(`${providerName}:${event.providerPaymentId}`),
      providerPaymentId: event.providerPaymentId,
      providerStatus: 'subscription_pending',
      metadata: {
        recurrent: true,
        subscriptionId: subscription.id,
        providerSubscriptionId: subscription.providerSubscriptionId,
      },
    }).onConflictDoNothing().returning()
    const recurringOrder = insertedOrder[0] ?? (await tx.select().from(paymentOrders).where(and(
      eq(paymentOrders.provider, providerName),
      eq(paymentOrders.providerPaymentId, event.providerPaymentId),
    )).limit(1))[0]
    const product = (await tx.select().from(commerceProducts).where(eq(commerceProducts.id, subscription.productId)).limit(1))[0]
    if (recurringOrder && product) joined = { order: recurringOrder, product }
  }

  if (event.eventType === 'fail' && event.subscriptionId) {
    const updatedSubscriptions = await tx.update(commerceSubscriptions).set({
      status: 'past_due',
      updatedAt: event.occurredAt,
    }).where(and(
      eq(commerceSubscriptions.provider, providerName),
      eq(commerceSubscriptions.providerSubscriptionId, event.subscriptionId),
    )).returning({ id: commerceSubscriptions.id })
    if (updatedSubscriptions[0]) {
      await tx.update(paymentEvents).set({ status: 'processed', processedAt: new Date() }).where(eq(paymentEvents.id, insertedEvent[0].id))
      return { processed: true }
    }
  }

  if (!joined) {
    await tx.update(paymentEvents).set({ status: 'ignored', errorCode: 'ORDER_NOT_FOUND', processedAt: new Date() }).where(eq(paymentEvents.id, insertedEvent[0].id))
    return { ignored: true }
  }
  const { order, product } = joined
  const orderMetadata = order.metadata && typeof order.metadata === 'object'
    ? order.metadata as Record<string, unknown>
    : {}
  if (event.orderId && event.orderId !== order.id && !isLaterSubscriptionPayment && orderMetadata.recurrent !== true) {
    throw new ApiError(409, 'PAYMENT_ORDER_MISMATCH', 'Уведомление относится к другому заказу')
  }
  if (event.accountId && event.accountId !== order.userId) {
    throw new ApiError(409, 'PAYMENT_ACCOUNT_MISMATCH', 'Уведомление относится к другому аккаунту')
  }
  if (event.amountMinor != null && event.status === 'refunded' && event.amountMinor < order.amountMinor) {
    await tx.update(paymentEvents).set({
      status: 'ignored',
      errorCode: 'PARTIAL_REFUND_REVIEW_REQUIRED',
      processedAt: new Date(),
    }).where(eq(paymentEvents.id, insertedEvent[0].id))
    return { ignored: true }
  }
  if (event.amountMinor != null && event.amountMinor !== order.amountMinor) {
    throw new ApiError(409, 'PAYMENT_AMOUNT_MISMATCH', 'Сумма уведомления не совпадает с суммой заказа')
  }
  if (event.currency && event.currency !== order.currency) {
    throw new ApiError(409, 'PAYMENT_CURRENCY_MISMATCH', 'Валюта уведомления не совпадает с валютой заказа')
  }
  await applyPaymentState(tx, order, product, event)
  await upsertCommerceSubscription(tx, providerName, order, product, event)
  if (isLaterSubscriptionPayment && event.status === 'paid' && event.subscriptionId) {
    await tx.update(commerceSubscriptions).set({
      status: 'active',
      updatedAt: event.occurredAt,
    }).where(and(
      eq(commerceSubscriptions.provider, providerName),
      eq(commerceSubscriptions.providerSubscriptionId, event.subscriptionId),
    ))
  }
  await tx.update(paymentEvents).set({ status: 'processed', processedAt: new Date() }).where(eq(paymentEvents.id, insertedEvent[0].id))
  return { processed: true }
})

const checkNotificationCode = async (db: Database, providerName: string, event: VerifiedPaymentEvent) => {
  if (!event.orderId) return 10
  const order = (await db.select().from(paymentOrders).where(and(
    eq(paymentOrders.id, event.orderId),
    eq(paymentOrders.provider, providerName),
  )).limit(1))[0]
  if (!order) return 10
  if (event.accountId && event.accountId !== order.userId) return 11
  if (event.amountMinor !== order.amountMinor || event.currency !== order.currency) return 12
  if (!['created', 'pending'].includes(order.status)) return 13
  return 0
}

export const acceptWebhook = async (db: Database, config: AppConfig, providerName: string, rawBody: Buffer, headers: Record<string, unknown>) => {
  const configuredProvider = config.commerce.provider
  const storageProvider = providerName === 'cloudpayments' && configuredProvider === 'web'
    ? 'web'
    : providerName
  if (storageProvider !== configuredProvider) throw new ApiError(404, 'COMMERCE_PROVIDER_UNAVAILABLE', 'Платёжный обработчик не найден')
  const provider = await providerFor(db, config, storageProvider)
  const event = await provider.parseAndVerifyWebhook(rawBody, headers)
  if (event.eventType === 'check') {
    const code = await checkNotificationCode(db, storageProvider, event)
    return { checked: true, acknowledgment: JSON.stringify({ code }), acknowledgmentType: 'application/json; charset=utf-8' }
  }
  return {
    ...await processEvent(db, storageProvider, event, rawBody),
    acknowledgment: event.acknowledgment,
    acknowledgmentType: provider.category === 'cloudpayments' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
  }
}

export const cancelCommerceSubscription = async (db: Database, config: AppConfig, userId: string, subscriptionId: string) => {
  const subscription = (await db.select().from(commerceSubscriptions).where(and(
    eq(commerceSubscriptions.id, subscriptionId),
    eq(commerceSubscriptions.userId, userId),
  )).limit(1))[0]
  if (!subscription) throw new ApiError(404, 'SUBSCRIPTION_NOT_FOUND', 'Автопродление не найдено')
  if (['canceled', 'rejected', 'expired'].includes(subscription.status)) return { subscription: { id: subscription.id, status: subscription.status } }
  if (!subscription.providerSubscriptionId) {
    throw new ApiError(409, 'SUBSCRIPTION_NOT_READY', 'Автопродление ещё настраивается. Попробуйте отменить через минуту')
  }
  const provider = await providerFor(db, config, subscription.provider)
  if (!provider.cancelSubscription) throw new ApiError(409, 'SUBSCRIPTION_NOT_AVAILABLE', 'Провайдер не поддерживает отмену автопродления')
  await provider.cancelSubscription(subscription.providerSubscriptionId, subscription.id)
  const now = new Date()
  const updated = (await db.update(commerceSubscriptions).set({
    status: 'canceled',
    canceledAt: now,
    nextPaymentAt: null,
    updatedAt: now,
  }).where(eq(commerceSubscriptions.id, subscription.id)).returning())[0]
  return { subscription: { id: updated.id, status: updated.status } }
}

export const confirmStubOrder = async (db: Database, config: AppConfig, orderId: string) => {
  if (config.production || config.commerce.provider !== 'stub') throw new ApiError(404, 'ORDER_NOT_FOUND', 'Заказ не найден')
  return db.transaction(async (tx) => {
    const joined = await tx.select({ order: paymentOrders, product: commerceProducts }).from(paymentOrders)
      .innerJoin(commerceProducts, eq(commerceProducts.id, paymentOrders.productId)).where(eq(paymentOrders.id, orderId)).for('update').limit(1)
    if (!joined[0]) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Заказ не найден')
    const { order, product } = joined[0]
    if (order.status === 'paid') return { order: publicOrder(order) }
    if (!['created', 'pending'].includes(order.status)) throw new ApiError(409, 'ORDER_ALREADY_CLOSED', 'Заказ уже закрыт')
    const occurredAt = new Date()
    const updated = (await tx.update(paymentOrders).set({ status: 'paid', providerStatus: 'paid', paidAt: occurredAt, closedAt: occurredAt, updatedAt: occurredAt }).where(eq(paymentOrders.id, order.id)).returning())[0]
    await grantProductEntitlement(tx, { userId: order.userId, order: updated, product, occurredAt })
    await grantTicketBundle(tx, updated, product)
    return { order: publicOrder(updated) }
  })
}

/**
 * Polling is the safety net for a missed or delayed provider webhook. Created
 * orders without a provider payment are expired separately and never grant an
 * entitlement.
 */
export const reconcileCommerceOrders = async (db: Database, config: AppConfig, now = new Date()) => {
  const createdCutoff = new Date(now.getTime() - 72 * 60 * 60_000)
  const pendingCutoff = new Date(now.getTime() - 15 * 60_000)
  const expiredCreated = await db.update(paymentOrders).set({
    status: 'expired',
    providerStatus: 'local_expired',
    closedAt: now,
    updatedAt: now,
    metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ expirationReason: 'provider_payment_not_created' })}::jsonb`,
  }).where(and(
    eq(paymentOrders.status, 'created'),
    isNull(paymentOrders.providerPaymentId),
    lt(paymentOrders.updatedAt, createdCutoff),
  )).returning({ id: paymentOrders.id })

  const candidates = await db.select({ order: paymentOrders, product: commerceProducts }).from(paymentOrders)
    .innerJoin(commerceProducts, eq(commerceProducts.id, paymentOrders.productId))
    .where(and(
      eq(paymentOrders.status, 'pending'),
      isNotNull(paymentOrders.providerPaymentId),
      lt(paymentOrders.updatedAt, pendingCutoff),
    )).limit(100)
  const providers = new Map<string, CommerceProvider>()
  const reconciled: Array<{ orderId: string; status: string }> = []
  const failures: Array<{ orderId: string; message: string }> = []
  for (const candidate of candidates) {
    try {
      let provider = providers.get(candidate.order.provider)
      if (!provider) {
        provider = await providerFor(db, config, candidate.order.provider)
        providers.set(candidate.order.provider, provider)
      }
      const state = await provider.getPayment(candidate.order.providerPaymentId!)
      const applied = await applyReconciledPaymentState(db, candidate.order.id, state, now, true)
      reconciled.push({ orderId: candidate.order.id, status: applied.status })
    } catch (error) {
      if (
        error instanceof ApiError
        && error.code === 'ORDER_NOT_FOUND'
        && candidate.order.updatedAt < createdCutoff
      ) {
        await db.update(paymentOrders).set({
          status: 'expired',
          providerStatus: 'not_found',
          closedAt: now,
          updatedAt: now,
          metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({
            expirationReason: 'provider_payment_not_found',
            lastReconciledAt: now.toISOString(),
          })}::jsonb`,
        }).where(and(eq(paymentOrders.id, candidate.order.id), eq(paymentOrders.status, 'pending')))
        reconciled.push({ orderId: candidate.order.id, status: 'expired' })
        continue
      }
      const safeMessage = safeProviderError(error)
      failures.push({
        orderId: candidate.order.id,
        message: safeMessage.slice(0, 300),
      })
      await db.update(paymentOrders).set({
        metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({
          lastReconciliationFailedAt: now.toISOString(),
          lastReconciliationError: safeMessage.slice(0, 300),
        })}::jsonb`,
      }).where(eq(paymentOrders.id, candidate.order.id))
    }
  }
  if (failures.length) {
    throw new ApiError(503, 'COMMERCE_RECONCILIATION_FAILED', `Не удалось сверить ${failures.length} платёжных заказов`, {
      reconciled: reconciled.length,
      failures,
    })
  }
  return {
    checked: candidates.length,
    reconciled,
    expiredCreatedOrderIds: expiredCreated.map((entry) => entry.id),
  }
}

export const revokeEntitlementById = async (db: Database, id: string, occurredAt = new Date()) => {
  const rows = await db.update(userEntitlements).set({ status: 'revoked', revokedAt: occurredAt, updatedAt: occurredAt }).where(eq(userEntitlements.id, id)).returning()
  if (!rows[0]) throw new ApiError(404, 'ENTITLEMENT_NOT_FOUND', 'Доступ не найден')
  return rows[0]
}
