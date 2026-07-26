import { createHash } from 'node:crypto'
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import { commerceProducts, paymentEvents, paymentOrders, userEntitlements, type Database } from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getActiveEntitlements, getMembershipSummary, grantProductEntitlement, revokeOrderEntitlements } from './entitlements.js'
import { publicProduct } from './products.js'
import { createRobokassaProvider } from './providers/robokassa.js'
import { createStubProvider } from './providers/stub.js'
import { createYooKassaProvider } from './providers/yookassa.js'
import { loadIntegrationEnvironment } from '../admin/integration-secrets.js'
import type { CommerceProvider, VerifiedPaymentEvent, VerifiedPaymentState } from './providers/types.js'

type Order = typeof paymentOrders.$inferSelect
type Product = typeof commerceProducts.$inferSelect
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

const providerFor = async (db: Database, config: AppConfig, requested = config.commerce.provider): Promise<CommerceProvider> => {
  if (requested === 'stub' && !config.production) return createStubProvider(config.commerce.webhookSecret)
  if (requested === 'robokassa' || requested === 'web') {
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
    const shopId = environment.YOOKASSA_SHOP_ID || config.commerce.shopId
    const secretKey = environment.YOOKASSA_SECRET_KEY || config.commerce.secretKey
    if (requested === 'web' && shopId && secretKey) return createYooKassaProvider({ shopId, secretKey })
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

export const publicOrder = (order: Order) => ({
  id: order.id,
  productId: order.productId,
  status: order.status as 'created' | 'pending' | 'paid' | 'failed' | 'canceled' | 'expired' | 'refunded' | 'chargeback',
  amountMinor: order.amountMinor,
  currency: order.currency,
  createdAt: order.createdAt.toISOString(),
  paidAt: order.paidAt?.toISOString() ?? null,
})

const checkoutUrl = (config: AppConfig, order: Order) => {
  if (order.status === 'paid') return null
  const url = new URL(config.commerce.returnUrl)
  url.searchParams.set('orderId', order.id)
  return url.toString()
}

export const meCommerce = async (db: Database, userId: string, now = new Date()) => {
  const [membership, entitlements] = await Promise.all([getMembershipSummary(db, userId, now), getActiveEntitlements(db, userId, now)])
  return {
    membership,
    entitlements: entitlements.map((entry) => ({ key: entry.entitlementKey, scope: entry.scope, startsAt: entry.startsAt.toISOString(), endsAt: entry.endsAt?.toISOString() ?? null })),
  }
}

const loadOwnedOrder = async (db: Database, userId: string, orderId: string) => {
  const rows = await db.select({ order: paymentOrders, product: commerceProducts }).from(paymentOrders)
    .innerJoin(commerceProducts, eq(commerceProducts.id, paymentOrders.productId))
    .where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.userId, userId))).limit(1)
  if (!rows[0]) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Заказ не найден')
  return rows[0]
}

export const getOrder = async (db: Database, userId: string, orderId: string) => {
  const result = await loadOwnedOrder(db, userId, orderId)
  return { order: publicOrder(result.order), product: publicProduct(result.product) }
}

