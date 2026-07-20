import { Type } from '@sinclair/typebox'
import { PackSessionBodySchema, type PackSessionBody } from '@shoditsa/contracts'
import type { AppConfig } from '@shoditsa/config'
import type { Database } from '@shoditsa/database'
import type { FastifyInstance } from 'fastify'
import type { Auth } from '../auth/auth.js'
import { getRequestUser } from '../auth/session.js'
import { getPack, getPackProgress, listPacks, startPackSession } from './service.js'

const packParams = Type.Object({ packId: Type.String({ minLength: 1, maxLength: 120 }) }, { additionalProperties: false })

export const registerPackRoutes = (app: FastifyInstance, db: Database, auth: Auth, config: AppConfig) => {
  app.get('/api/v1/packs', async (request) => {
    const user = await getRequestUser(request, auth, db, false, config)
    return { items: await listPacks(db, user?.id ?? null, user?.role ?? 'player') }
  })
  app.get('/api/v1/packs/:packId', { schema: { params: packParams } }, async (request) => {
    const user = await getRequestUser(request, auth, db, false, config)
    const { packId } = request.params as { packId: string }
    return { pack: await getPack(db, packId, user?.id ?? null, user?.role ?? 'player') }
  })
  app.get('/api/v1/packs/:packId/progress', { schema: { params: packParams } }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    return getPackProgress(db, user!.id, (request.params as { packId: string }).packId)
  })
  app.post('/api/v1/packs/:packId/sessions', {
    schema: { params: packParams, body: PackSessionBodySchema },
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = await getRequestUser(request, auth, db, true, config)
    const { packId } = request.params as { packId: string }
    const { position } = request.body as PackSessionBody
    return { session: await startPackSession(db, user!.id, packId, position, user!.authSessionId, user!.role) }
  })
}
