import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { AppConfig } from '@shoditsa/config'
import {
  DanetkiGuessBodySchema,
  DanetkiJoinBodySchema,
  DanetkiMessageBodySchema,
  DanetkiMutationBodySchema,
  UuidSchema,
} from '@shoditsa/contracts'
import type { Database } from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getRequestUser } from '../auth/session.js'
import type { Auth } from '../auth/auth.js'
import {
  createDanetkiInvite,
  createDanetkiMessage,
  getDanetkiSession,
  joinDanetkiInvite,
  leaveDanetkiSession,
  previewDanetkiInvite,
  revealDanetkiHint,
  retryDanetkiAi,
  submitDanetkiGuess,
  voteDanetkiSurrender,
} from './service.js'

export type DanetkiRealtimeMetrics = {
  activeConnections: number
  reconnects: number
}

type Deps = { db: Database; auth: Auth; config: AppConfig; realtimeMetrics?: DanetkiRealtimeMetrics }
const sessionParams = Type.Object({ sessionId: UuidSchema }, { additionalProperties: false })
const inviteParams = Type.Object({ token: Type.String({ minLength: 32, maxLength: 128 }) }, { additionalProperties: false })
const snapshotQuery = Type.Object({ afterSeq: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false })

const mutationKey = (request: FastifyRequest, body: { idempotencyKey?: string }) => {
  const value = body.idempotencyKey ?? request.headers['idempotency-key']
  if (typeof value !== 'string' || value.trim().length < 8 || value.length > 120) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Передайте idempotencyKey длиной не менее 8 символов')
  }
  return value.trim()
}

const writeSse = (raw: NodeJS.WritableStream, event: string, data: unknown, id?: number) => {
  if (id != null) raw.write(`id: ${id}\n`)
  raw.write(`event: ${event}\n`)
  raw.write(`data: ${JSON.stringify(data)}\n\n`)
}

