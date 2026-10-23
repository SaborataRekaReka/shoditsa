import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { AppConfig } from '@shoditsa/config'
import type { Database } from '@shoditsa/database'
import { RoomService, RoomError } from '@shoditsa/game-core/svoyak'
import { SVOYAK_AVATARS, type AvatarId, type Command, type RoomSettings, type RoomView } from '@shoditsa/contracts/svoyak'
import type { Auth } from '../auth/auth.js'
import { getRequestUser } from '../auth/session.js'
import { getMembershipSummary } from '../commerce/entitlements.js'
import { ApiError } from '../../lib/errors.js'
import { PostgresQuestionBank } from './bank.js'
import { PostgresRoomRepository } from './repository.js'

type Deps = { db: Database; auth: Auth; config: AppConfig }
const params = Type.Object({ code: Type.String({ pattern: '^[A-F0-9]{6}$' }) }, { additionalProperties: false })
const identity = { name: Type.String({ minLength: 1, maxLength: 24 }), avatar: Type.Union(SVOYAK_AVATARS.map(value => Type.Literal(value.id))) }
const preferences = Type.Object({ topics: Type.Array(Type.String({ pattern: '^[a-z-]{1,40}$' }), { maxItems: 20 }) }, { additionalProperties: false })
const settings = Type.Object({ rounds: Type.Integer({ minimum: 1, maximum: 3 }), themesPerRound: Type.Integer({ minimum: 1, maximum: 6 }), secondsPerQuestion: Type.Union([15,30,45,60].map(value => Type.Literal(value))), age: Type.Union([Type.Literal(16),Type.Literal(18)]) }, { additionalProperties: false })
const command = Type.Object({
  type: Type.Union(['prepare','start','reveal','next','finish','leave','rematch','buzz','profile','preferences','settings','ready','choose','judge','kick'].map(value => Type.Literal(value))),
  name: Type.Optional(identity.name), avatar: Type.Optional(identity.avatar), preferences: Type.Optional(preferences), settings: Type.Optional(settings),
  ready: Type.Optional(Type.Boolean()), questionId: Type.Optional(Type.String({minLength:1,maxLength:160})),
  correct: Type.Optional(Type.Union([Type.Boolean(),Type.Null()])), memberId: Type.Optional(Type.String({format:'uuid'})),
}, {additionalProperties:false})
const roomToken = (request: FastifyRequest) => request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]

export function registerSvoyakRoutes(app: FastifyInstance, deps: Deps) {
  const keyGenerator = async (request: FastifyRequest) => {
    const session = await deps.auth.api.getSession({headers:fromNodeHeaders(request.headers)})
    return 'svoyak:' + request.routeOptions.url + ':' + request.ip + ':' + (session?.user.id ?? 'guest')
  }
  const repository = new PostgresRoomRepository(deps.db)
  const service = new RoomService(repository, new PostgresQuestionBank(deps.db))
  app.addHook('onClose', async () => service.dispose())
  const guard = async (request: FastifyRequest) => {
    if (!deps.config.svoyakEnabled) throw new ApiError(404, 'SVOYAK_DISABLED', 'Своя игра пока недоступна')
    if (request.method === 'POST' && (!request.headers.origin || !deps.config.trustedOrigins.includes(request.headers.origin))) throw new ApiError(403, 'ORIGIN_REJECTED', 'Запрос разрешён только со страницы игры')
  }
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    for (let attempt=0; ; attempt++) {
      try { return await operation() }
      catch (error) {
        if (error instanceof RoomError) {
          if (error.code==='ROOM_CHANGED' && attempt<3) continue
          throw new ApiError(error.status,error.code,error.message)
        }
        throw error
      }
    }
  }
  const project = async (room: RoomView) => {
    const connected = await repository.presence(room.code, room.me?.id)
    return { ...room, members: room.members.map(member => ({ ...member, connected: connected.get(member.id) ?? false })) }
  }
  app.get('/api/v1/svoyak/catalog', { preHandler: guard, config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator } } }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return run(() => service.catalog())
  })
  app.post('/api/v1/svoyak/rooms', { preHandler: guard, schema: { body: Type.Object({ ...identity, settings }, { additionalProperties: false }) }, config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator } } }, async (request, reply) => {
    const user = (await getRequestUser(request, deps.auth, deps.db, true, deps.config))!
    if (user.isAnonymous || !(await getMembershipSummary(deps.db,user.id)).active) throw new ApiError(403, 'CLUB_REQUIRED', 'Создание комнаты доступно с клубным билетом')
    await run(() => service.catalog())
    const result = await run(() => service.create(request.body as { name: string; avatar: AvatarId; settings: RoomSettings }, user.id, request.headers['x-shoditsa-qa']==='svoyak' && user.role==='admin'))
    reply.header('Cache-Control', 'no-store').code(201)
    return { ...result, room: await project(result.room) }
  })
  app.post('/api/v1/svoyak/rooms/:code/join', { preHandler: guard, schema: { params, body: Type.Object(identity, { additionalProperties: false }) }, config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator } } }, async (request, reply) => {
    const user = (await getRequestUser(request, deps.auth, deps.db, true, deps.config))!
    const { code } = request.params as { code: string }
    const result = await run(() => service.join(code, request.body as { name: string; avatar: AvatarId }, user.id))
    reply.header('Cache-Control', 'no-store').code(201)
    return { ...result, room: await project(result.room) }
  })
  app.get('/api/v1/svoyak/rooms/:code', { preHandler: guard, schema: { params }, config: { rateLimit: { max: 600, timeWindow: '1 minute', keyGenerator } } }, async (request, reply) => {
    const token = roomToken(request)
    const user = await getRequestUser(request, deps.auth, deps.db, Boolean(token), deps.config)
    reply.header('Cache-Control', 'no-store')
    const { code } = request.params as { code: string }
    return project(await run(() => service.get(code, token, user?.id)))
  })
  app.post('/api/v1/svoyak/rooms/:code/commands', { preHandler: guard, schema: { params, body: Type.Object({ command, commandId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }) }, config: { rateLimit: { max: 180, timeWindow: '1 minute', keyGenerator } } }, async (request, reply) => {
    const user = (await getRequestUser(request, deps.auth, deps.db, true, deps.config))!
    const token = roomToken(request)
    if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Войди в комнату по приглашению')
    const { code } = request.params as { code: string }, { command, commandId } = request.body as { command: Command; commandId: string }
    reply.header('Cache-Control', 'no-store')
    return project(await run(() => service.command(code, token, command, commandId, user.id)))
  })
}
