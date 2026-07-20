import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import { commerceProducts, paymentEvents, paymentOrders, userEntitlements, type Database } from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getActiveEntitlements, getMembershipSummary, grantProductEntitlement, revokeOrderEntitlements } from './entitlements.js'
import { publicProduct } from './products.js'
import { createStubProvider } from './providers/stub.js'
import { createYooKassaProvider } from './providers/yookassa.js'
import { loadIntegrationEnvironment } from '../admin/integration-secrets.js'
import type { CommerceProvider, VerifiedPaymentEvent } from './providers/types.js'

type Order = typeof paymentOrders.$inferSelect
type Product = typeof commerceProducts.$inferSelect

const providerFor = async (db: Database, config: AppConfig, requested = config.commerce.provider): Promise<CommerceProvider> => {
  if (requested === 'stub' && !config.production) return createStubProvider(config.commerce.webhookSecret)
  if (requested === 'web') {
    const environment = await loadIntegrationEnvironment(db, config)
    const shopId = environment.YOOKASSA_SHOP_ID || config.commerce.shopId
    const secretKey = environment.YOOKASSA_SECRET_KEY || config.commerce.secretKey
    if (shopId && secretKey) return createYooKassaProvider({ shopId, secretKey })
  }
  throw new ApiError(503, 'COMMERCE_PROVIDER_UNAVAILABLE', 'Оплата временно недоступна. Попробуйте позже')
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

export const startCheckout = async (db: Database, config: AppConfig, actor: { id: string; isAnonymous: boolean }, productId: string, idempotencyKey: string, acceptance: { offerVersion: string; termsAccepted: true }) => {
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
      amountMinor: order.amountMinor,
      currency: order.currency,
      description: product.title,
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
  const terminal = ['refunded', 'chargeback'].includes(order.status)
  if (!terminal) {
    if (event.status === 'paid') {
      await tx.update(paymentOrders).set({ status: 'paid', providerStatus: event.status, paidAt: order.paidAt ?? event.occurredAt, closedAt: event.occurredAt, updatedAt: event.occurredAt }).where(eq(paymentOrders.id, order.id))
      await grantProductEntitlement(tx, { userId: order.userId, order, product, occurredAt: order.paidAt ?? event.occurredAt })
    } else if (event.status === 'refunded' || event.status === 'chargeback') {
      await tx.update(paymentOrders).set({ status: event.status, providerStatus: event.status, closedAt: event.occurredAt, updatedAt: event.occurredAt }).where(eq(paymentOrders.id, order.id))
      await revokeOrderEntitlements(tx, order.id, event.occurredAt)
    } else if (order.status !== 'paid') {
      await tx.update(paymentOrders).set({ status: event.status, providerStatus: event.status, updatedAt: event.occurredAt, ...(['failed', 'canceled', 'expired'].includes(event.status) ? { closedAt: event.occurredAt } : {}) }).where(eq(paymentOrders.id, order.id))
    }
  }
  await tx.update(paymentEvents).set({ status: 'processed', processedAt: new Date() }).where(eq(paymentEvents.id, insertedEvent[0].id))
  return { processed: true }
})

export const acceptWebhook = async (db: Database, config: AppConfig, providerName: string, rawBody: Buffer, headers: Record<string, unknown>) => {
  if (providerName !== config.commerce.provider) throw new ApiError(404, 'COMMERCE_PROVIDER_UNAVAILABLE', 'Платёжный обработчик не найден')
  const provider = await providerFor(db, config, providerName)
  const event = await provider.parseAndVerifyWebhook(rawBody, headers)
  return processEvent(db, providerName, event, rawBody)
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

export const revokeEntitlementById = async (db: Database, id: string, occurredAt = new Date()) => {
  const rows = await db.update(userEntitlements).set({ status: 'revoked', revokedAt: occurredAt, updatedAt: occurredAt }).where(eq(userEntitlements.id, id)).returning()
  if (!rows[0]) throw new ApiError(404, 'ENTITLEMENT_NOT_FOUND', 'Доступ не найден')
  return rows[0]
}
