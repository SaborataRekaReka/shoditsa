import { Type } from '@sinclair/typebox'
import { UuidSchema, WordActionBodySchema, type WordActionBody } from '@shoditsa/contracts'
import type { FastifyInstance } from 'fastify'
import type { Database } from '@shoditsa/database'
import type { AppConfig } from '@shoditsa/config'
import type { Auth } from '../auth/auth.js'
import { getRequestUser } from '../auth/session.js'
import { requireIdempotencyKey } from '../../lib/errors.js'
import { applyWordAction } from './service.js'

export function registerWordRoutes(app: FastifyInstance, { db, auth, config }: { db: Database; auth: Auth; config: AppConfig }) {
  app.post('/api/v1/word/sessions/:sessionId/actions', {
    schema: { params: Type.Object({ sessionId: UuidSchema }, { additionalProperties: false }), headers: Type.Object({ 'idempotency-key': UuidSchema }, { additionalProperties: true }), body: WordActionBodySchema },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async request => {
    const user = await getRequestUser(request, auth, db, true, config)
    return applyWordAction(db, user!.id, (request.params as { sessionId: string }).sessionId, request.body as WordActionBody, requireIdempotencyKey(request))
  })
}
