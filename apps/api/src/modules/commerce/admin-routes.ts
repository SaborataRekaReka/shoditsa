import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { and, desc, eq, lt } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import {
  AdminCommerceListQuerySchema, AdminCommerceProductPatchSchema, AdminEntitlementGrantBodySchema,
  AdminEntitlementRevokeBodySchema, UuidSchema,
  type AdminCommerceListQuery, type AdminCommerceProductPatch, type AdminEntitlementGrantBody, type AdminEntitlementRevokeBody,
} from '@shoditsa/contracts'
import { auditLog, commerceProducts, paymentOrders, user, userEntitlements, type Database } from '@shoditsa/database'
import type { Auth } from '../auth/auth.js'
import { requireAdmin } from '../auth/session.js'
import { ApiError, requireIdempotencyKey } from '../../lib/errors.js'

type Deps = { db: Database; auth: Auth; config: AppConfig }
const idempotencyHeaders = Type.Object({ 'idempotency-key': UuidSchema }, { additionalProperties: true })
const idParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 160 }) }, { additionalProperties: false })

export const registerCommerceAdminRoutes = async (app: FastifyInstance, deps: Deps) => {
  app.get('/api/v1/admin/commerce/products', async (request) => {
    await requireAdmin(request, deps.auth, deps.db, deps.config)
    return { items: await deps.db.select().from(commerceProducts).orderBy(commerceProducts.sortOrder, commerceProducts.id) }
  })
  app.patch('/api/v1/admin/commerce/products/:id', { schema: { params: idParams, body: AdminCommerceProductPatchSchema } }, async (request) => {
    const actor = await requireAdmin(request, deps.auth, deps.db, deps.config)
    const id = (request.params as { id: string }).id
    const body = request.body as AdminCommerceProductPatch
    if (!body.reason?.trim()) throw new ApiError(422, 'ADMIN_REASON_REQUIRED', 'Укажите причину изменения')
    const before = (await deps.db.select().from(commerceProducts).where(eq(commerceProducts.id, id)).limit(1))[0]
    if (!before) throw new ApiError(404, 'PRODUCT_NOT_AVAILABLE', 'Продукт не найден')
    const { reason: _reason, ...changes } = body
    const updated = (await deps.db.update(commerceProducts).set({ ...changes, updatedAt: new Date() }).where(eq(commerceProducts.id, id)).returning())[0]
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'commerce.product.update', entityType: 'commerce_product', entityId: id, before, after: updated, reason: body.reason, requestId: request.id })
    return updated
  })
  app.get('/api/v1/admin/commerce/orders', { schema: { querystring: AdminCommerceListQuerySchema } }, async (request) => {
    await requireAdmin(request, deps.auth, deps.db, deps.config)
    const query = request.query as AdminCommerceListQuery
    const filters = []
    if (query.status) filters.push(eq(paymentOrders.status, query.status))
    if (query.cursor) filters.push(lt(paymentOrders.createdAt, new Date(query.cursor)))
    const rows = await deps.db.select({ order: paymentOrders, userEmail: user.email, productTitle: commerceProducts.title }).from(paymentOrders)
      .innerJoin(user, eq(user.id, paymentOrders.userId)).innerJoin(commerceProducts, eq(commerceProducts.id, paymentOrders.productId))
      .where(filters.length ? and(...filters) : undefined).orderBy(desc(paymentOrders.createdAt)).limit(query.limit ?? 50)
    return { items: rows }
  })
  app.get('/api/v1/admin/commerce/entitlements', { schema: { querystring: AdminCommerceListQuerySchema } }, async (request) => {
    await requireAdmin(request, deps.auth, deps.db, deps.config)
    const query = request.query as AdminCommerceListQuery
    const filters = []
    if (query.status) filters.push(eq(userEntitlements.status, query.status))
    if (query.cursor) filters.push(lt(userEntitlements.createdAt, new Date(query.cursor)))
    const rows = await deps.db.select({ entitlement: userEntitlements, userEmail: user.email }).from(userEntitlements)
      .innerJoin(user, eq(user.id, userEntitlements.userId)).where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(userEntitlements.createdAt)).limit(query.limit ?? 50)
    return { items: rows }
  })
  app.post('/api/v1/admin/commerce/entitlements/grant', { schema: { headers: idempotencyHeaders, body: AdminEntitlementGrantBodySchema } }, async (request) => {
    const actor = await requireAdmin(request, deps.auth, deps.db, deps.config)
    const body = request.body as AdminEntitlementGrantBody
    const idempotencyKey = requireIdempotencyKey(request)
    if (body.entitlementKey === 'club' && (!body.durationDays || body.permanent)) throw new ApiError(422, 'ENTITLEMENT_DURATION_REQUIRED', 'Для ручного клубного доступа укажите срок')
    if ((body.entitlementKey === 'pack' || body.entitlementKey === 'supporter') && !body.scope) throw new ApiError(422, 'ENTITLEMENT_SCOPE_REQUIRED', 'Для этого доступа укажите scope')
    if ((body.entitlementKey === 'pack' || body.entitlementKey === 'supporter') && !body.permanent) throw new ApiError(422, 'ENTITLEMENT_PERMANENT_REQUIRED', 'Доступ к набору и supporter-жетон должны быть постоянными')
    const sourceId = `${actor.id}:${idempotencyKey}`
    return deps.db.transaction(async (tx) => {
      const replay = (await tx.select().from(userEntitlements).where(and(eq(userEntitlements.sourceType, 'admin'), eq(userEntitlements.sourceId, sourceId))).limit(1))[0]
      if (replay) return replay
      const startsAtInput = body.startsAt ? new Date(body.startsAt) : new Date()
      let startsAt = startsAtInput
      if (body.entitlementKey === 'club') {
        const grants = await tx.select().from(userEntitlements).where(and(eq(userEntitlements.userId, body.userId), eq(userEntitlements.entitlementKey, 'club'), eq(userEntitlements.status, 'active'))).for('update')
        for (const grant of grants) if (grant.endsAt && grant.endsAt > startsAt) startsAt = grant.endsAt
      }
      const endsAt = body.permanent ? null : new Date(startsAt.getTime() + (body.durationDays ?? 0) * 86_400_000)
      const inserted = (await tx.insert(userEntitlements).values({
        userId: body.userId, entitlementKey: body.entitlementKey, scope: body.scope ?? null, startsAt, endsAt,
        sourceType: 'admin', sourceId, metadata: { reason: body.reason },
      }).returning())[0]
      await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'commerce.entitlement.grant', entityType: 'user_entitlement', entityId: inserted.id, after: inserted, reason: body.reason, requestId: request.id })
      return inserted
    })
  })
  app.post('/api/v1/admin/commerce/entitlements/:id/revoke', { schema: { params: Type.Object({ id: UuidSchema }, { additionalProperties: false }), body: AdminEntitlementRevokeBodySchema } }, async (request) => {
    const actor = await requireAdmin(request, deps.auth, deps.db, deps.config)
    const id = (request.params as { id: string }).id
    const body = request.body as AdminEntitlementRevokeBody
    const before = (await deps.db.select().from(userEntitlements).where(eq(userEntitlements.id, id)).limit(1))[0]
    if (!before) throw new ApiError(404, 'ENTITLEMENT_NOT_FOUND', 'Доступ не найден')
    if (before.status === 'revoked') throw new ApiError(409, 'ENTITLEMENT_ALREADY_REVOKED', 'Этот доступ уже отозван')
    const now = new Date()
    const updated = (await deps.db.update(userEntitlements).set({ status: 'revoked', revokedAt: now, updatedAt: now }).where(eq(userEntitlements.id, id)).returning())[0]
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'commerce.entitlement.revoke', entityType: 'user_entitlement', entityId: id, before, after: updated, reason: body.reason, requestId: request.id })
    return updated
  })
}
