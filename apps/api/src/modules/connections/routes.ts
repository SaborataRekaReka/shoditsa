import { Type } from '@sinclair/typebox'
import {
  ConnectionsGuessBodySchema,
  ConnectionsHintBodySchema,
  UuidSchema,
  type ConnectionsGuessBody,
  type ConnectionsHintBody,
} from '@shoditsa/contracts'
import type { AppConfig } from '@shoditsa/config'
import type { Database } from '@shoditsa/database'
import type { FastifyInstance } from 'fastify'
import type { Auth } from '../auth/auth.js'
import { getRequestUser } from '../auth/session.js'
import { requireIdempotencyKey } from '../../lib/errors.js'
import { chooseConnectionsHint, submitConnectionsGuess } from './service.js'

export const registerConnectionsRoutes = (
  app: FastifyInstance,
  dependencies: { db: Database; auth: Auth; config: AppConfig },
) => {
  const { db, auth, config } = dependencies
  const params = Type.Object({ sessionId: UuidSchema }, { additionalProperties: false })
  const headers = Type.Object({ 'idempotency-key': UuidSchema }, { additionalProperties: true })

  app.post('/api/v1/connections/sessions/:sessionId/guesses', {
    schema: { params, headers, body: ConnectionsGuessBodySchema },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    const body = request.body as ConnectionsGuessBody
    return submitConnectionsGuess(
      db,
      user!.id,
      user!.role,
      (request.params as { sessionId: string }).sessionId,
      body.tileIds,
      requireIdempotencyKey(request),
      config,
    )
  })

  app.post('/api/v1/connections/sessions/:sessionId/hints', {
    schema: { params, headers, body: ConnectionsHintBodySchema },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    return chooseConnectionsHint(
      db,
      user!.id,
      (request.params as { sessionId: string }).sessionId,
      (request.body as ConnectionsHintBody).checkpoint,
      requireIdempotencyKey(request),
      config,
    )
  })
}