export const startCheckout = async (db: Database, config: AppConfig, actor: { id: string; email: string; isAnonymous: boolean }, productId: string, idempotencyKey: string, acceptance: { offerVersion: string; termsAccepted: true }) => {
  if (!config.commerce.enabled) throw new ApiError(503, 'COMMERCE_DISABLED', 'Оплата пока не включена. Вы можете продолжать играть бесплатно')
  if (actor.isAnonymous) throw new ApiError(403, 'COMMERCE_ACCOUNT_REQUIRED', 'Создайте постоянный аккаунт, чтобы покупка сохранилась')
  const product = (await db.select().from(commerceProducts).where(and(eq(commerceProducts.id, productId), eq(commerceProducts.enabled, true))).limit(1))[0]
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_AVAILABLE', 'Этот продукт сейчас недоступен')
  if (product.currency !== config.commerce.currency) throw new ApiError(409, 'PRODUCT_NOT_AVAILABLE', 'Валюта продукта временно недоступна')

  let order = (await db.select().from(paymentOrders).where(and(eq(paymentOrders.userId, actor.id), eq(paymentOrders.idempotencyKey, idempotencyKey))).limit(1))[0]
  if (order && order.productId !== product.id) throw new ApiError(409, 'ORDER_ALREADY_CLOSED', 'Этот ключ уже использован для другого заказа')
  if (!order) {
    const inserted = await db.insert(paymentOrders).values({
      userId: actor.id,
      productId: product.id,
      provider: config.commerce.provider,
      amountMinor: product.priceMinor,
      currency: product.currency,
      idempotencyKey,
      metadata: { offerVersion: acceptance.offerVersion, termsAccepted: acceptance.termsAccepted, termsAcceptedAt: new Date().toISOString() },
    }).onConflictDoNothing().returning()
    order = inserted[0] ?? (await db.select().from(paymentOrders).where(and(eq(paymentOrders.userId, actor.id), eq(paymentOrders.idempotencyKey, idempotencyKey))).limit(1))[0]
  }
  if (!order) throw new ApiError(500, 'PAYMENT_CREATION_FAILED', 'Не удалось создать заказ. Попробуйте ещё раз')
  if (order.status !== 'created') return { order: publicOrder(order), checkoutUrl: checkoutUrl(config, order) }

  const provider = await providerFor(db, config, order.provider)
  try {
    const created = await provider.createPayment({
      orderId: order.id,
      invoiceId: order.providerInvoiceId,
      amountMinor: order.amountMinor,
      currency: order.currency,
      description: product.title,
      email: actor.email,
      returnUrl: config.commerce.returnUrl,
      idempotencyKey: order.id,
      metadata: { userId: actor.id, productId: product.id },
    })
    const updated = (await db.update(paymentOrders).set({
      providerPaymentId: created.providerPaymentId,
      providerStatus: created.rawStatus,
      status: created.status,
      updatedAt: new Date(),
      ...(created.status === 'paid' ? { paidAt: new Date(), closedAt: new Date() } : {}),
    }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, 'created'))).returning())[0]
    order = updated ?? (await db.select().from(paymentOrders).where(eq(paymentOrders.id, order.id)).limit(1))[0]
    if (created.status === 'paid') {
      await db.transaction(async (tx) => grantProductEntitlement(tx, { userId: actor.id, order, product, occurredAt: order.paidAt ?? new Date() }))
    }
    return { order: publicOrder(order), checkoutUrl: created.checkoutUrl }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(502, 'PAYMENT_CREATION_FAILED', 'Платёжный сервис не ответил. Повторите попытку — новый заказ не создастся')
  }
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

  const joined = await tx.select({ order: paymentOrders, product: commerceProducts }).from(paymentOrders)
    .innerJoin(commerceProducts, eq(commerceProducts.id, paymentOrders.productId))
    .where(and(eq(paymentOrders.provider, providerName), eq(paymentOrders.providerPaymentId, event.providerPaymentId))).for('update').limit(1)
  if (!joined[0]) {
    await tx.update(paymentEvents).set({ status: 'ignored', errorCode: 'ORDER_NOT_FOUND', processedAt: new Date() }).where(eq(paymentEvents.id, insertedEvent[0].id))
    return { ignored: true }
  }
  const { order, product } = joined[0]
  if (event.orderId && event.orderId !== order.id) {
    throw new ApiError(409, 'PAYMENT_ORDER_MISMATCH', 'Уведомление относится к другому заказу')
  }
  if (event.amountMinor != null && event.amountMinor !== order.amountMinor) {
    throw new ApiError(409, 'PAYMENT_AMOUNT_MISMATCH', 'Сумма уведомления не совпадает с суммой заказа')
  }
  if (event.currency && event.currency !== order.currency) {
    throw new ApiError(409, 'PAYMENT_CURRENCY_MISMATCH', 'Валюта уведомления не совпадает с валютой заказа')
  }
  await applyPaymentState(tx, order, product, event)
  await tx.update(paymentEvents).set({ status: 'processed', processedAt: new Date() }).where(eq(paymentEvents.id, insertedEvent[0].id))
  return { processed: true }
})

export const acceptWebhook = async (db: Database, config: AppConfig, providerName: string, rawBody: Buffer, headers: Record<string, unknown>) => {
  if (providerName !== config.commerce.provider) throw new ApiError(404, 'COMMERCE_PROVIDER_UNAVAILABLE', 'Платёжный обработчик не найден')
  const provider = await providerFor(db, config, providerName)
  const event = await provider.parseAndVerifyWebhook(rawBody, headers)
  return { ...await processEvent(db, providerName, event, rawBody), acknowledgment: event.acknowledgment }
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
      const status = await db.transaction(async (tx) => {
        const joined = await tx.select({ order: paymentOrders, product: commerceProducts }).from(paymentOrders)
          .innerJoin(commerceProducts, eq(commerceProducts.id, paymentOrders.productId))
          .where(eq(paymentOrders.id, candidate.order.id)).for('update').limit(1)
        if (!joined[0] || joined[0].order.status !== 'pending') return joined[0]?.order.status ?? 'missing'
        const appliedStatus = await applyPaymentState(tx, joined[0].order, joined[0].product, state)
        await tx.update(paymentOrders).set({
          metadata: sql`${paymentOrders.metadata} || ${JSON.stringify({ lastReconciledAt: now.toISOString() })}::jsonb`,
          ...(appliedStatus === 'pending' ? { updatedAt: now } : {}),
        }).where(eq(paymentOrders.id, candidate.order.id))
        return appliedStatus
      })
      reconciled.push({ orderId: candidate.order.id, status })
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
      const safeMessage = error instanceof ApiError
        ? `${error.code}${typeof error.details.providerStatus === 'number' ? ` (${error.details.providerStatus})` : ''}: ${error.message}`
        : (error instanceof Error ? error.message : String(error))
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
