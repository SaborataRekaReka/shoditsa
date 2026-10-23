import type { FastifyInstance } from 'fastify'
import { fromNodeHeaders } from 'better-auth/node'
import type { Database } from '@shoditsa/database'
import { LeaderboardQuerySchema, type LeaderboardQuery } from '@shoditsa/contracts'
import type { Auth } from '../auth/auth.js'
import { getLeaderboard } from './service.js'

export function registerLeaderboardRoutes(app: FastifyInstance, db: Database, auth: Auth) {
  app.get<{ Querystring: LeaderboardQuery }>('/api/v1/leaderboard', {
    schema: { querystring: LeaderboardQuerySchema },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    const viewerId = session && !(session.user as { isAnonymous?: boolean }).isAnonymous ? session.user.id : null
    return getLeaderboard(db, request.query, viewerId)
  })
}
