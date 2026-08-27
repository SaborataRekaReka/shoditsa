import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { AppConfig } from '@shoditsa/config'
import {
  TerritoryAnswerBodySchema,
  TerritoryCaptureBodySchema,
  TerritoryRematchBodySchema,
  UuidSchema,
  type TerritoryAnswerBody,
  type TerritoryCaptureBody,
} from '@shoditsa/contracts'
import type { Database } from '@shoditsa/database'
import type { Auth } from '../auth/auth.js'
import { getRequestUser } from '../auth/session.js'
import { assertFriendsRoomAccess, getFriendsRoom } from '../friends-room/service.js'
import { submitTerritoryAnswer, submitTerritoryCapture, voteTerritoryRematch } from './service.js'

type Deps = { db: Database; auth: Auth; config: AppConfig }
const roomParams = Type.Object({ roomId: UuidSchema }, { additionalProperties: false })
const idempotencyHeaders = Type.Object({
  'idempotency-key': Type.String({ format: 'uuid' }),
}, { additionalProperties: true })

const authorizedUser = async (request: Parameters<typeof getRequestUser>[0], deps: Deps) => {
  const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
  assertFriendsRoomAccess(deps.config, user!.isAnonymous)
  return user!
}

const idempotencyKey = (headers: Record<string, unknown>) => String(headers['idempotency-key'] ?? '')

export const registerTerritoryRoutes = (app: FastifyInstance, deps: Deps) => {
  app.post('/api/v1/friends/rooms/:roomId/territory/answers', {
    schema: { params: roomParams, headers: idempotencyHeaders, body: TerritoryAnswerBodySchema },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = await authorizedUser(request, deps)
    const roomId = (request.params as { roomId: string }).roomId
    const body = request.body as TerritoryAnswerBody
    await submitTerritoryAnswer(deps.db, roomId, user.id, body.duelId, body.optionId, idempotencyKey(request.headers))
    return { room: await getFriendsRoom(deps.db, roomId, user.id) }
  })

  app.post('/api/v1/friends/rooms/:roomId/territory/captures', {
    schema: { params: roomParams, headers: idempotencyHeaders, body: TerritoryCaptureBodySchema },
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = await authorizedUser(request, deps)
    const roomId = (request.params as { roomId: string }).roomId
    const body = request.body as TerritoryCaptureBody
    await submitTerritoryCapture(deps.db, roomId, user.id, body.cellId, idempotencyKey(request.headers))
    return { room: await getFriendsRoom(deps.db, roomId, user.id) }
  })

  app.post('/api/v1/friends/rooms/:roomId/territory/rematch', {
    schema: { params: roomParams, headers: idempotencyHeaders, body: TerritoryRematchBodySchema },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = await authorizedUser(request, deps)
    const roomId = (request.params as { roomId: string }).roomId
    await voteTerritoryRematch(deps.db, roomId, user.id, idempotencyKey(request.headers))
    return { room: await getFriendsRoom(deps.db, roomId, user.id) }
  })
}