export const registerDanetkiRoutes = (app: FastifyInstance, deps: Deps) => {
  app.post('/api/v1/danetki/sessions/:sessionId/messages', {
    schema: { params: sessionParams, body: DanetkiMessageBodySchema },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    const body = request.body as { text: string; idempotencyKey?: string }
    const result = await createDanetkiMessage(deps.db, user!.id, (request.params as { sessionId: string }).sessionId, {
      text: body.text,
      idempotencyKey: mutationKey(request, body),
    })
    return reply.code(202).send(result)
  })

  app.get('/api/v1/danetki/sessions/:sessionId/snapshot', { schema: { params: sessionParams, querystring: snapshotQuery } }, async (request) => {
    const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    const snapshot = await getDanetkiSession(deps.db, user!.id, (request.params as { sessionId: string }).sessionId)
    const afterSeq = Number((request.query as { afterSeq?: number }).afterSeq ?? 0)
    return {
      session: afterSeq > 0 && snapshot.danetki
        ? { ...snapshot, danetki: { ...snapshot.danetki, messages: snapshot.danetki.messages.filter((message) => message.seq > afterSeq) } }
        : snapshot,
    }
  })

  app.get('/api/v1/danetki/sessions/:sessionId/events', { schema: { params: sessionParams } }, async (request, reply) => {
    const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    const sessionId = (request.params as { sessionId: string }).sessionId
    const initial = await getDanetkiSession(deps.db, user!.id, sessionId)
    const headerId = Number(request.headers['last-event-id'] ?? 0)
    let lastSeq = Number.isFinite(headerId) ? Math.max(0, headerId) : 0
    let lastOutcome = initial.status
    let lastAiStatus = initial.danetki?.aiStatus
    let lastActiveMembers = initial.danetki?.members.filter((member) => !member.leftAt).length ?? 0
    let lastPresence = new Map(initial.danetki?.members.map((member) => [member.userId, member.lastSeenAt]) ?? [])
    if (headerId > 0 && deps.realtimeMetrics) deps.realtimeMetrics.reconnects += 1
    if (deps.realtimeMetrics) deps.realtimeMetrics.activeConnections += 1
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    writeSse(reply.raw, 'session.snapshot', initial)
    for (const message of initial.danetki?.messages ?? []) {
      if (message.seq <= lastSeq) continue
      writeSse(reply.raw, 'message.created', message, message.seq)
      lastSeq = message.seq
    }
    let polling = false
    const poll = setInterval(async () => {
      if (polling || reply.raw.destroyed) return
      polling = true
      try {
        const snapshot = await getDanetkiSession(deps.db, user!.id, sessionId)
        for (const message of snapshot.danetki?.messages ?? []) {
          if (message.seq <= lastSeq) continue
          writeSse(reply.raw, 'message.created', message, message.seq)
          lastSeq = message.seq
        }
        if (snapshot.status !== lastOutcome) {
          lastOutcome = snapshot.status
          writeSse(reply.raw, 'session.finished', snapshot)
          writeSse(reply.raw, 'invite.revoked', { sessionId })
        }
        if (snapshot.danetki?.aiStatus !== lastAiStatus) {
          lastAiStatus = snapshot.danetki?.aiStatus
          writeSse(reply.raw, 'ai.status', { aiStatus: snapshot.danetki?.aiStatus })
        }
        const activeMembers = snapshot.danetki?.members.filter((member) => !member.leftAt).length ?? 0
        if (activeMembers !== lastActiveMembers) {
          writeSse(reply.raw, activeMembers > lastActiveMembers ? 'member.joined' : 'member.left', { activeMembers })
          lastActiveMembers = activeMembers
        }
        const presence = new Map(snapshot.danetki?.members.map((member) => [member.userId, member.lastSeenAt]) ?? [])
        const changedPresence = [...presence].filter(([memberId, lastSeenAt]) => lastPresence.get(memberId) !== lastSeenAt)
        if (changedPresence.length) writeSse(reply.raw, 'presence.updated', { members: changedPresence.map(([userId, lastSeenAt]) => ({ userId, lastSeenAt })) })
        lastPresence = presence
      } catch (error) {
        writeSse(reply.raw, 'message.failed', { message: error instanceof Error ? error.message : 'Ошибка синхронизации' })
      } finally { polling = false }
    }, 1_000)
    const heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n') }, 20_000)
    try {
      await new Promise<void>((resolve) => request.raw.once('close', resolve))
    } finally {
      clearInterval(poll); clearInterval(heartbeat)
      if (deps.realtimeMetrics) deps.realtimeMetrics.activeConnections = Math.max(0, deps.realtimeMetrics.activeConnections - 1)
    }
  })

  app.post('/api/v1/danetki/sessions/:sessionId/invites', { schema: { params: sessionParams, body: DanetkiMutationBodySchema } }, async (request) => {
    const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    const body = request.body as { idempotencyKey?: string }
    return createDanetkiInvite(deps.db, user!.id, (request.params as { sessionId: string }).sessionId, mutationKey(request, body), deps.config)
  })

  app.get('/api/v1/danetki/invites/:token', { schema: { params: inviteParams } }, async (request) => (
    previewDanetkiInvite(deps.db, (request.params as { token: string }).token)
  ))

  app.post('/api/v1/danetki/invites/:token/join', { schema: { params: inviteParams, body: DanetkiJoinBodySchema } }, async (request) => {
    const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    const body = request.body as { displayName: string }
    return { session: await joinDanetkiInvite(deps.db, user!, (request.params as { token: string }).token, body.displayName) }
  })

  app.post('/api/v1/danetki/sessions/:sessionId/hints', { schema: { params: sessionParams, body: DanetkiMutationBodySchema } }, async (request) => {
    const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    const body = request.body as { idempotencyKey?: string }
    return revealDanetkiHint(deps.db, user!.id, (request.params as { sessionId: string }).sessionId, mutationKey(request, body))
  })

  app.post('/api/v1/danetki/sessions/:sessionId/retry-ai', { schema: { params: sessionParams, body: DanetkiMutationBodySchema } }, async (request) => {
    const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    const body = request.body as { idempotencyKey?: string }
    return retryDanetkiAi(deps.db, user!.id, (request.params as { sessionId: string }).sessionId, mutationKey(request, body))
  })

  app.post('/api/v1/danetki/sessions/:sessionId/guesses', { schema: { params: sessionParams, body: DanetkiGuessBodySchema } }, async (request, reply) => {
    const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    const body = request.body as { text: string; idempotencyKey?: string }
    const result = await submitDanetkiGuess(deps.db, user!.id, (request.params as { sessionId: string }).sessionId, { text: body.text, idempotencyKey: mutationKey(request, body) })
    return reply.code(202).send(result)
  })

  app.post('/api/v1/danetki/sessions/:sessionId/surrender-votes', { schema: { params: sessionParams, body: DanetkiMutationBodySchema } }, async (request) => {
    const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    return voteDanetkiSurrender(deps.db, user!.id, (request.params as { sessionId: string }).sessionId)
  })

  app.post('/api/v1/danetki/sessions/:sessionId/leave', { schema: { params: sessionParams, body: DanetkiMutationBodySchema } }, async (request) => {
    const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    return leaveDanetkiSession(deps.db, user!.id, (request.params as { sessionId: string }).sessionId)
  })
}
