import { Type } from '@sinclair/typebox'
import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '@shoditsa/config'
import { GROWTH_STAGES, type GrowthStage } from '@shoditsa/contracts'
import { appSettings, auditLog, type Database } from '@shoditsa/database'
import type { Auth } from '../auth/auth.js'
import { requireAdmin } from '../auth/session.js'
import { advanceGrowthPolicy, GROWTH_SETTING, growthReport, normalizeGrowthPolicy } from './service.js'

export const registerGrowthRoutes = async (app: FastifyInstance, deps: { db: Database; auth: Auth; config: AppConfig }) => {
  app.get('/api/v1/admin/growth', { schema: { querystring: Type.Object({ days: Type.Optional(Type.Union([Type.Literal('7'), Type.Literal('14'), Type.Literal('31')])) }, { additionalProperties: false }) } }, async (request) => {
    await requireAdmin(request, deps.auth, deps.db, deps.config)
    return growthReport(deps.db, Number((request.query as { days?: string }).days ?? 7))
  })
  app.patch('/api/v1/admin/growth', { schema: { body: Type.Object({ stage: Type.Union(GROWTH_STAGES.map((stage) => Type.Literal(stage))), measurementReviewed: Type.Literal(true) }, { additionalProperties: false }) } }, async (request) => {
    const actor = await requireAdmin(request, deps.auth, deps.db, deps.config)
    return deps.db.transaction(async (tx) => {
      await tx.insert(appSettings).values({ key: GROWTH_SETTING, value: { stage: 'baseline' } }).onConflictDoNothing()
      const row = (await tx.select().from(appSettings).where(eq(appSettings.key, GROWTH_SETTING)).for('update'))[0]
      const before = normalizeGrowthPolicy(row.value)
      const after = advanceGrowthPolicy(before, (request.body as { stage: GrowthStage }).stage)
      await tx.update(appSettings).set({ value: after, updatedBy: actor.id, updatedAt: new Date(), version: sql`${appSettings.version} + 1` }).where(eq(appSettings.key, GROWTH_SETTING))
      await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'growth.stage_changed', entityType: 'app_setting', entityId: GROWTH_SETTING, before, after, requestId: request.id })
      return after
    })
  })
}
