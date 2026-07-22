import { extname, relative, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { AppConfig } from '@shoditsa/config'
import {
  FriendsRoomAnswerBodySchema,
  FriendsRoomConfigBodySchema,
  FriendsRoomCreateBodySchema,
  FriendsRoomJoinBodySchema,
  FriendsRoomMessageBodySchema,
  FriendsRoomMutationBodySchema,
  UuidSchema,
  type FriendsRoomAnswerBody,
  type FriendsRoomConfigBody,
  type FriendsRoomCreateBody,
  type FriendsRoomJoinBody,
  type FriendsRoomMessageBody,
} from '@shoditsa/contracts'
import type { Database } from '@shoditsa/database'
import type { Auth } from '../auth/auth.js'
import { getRequestUser } from '../auth/session.js'
import {
  assertFriendsRoomAccess,
  configureFriendsRoom,
  createFriendsRoom,
  getFriendsRoom,
  getFriendsRoomAnswerMediaSource,
  joinFriendsRoom,
  leaveFriendsRoom,
  nextFriendsRoomRound,
  previewFriendsRoom,
  revealFriendsRoomResults,
  restartFriendsRoom,
  sendFriendsRoomMessage,
  startFriendsRoom,
  submitFriendsRoomAnswer,
} from './service.js'

type Deps = { db: Database; auth: Auth; config: AppConfig }
const roomParams = Type.Object({ roomId: UuidSchema }, { additionalProperties: false })
const codeParams = Type.Object({ code: Type.String({ minLength: 5, maxLength: 5, pattern: '^[A-Za-z2-9]+$' }) }, { additionalProperties: false })

const imageMime = (path: string) => ({
  '.avif': 'image/avif', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
}[extname(path).toLocaleLowerCase('en-US')] ?? 'application/octet-stream')

const resolveInside = (root: string, tail: string) => {
  const absoluteRoot = resolve(root)
  const target = resolve(absoluteRoot, tail)
  const relation = relative(absoluteRoot, target)
  if (relation.startsWith('..') || relation.includes(':')) throw new Error('Media path escapes configured root')
  return target
}

const localAnswerMediaPath = (source: string, config: AppConfig) => {
  const normalized = source.replaceAll('\\', '/')
  if (normalized.startsWith('./data/libraries/')) return resolveInside(config.contentReleaseRoot, normalized.slice('./data/libraries/'.length))
  if (normalized.startsWith('data/libraries/')) return resolveInside(config.contentReleaseRoot, normalized.slice('data/libraries/'.length))
  if (normalized.startsWith('/media/')) return resolveInside(config.mediaRoot, normalized.slice('/media/'.length))
  return null
}

const writeSse = (raw: NodeJS.WritableStream, event: string, data: unknown, id?: number) => {
  if (id != null) raw.write(`id: ${id}\n`)
  raw.write(`event: ${event}\n`)
  raw.write(`data: ${JSON.stringify(data)}\n\n`)
}

const authorizedUser = async (request: Parameters<typeof getRequestUser>[0], deps: Deps) => {
  const user = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
  assertFriendsRoomAccess(deps.config, user!.isAnonymous)
  return user!
}

export const registerFriendsRoomRoutes = (app: FastifyInstance, deps: Deps) => {
  app.post('/api/v1/friends/rooms', {
    schema: { body: FriendsRoomCreateBodySchema },
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const user = await authorizedUser(request, deps)
    const room = await createFriendsRoom(deps.db, user, request.body as FriendsRoomCreateBody)
    return reply.code(201).send({ room })
  })

  app.get('/api/v1/friends/rooms/code/:code', { schema: { params: codeParams } }, async (request) => {
    await authorizedUser(request, deps)
    return previewFriendsRoom(deps.db, (request.params as { code: string }).code)
  })

  app.post('/api/v1/friends/rooms/code/:code/join', { schema: { params: codeParams, body: FriendsRoomJoinBodySchema } }, async (request) => {
    const user = await authorizedUser(request, deps)
    const body = request.body as FriendsRoomJoinBody
    return { room: await joinFriendsRoom(deps.db, user, (request.params as { code: string }).code, body.displayName) }
  })

  app.get('/api/v1/friends/rooms/:roomId/snapshot', { schema: { params: roomParams } }, async (request) => {
    const user = await authorizedUser(request, deps)
    return { room: await getFriendsRoom(deps.db, (request.params as { roomId: string }).roomId, user.id) }
  })

  app.get('/api/v1/friends/rooms/:roomId/answer-image', { schema: { params: roomParams } }, async (request, reply) => {
    const user = await authorizedUser(request, deps)
    const roomId = (request.params as { roomId: string }).roomId
    const source = await getFriendsRoomAnswerMediaSource(deps.db, roomId, user.id)
    if (/^https?:\/\//i.test(source)) return reply.redirect(source)
    const path = localAnswerMediaPath(source, deps.config)
    if (!path) return reply.code(404).send({ error: { code: 'FRIENDS_ROOM_ANSWER_IMAGE_NOT_FOUND', message: 'Изображение ответа недоступно' } })
    try {
      const bytes = await readFile(path)
      return reply.header('Cache-Control', 'private, max-age=3600').type(imageMime(path)).send(bytes)
    } catch {
      return reply.code(404).send({ error: { code: 'FRIENDS_ROOM_ANSWER_IMAGE_NOT_FOUND', message: 'Изображение ответа недоступно' } })
    }
  })

  app.get('/api/v1/friends/rooms/:roomId/events', { schema: { params: roomParams } }, async (request, reply) => {
    const user = await authorizedUser(request, deps)
    const roomId = (request.params as { roomId: string }).roomId
    const initial = await getFriendsRoom(deps.db, roomId, user.id)
    let lastVersion = Number(request.headers['last-event-id'] ?? 0)
    if (!Number.isFinite(lastVersion)) lastVersion = 0
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    writeSse(reply.raw, 'room.snapshot', initial, initial.version)
    lastVersion = initial.version
    let polling = false
    const poll = setInterval(async () => {
      if (polling || reply.raw.destroyed) return
      polling = true
      try {
        const snapshot = await getFriendsRoom(deps.db, roomId, user.id)
        if (snapshot.version !== lastVersion) {
          lastVersion = snapshot.version
          writeSse(reply.raw, 'room.snapshot', snapshot, snapshot.version)
        }
      } catch (error) {
        writeSse(reply.raw, 'room.error', { message: error instanceof Error ? error.message : 'Ошибка синхронизации комнаты' })
      } finally { polling = false }
    }, 1_000)
    const heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n') }, 20_000)
    try {
      await new Promise<void>((resolve) => request.raw.once('close', resolve))
    } finally {
      clearInterval(poll)
      clearInterval(heartbeat)
    }
  })

  app.patch('/api/v1/friends/rooms/:roomId', { schema: { params: roomParams, body: FriendsRoomConfigBodySchema } }, async (request) => {
    const user = await authorizedUser(request, deps)
    return { room: await configureFriendsRoom(deps.db, user.id, (request.params as { roomId: string }).roomId, request.body as FriendsRoomConfigBody) }
  })

  app.post('/api/v1/friends/rooms/:roomId/start', { schema: { params: roomParams, body: FriendsRoomMutationBodySchema } }, async (request) => {
    const user = await authorizedUser(request, deps)
    return { room: await startFriendsRoom(deps.db, user.id, (request.params as { roomId: string }).roomId) }
  })

  app.post('/api/v1/friends/rooms/:roomId/answers', { schema: { params: roomParams, body: FriendsRoomAnswerBodySchema } }, async (request) => {
    const user = await authorizedUser(request, deps)
    const body = request.body as FriendsRoomAnswerBody
    return { room: await submitFriendsRoomAnswer(deps.db, user.id, (request.params as { roomId: string }).roomId, body.text, body.idempotencyKey, body.itemId) }
  })

  app.post('/api/v1/friends/rooms/:roomId/reveal', { schema: { params: roomParams, body: FriendsRoomMutationBodySchema } }, async (request) => {
    const user = await authorizedUser(request, deps)
    return { room: await revealFriendsRoomResults(deps.db, user.id, (request.params as { roomId: string }).roomId) }
  })

  app.post('/api/v1/friends/rooms/:roomId/next', { schema: { params: roomParams, body: FriendsRoomMutationBodySchema } }, async (request) => {
    const user = await authorizedUser(request, deps)
    return { room: await nextFriendsRoomRound(deps.db, user.id, (request.params as { roomId: string }).roomId) }
  })

  app.post('/api/v1/friends/rooms/:roomId/restart', { schema: { params: roomParams, body: FriendsRoomMutationBodySchema } }, async (request) => {
    const user = await authorizedUser(request, deps)
    return { room: await restartFriendsRoom(deps.db, user.id, (request.params as { roomId: string }).roomId) }
  })

  app.post('/api/v1/friends/rooms/:roomId/messages', {
    schema: { params: roomParams, body: FriendsRoomMessageBodySchema },
    config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = await authorizedUser(request, deps)
    const body = request.body as FriendsRoomMessageBody
    return { room: await sendFriendsRoomMessage(deps.db, user.id, (request.params as { roomId: string }).roomId, body.text, body.idempotencyKey) }
  })

  app.post('/api/v1/friends/rooms/:roomId/leave', { schema: { params: roomParams, body: FriendsRoomMutationBodySchema } }, async (request) => {
    const user = await authorizedUser(request, deps)
    return leaveFriendsRoom(deps.db, user.id, (request.params as { roomId: string }).roomId)
  })
}
