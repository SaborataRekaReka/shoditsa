import { createHash } from 'node:crypto'
import { getOAuthState } from 'better-auth/api'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { authEvents, user, type Database } from '@shoditsa/database'

export const AUTH_ACQUISITION_HEADER = 'x-shoditsa-acquisition'
const OAUTH_ACQUISITION_KEY = 'shoditsaAcquisition'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AuthAcquisition = {
  acquisitionId: string
  entrySource: 'organic_search' | 'direct' | 'referral'
  searchEngine: string | null
  entryPath: string
  referrerHost: string | null
}

const canonicalEntryPath = (value: unknown) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 160 || !/^\/[a-zA-Z0-9_~%./:@-]*$/.test(value)) return null
  if (/^\/sessions\/[^/]+/.test(value)) return '/sessions/:id'
  if (/^\/danetki\/join\/[^/]+/.test(value)) return '/danetki/join'
  if (/^\/specials\/[^/]+/.test(value)) return '/specials/:pack'
  if (/^\/auth(?:\/|$)/.test(value)) return '/auth'
  return value
}

export const parseAuthAcquisition = (value: string | string[] | null | undefined): AuthAcquisition | null => {
  if (typeof value !== 'string' || value.length > 1_200) return null
  try {
    const raw = JSON.parse(value) as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return null
    const acquisitionId = typeof raw.acquisition_id === 'string' && UUID_PATTERN.test(raw.acquisition_id) ? raw.acquisition_id : null
    const entrySource = raw.entry_source === 'organic_search' || raw.entry_source === 'direct' || raw.entry_source === 'referral' ? raw.entry_source : null
    const entryPath = canonicalEntryPath(raw.entry_path)
    if (!acquisitionId || !entrySource || !entryPath) return null
    const searchEngine = typeof raw.entry_search_engine === 'string' && /^[a-z0-9-]{1,32}$/i.test(raw.entry_search_engine) ? raw.entry_search_engine.toLowerCase() : null
    const referrerHost = typeof raw.entry_referrer_host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(raw.entry_referrer_host) ? raw.entry_referrer_host.toLowerCase() : null
    return { acquisitionId, entrySource, searchEngine, entryPath, referrerHost }
  } catch { return null }
}

/** Better Auth binds additionalData to the verified, expiring OAuth state, not the provider URL. */
export const withOAuthAcquisition = (body: Record<string, unknown>, header: string | string[] | undefined) => {
  const acquisition = parseAuthAcquisition(header)
  const additional = body.additionalData && typeof body.additionalData === 'object' && !Array.isArray(body.additionalData)
    ? body.additionalData : {}
  return {
    ...body,
    additionalData: {
      ...additional,
      // Always overwrite client-supplied state: without the consented header it remains unknown.
      [OAUTH_ACQUISITION_KEY]: acquisition ? JSON.stringify({
        acquisition_id: acquisition.acquisitionId, entry_source: acquisition.entrySource,
        entry_path: acquisition.entryPath, entry_search_engine: acquisition.searchEngine,
        entry_referrer_host: acquisition.referrerHost,
      }) : null,
    },
  }
}

type HookContext = {
  path?: string
  getHeader: (name: string) => string | null
  context: { logger: { error: (message: string) => void } }
}

export const authAnalyticsEventId = (action: 'sign_up' | 'sign_in', identity: string) => {
  const bytes = createHash('sha256').update(`shoditsa:auth:${action}:${identity}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const createAuthAnalytics = (db: Database) => {
  const createdInRequest = new WeakMap<object, Set<string>>()
  const acquisitionInRequest = new WeakMap<object, AuthAcquisition | null>()
  const acquisitionFor = async (context: HookContext | null | undefined) => {
    if (!context) return null
    if (acquisitionInRequest.has(context.context)) return acquisitionInRequest.get(context.context) ?? null
    if (context.path?.startsWith('/oauth2/callback/') || context.path?.startsWith('/callback/')) {
      const state = await getOAuthState()
      return parseAuthAcquisition(state?.[OAUTH_ACQUISITION_KEY])
    }
    return parseAuthAcquisition(context.getHeader(AUTH_ACQUISITION_HEADER))
  }
  const safely = async (action: string, context: HookContext | null | undefined, run: () => Promise<void>) => {
    try { await run() } catch {
      // The account/session already exists. Analytics must never turn a successful login into an error.
      // Do not log the error object: database errors can contain account data or OAuth state.
      context?.context.logger.error(`AUTH_ANALYTICS_WRITE_FAILED action=${action}`)
    }
  }
  return {
    beforeCreate: async (_created: unknown, context?: HookContext | null) => {
      if (!context) return
      // after hooks can run after the transaction outside Better Auth's request-state scope.
      // Capture verified OAuth state while the before hook is still inside that scope.
      await safely('acquisition_capture', context, async () => {
        acquisitionInRequest.set(context.context, await acquisitionFor(context))
      })
      // A missing state is unknown attribution, not a reason to lose the successful auth event.
      if (!acquisitionInRequest.has(context.context)) acquisitionInRequest.set(context.context, null)
    },
    userCreated: async (created: { id: string; isAnonymous?: boolean; createdAt: Date }, context?: HookContext | null) => {
      if (created.isAnonymous) return
      if (context) {
        const ids = createdInRequest.get(context.context) ?? new Set<string>()
        ids.add(created.id)
        createdInRequest.set(context.context, ids)
      }
      await safely('sign_up', context, async () => {
        await db.insert(authEvents).values({
          id: authAnalyticsEventId('sign_up', created.id), userId: created.id,
          eventName: 'sign_up', result: 'success', occurredAt: created.createdAt,
          requestId: context?.getHeader('x-request-id'),
          ...await acquisitionFor(context),
        }).onConflictDoNothing()
      })
    },
    sessionCreated: async (created: { id: string; userId: string; createdAt: Date }, context?: HookContext | null) => {
      await safely('session', context, async () => {
        const [owner] = await db.select({ isAnonymous: user.isAnonymous }).from(user).where(eq(user.id, created.userId)).limit(1)
        if (!owner || owner.isAnonymous) return
        const newAccount = context && createdInRequest.get(context.context)?.has(created.userId)
        const firstVerification = context?.path === '/verify-email'
        if (newAccount || firstVerification) {
          const bound = await db.update(authEvents).set({ authSessionId: created.id })
            .where(and(eq(authEvents.id, authAnalyticsEventId('sign_up', created.userId)), isNull(authEvents.authSessionId)))
            .returning({ id: authEvents.id })
          if (bound.length || newAccount) return
        }
        await db.insert(authEvents).values({
          id: authAnalyticsEventId('sign_in', created.id), userId: created.userId, authSessionId: created.id,
          eventName: 'sign_in', result: 'success', occurredAt: created.createdAt,
          requestId: context?.getHeader('x-request-id'),
          ...await acquisitionFor(context),
        }).onConflictDoNothing()
      })
    },
  }
}

export const loadAuthAnalyticsOutcome = async (db: Database, userId: string, authSessionId: string | null) => {
  if (!authSessionId) return null
  const [event] = await db.select({ eventId: authEvents.id, action: authEvents.eventName })
    .from(authEvents).where(and(
      eq(authEvents.userId, userId), eq(authEvents.authSessionId, authSessionId),
      eq(authEvents.result, 'success'), inArray(authEvents.eventName, ['sign_up', 'sign_in']),
    )).orderBy(desc(authEvents.occurredAt)).limit(1)
  return event && (event.action === 'sign_up' || event.action === 'sign_in')
    ? { eventId: event.eventId, action: event.action } : null
}
