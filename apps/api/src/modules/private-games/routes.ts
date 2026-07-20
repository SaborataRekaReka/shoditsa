import { desc, eq } from 'drizzle-orm'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '@shoditsa/config'
import {
  AdminPrivateGameOrderPatchSchema, PrivateGameOrderBodySchema, UuidSchema,
  type AdminPrivateGameOrderPatch, type PrivateGameOrderBody,
} from '@shoditsa/contracts'
import { auditLog, privateGameOrders, type Database } from '@shoditsa/database'
import type { Auth } from '../auth/auth.js'
import { getRequestUser, requireAdmin } from '../auth/session.js'
import { ApiError } from '../../lib/errors.js'

type Deps = { db: Database; auth: Auth; config: AppConfig }

export const registerPrivateGameRoutes = (app: FastifyInstance, deps: Deps) => {
  app.post('/api/v1/private-game-orders', {
    schema: { body: PrivateGameOrderBodySchema },
    config: { rateLimit: { max: 3, timeWindow: '1 day' } },
  }, async (request) => {
    const user = await getRequestUser(request, deps.auth, deps.db, false, deps.config)
    const body = request.body as PrivateGameOrderBody
    if (body.website) throw new ApiError(422, 'PRIVATE_GAME_ORDER_REJECTED', 'Не удалось отправить заявку')
    const inserted = (await deps.db.insert(privateGameOrders).values({
      userId: user?.id ?? null,
      contactName: body.contactName.trim(),
      email: body.email.trim().toLocaleLowerCase('en-US'),
      company: body.company?.trim() || null,
      participants: body.participants,
      eventDate: body.eventDate ?? null,
      description: body.description.trim(),
    }).returning())[0]
    return { id: inserted.id, status: 'new' as const, createdAt: inserted.createdAt.toISOString() }
  })

  app.get('/api/v1/admin/private-game-orders', async (request) => {
    await requireAdmin(request, deps.auth, deps.db, deps.config)
    return { items: await deps.db.select().from(privateGameOrders).orderBy(desc(privateGameOrders.createdAt)).limit(200) }
  })

  app.patch('/api/v1/admin/private-game-orders/:id', {
    schema: { params: Type.Object({ id: UuidSchema }, { additionalProperties: false }), body: AdminPrivateGameOrderPatchSchema },
  }, async (request) => {
    const actor = await requireAdmin(request, deps.auth, deps.db, deps.config)
    const { id } = request.params as { id: string }
    const body = request.body as AdminPrivateGameOrderPatch
    const before = (await deps.db.select().from(privateGameOrders).where(eq(privateGameOrders.id, id)).limit(1))[0]
    if (!before) throw new ApiError(404, 'PRIVATE_GAME_ORDER_NOT_FOUND', 'Заявка не найдена')
    const updated = (await deps.db.update(privateGameOrders).set({
      ...(body.status ? { status: body.status } : {}),
      ...(body.internalNote !== undefined ? { internalNote: body.internalNote?.trim() || null } : {}),
      ...(body.packId !== undefined ? { packId: body.packId } : {}),
      updatedAt: new Date(),
    }).where(eq(privateGameOrders.id, id)).returning())[0]
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'private_game_order.update', entityType: 'private_game_order', entityId: id, before, after: updated, reason: body.reason, requestId: request.id })
    return updated
  })
}
