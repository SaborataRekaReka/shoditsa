import { eq } from 'drizzle-orm'
import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyRequest } from 'fastify'
import type { AppConfig } from '@shoditsa/config'
import { playerProfiles, type Database } from '@shoditsa/database'
import type { Auth } from './auth.js'
import { ApiError } from '../../lib/errors.js'

const normalizeEmail = (value: string) => value.trim().toLocaleLowerCase('en-US')

export const getRequestUser = async (
  request: FastifyRequest,
  auth: Auth,
  db: Database,
  required = true,
  _config?: AppConfig,
  allowBlocked = false,
) => {
  const authSession = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
  if (!authSession) {
    if (!required) return null
    throw new ApiError(401, 'AUTH_REQUIRED', 'Требуется пользовательская сессия')
  }
  await db.insert(playerProfiles).values({ userId: authSession.user.id }).onConflictDoNothing()
  const profile = await db.select({
    role: playerProfiles.role,
    accountStatus: playerProfiles.accountStatus,
    blockedUntil: playerProfiles.blockedUntil,
  }).from(playerProfiles).where(eq(playerProfiles.userId, authSession.user.id)).limit(1)
  const blocked = profile[0]?.accountStatus === 'blocked' && (!profile[0].blockedUntil || profile[0].blockedUntil > new Date())
  if (blocked && !allowBlocked) throw new ApiError(403, 'ACCOUNT_BLOCKED', 'Аккаунт заблокирован')
  if (profile[0]?.accountStatus === 'blocked' && profile[0].blockedUntil && profile[0].blockedUntil <= new Date()) {
    await db.update(playerProfiles).set({
      accountStatus: 'active', blockedAt: null, blockedUntil: null, blockedReason: null, blockedBy: null, updatedAt: new Date(),
    }).where(eq(playerProfiles.userId, authSession.user.id))
  }
  return {
    id: authSession.user.id,
    email: normalizeEmail(authSession.user.email),
    name: authSession.user.name,
    isAnonymous: Boolean((authSession.user as { isAnonymous?: boolean }).isAnonymous),
    role: (profile[0]?.role === 'admin' ? 'admin' : 'player') as 'admin' | 'player',
    authSessionId: (authSession.session as { id?: string }).id ?? null,
    accountStatus: blocked ? 'blocked' as const : 'active' as const,
  }
}

export const requireAdmin = async (request: FastifyRequest, auth: Auth, db: Database, config: AppConfig) => {
  const user = await getRequestUser(request, auth, db, true, config, true)
  const idAllowed = config.adminUserIds.length === 1 && config.adminUserIds[0] === user!.id.toLocaleLowerCase('en-US')
  const emailAllowed = config.adminEmails.length === 1
    && config.adminEmails[0] === 'breneize@yandex.ru'
    && user!.email === 'breneize@yandex.ru'
  if (user!.role !== 'admin' || !idAllowed || !emailAllowed) throw new ApiError(403, 'ADMIN_REQUIRED', 'Недостаточно прав')
  return user!
}
