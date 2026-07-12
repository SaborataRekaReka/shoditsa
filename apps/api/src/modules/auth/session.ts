import { eq } from 'drizzle-orm'
import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyRequest } from 'fastify'
import type { AppConfig } from '@shoditsa/config'
import { playerProfiles, type Database } from '@shoditsa/database'
import type { Auth } from './auth.js'
import { ApiError } from '../../lib/errors.js'

export const getRequestUser = async (request: FastifyRequest, auth: Auth, db: Database, required = true, config?: AppConfig) => {
  const authSession = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
  if (!authSession) {
    if (!required) return null
    throw new ApiError(401, 'AUTH_REQUIRED', 'Требуется пользовательская сессия')
  }
  await db.insert(playerProfiles).values({ userId: authSession.user.id }).onConflictDoNothing()
  if (config?.adminEmails.includes(authSession.user.email.toLocaleLowerCase('en-US'))) {
    await db.update(playerProfiles).set({ role: 'admin', updatedAt: new Date() }).where(eq(playerProfiles.userId, authSession.user.id))
  }
  const profile = await db.select({ role: playerProfiles.role }).from(playerProfiles).where(eq(playerProfiles.userId, authSession.user.id)).limit(1)
  return {
    id: authSession.user.id,
    email: authSession.user.email,
    name: authSession.user.name,
    isAnonymous: Boolean((authSession.user as { isAnonymous?: boolean }).isAnonymous),
    role: (profile[0]?.role === 'admin' ? 'admin' : 'player') as 'admin' | 'player',
  }
}

export const requireAdmin = async (request: FastifyRequest, auth: Auth, db: Database, config: AppConfig) => {
  const user = await getRequestUser(request, auth, db, true, config)
  if (user!.role !== 'admin') throw new ApiError(403, 'ADMIN_REQUIRED', 'Недостаточно прав')
  return user!
}
