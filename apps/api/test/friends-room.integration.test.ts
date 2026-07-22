import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import type { FriendsRoomSnapshot, TitleItem } from '@shoditsa/contracts'
import {
  contentItemVersions,
  createDatabase,
  friendsRoomRounds,
  friendsRooms,
  playerProfiles,
  user,
} from '@shoditsa/database'
import { buildApp } from '../src/app.js'

const responseCookie = (headers: Record<string, unknown>) => {
  const raw = headers['set-cookie']
  return (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map((value) => String(value).split(';')[0]).join('; ')
}

describe('friends room multiplayer API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let database: ReturnType<typeof createDatabase>
  let ownerCookie = ''
  let playerCookie = ''
  let roomId = ''
  let roomCode = ''
  let productionRoomId = ''
  let answerMediaPath = ''

  const createGuest = async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/guest' })
    expect(response.statusCode).toBe(200)
    return responseCookie(response.headers)
  }

  const snapshot = async (cookie: string) => {
    const response = await app.inject({ method: 'GET', url: `/api/v1/friends/rooms/${roomId}/snapshot`, headers: { cookie } })
    expect(response.statusCode).toBe(200)
    return response.json().room as FriendsRoomSnapshot
  }

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET ||= 'integration-secret-at-least-32-characters'
    process.env.BETTER_AUTH_URL ||= 'http://localhost:3001'
    process.env.TRUSTED_ORIGINS ||= 'http://localhost:5173'
    process.env.PROMO_CODE_PEPPER ||= 'integration-pepper-at-least-32-characters'
    process.env.AUTH_EMAIL_ENABLED = 'false'
    process.env.FRIENDS_ROOM_PREVIEW = 'false'
    const config = loadConfig()
    answerMediaPath = resolve(config.mediaRoot, 'friends-room-integration', 'answer.png')
    await mkdir(dirname(answerMediaPath), { recursive: true })
    await writeFile(answerMediaPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    database = createDatabase(config)
    app = await buildApp({ config, db: database.db })
    await app.ready()
    ownerCookie = await createGuest()
    playerCookie = await createGuest()
  })

  afterAll(async () => {
    if (roomId) await database.db.delete(friendsRooms).where(eq(friendsRooms.id, roomId))
    if (productionRoomId) await database.db.delete(friendsRooms).where(eq(friendsRooms.id, productionRoomId))
    await app?.close()
    await database?.client.end()
    if (answerMediaPath) await rm(answerMediaPath, { force: true })
  })

  it('keeps a two-player room synchronized without leaking the answer', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/rooms',
      headers: { cookie: ownerCookie },
      payload: { mode: 'movie', roundsTotal: 3, answerTimeSeconds: 15 },
    })
    expect(created.statusCode).toBe(201)
    const ownerRoom = created.json().room as FriendsRoomSnapshot
    roomId = ownerRoom.id
    roomCode = ownerRoom.code
    expect(ownerRoom.isHost).toBe(true)
    expect(ownerRoom.phase).toBe('lobby')

    const preview = await app.inject({ method: 'GET', url: `/api/v1/friends/rooms/code/${roomCode}`, headers: { cookie: playerCookie } })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({ code: roomCode, players: 1, capacity: 8, phase: 'lobby' })

    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/code/${roomCode}/join`,
      headers: { cookie: playerCookie },
      payload: { displayName: 'Второй игрок' },
    })
    expect(joined.statusCode).toBe(200)
    expect(joined.json().room.members).toHaveLength(2)
    expect(joined.json().room.isHost).toBe(false)

    const forbiddenConfig = await app.inject({
      method: 'PATCH',
      url: `/api/v1/friends/rooms/${roomId}`,
      headers: { cookie: playerCookie },
      payload: { roundsTotal: 6 },
    })
    expect(forbiddenConfig.statusCode).toBe(403)
    expect(forbiddenConfig.json().error.code).toBe('FRIENDS_ROOM_HOST_REQUIRED')

    const messageKey = crypto.randomUUID()
    const message = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/messages`,
      headers: { cookie: playerCookie },
      payload: { text: 'Всем привет!', idempotencyKey: messageKey },
    })
    expect(message.statusCode).toBe(200)
    const replayedMessage = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/messages`,
      headers: { cookie: playerCookie },
      payload: { text: 'Дубль не должен появиться', idempotencyKey: messageKey },
    })
    expect(replayedMessage.statusCode).toBe(200)
    expect((await snapshot(ownerCookie)).messages).toHaveLength(1)

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/start`,
      headers: { cookie: ownerCookie },
      payload: { idempotencyKey: crypto.randomUUID() },
    })
    expect(started.statusCode).toBe(200)
    expect(started.json().room.phase).toBe('countdown')
    expect(started.json().room.round.endsAt).toEqual(expect.any(String))

    const hostRejoin = await app.inject({ method: 'POST', url: `/api/v1/friends/rooms/code/${roomCode}/join`, headers: { cookie: ownerCookie }, payload: {} })
    expect(hostRejoin.statusCode).toBe(200)
    expect(hostRejoin.json().room.id).toBe(roomId)
    expect(started.json().room.round.answer).toBeNull()

    const now = new Date()
    await database.db.update(friendsRooms).set({
      phase: 'active', phaseStartedAt: now, phaseEndsAt: new Date(now.getTime() + 15_000), version: ownerRoom.version + 10,
    }).where(eq(friendsRooms.id, roomId))
    await database.db.update(friendsRoomRounds).set({ startedAt: now }).where(and(
      eq(friendsRoomRounds.roomId, roomId), eq(friendsRoomRounds.position, 1),
    ))

    const roundRow = (await database.db.select({ id: contentItemVersions.id, payload: contentItemVersions.payload })
      .from(friendsRoomRounds)
      .innerJoin(contentItemVersions, eq(contentItemVersions.id, friendsRoomRounds.contentItemVersionId))
      .where(and(eq(friendsRoomRounds.roomId, roomId), eq(friendsRoomRounds.position, 1))).limit(1))[0]
    const correctTitle = (roundRow.payload as TitleItem).titleRu
    await database.db.update(contentItemVersions).set({
      payload: { ...(roundRow.payload as TitleItem), posterUrl: '/media/friends-room-integration/answer.png' },
    }).where(eq(contentItemVersions.id, roundRow.id))

    const activeRoom = await snapshot(playerCookie)
    expect(activeRoom.phase).toBe('active')
    expect(activeRoom.round?.answer).toBeNull()
    expect(activeRoom.round?.answerCard).toBeNull()
    expect(activeRoom.answers).toEqual([])

    const hiddenImage = await app.inject({ method: 'GET', url: `/api/v1/friends/rooms/${roomId}/answer-image`, headers: { cookie: playerCookie } })
    expect(hiddenImage.statusCode).toBe(409)

    const ownerAnswer = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/answers`,
      headers: { cookie: ownerCookie },
      payload: { text: correctTitle, idempotencyKey: crypto.randomUUID() },
    })
    expect(ownerAnswer.statusCode).toBe(200)
    expect(ownerAnswer.json().room.phase).toBe('active')
    expect(ownerAnswer.json().room.round.answer).toBeNull()
    expect(ownerAnswer.json().room.answers).toEqual([])

    const playerAnswerKey = crypto.randomUUID()
    const playerAnswer = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/answers`,
      headers: { cookie: playerCookie },
      payload: { text: 'заведомо неверный ответ', idempotencyKey: playerAnswerKey },
    })
    expect(playerAnswer.statusCode).toBe(200)
    const results = playerAnswer.json().room as FriendsRoomSnapshot
    expect(results.phase).toBe('results')
    expect(results.round?.answer).toBe(correctTitle)
    expect(results.round?.answerCard).toMatchObject({ titleRu: correctTitle, mode: 'movie' })
    expect(results.round?.answerCard?.posterUrl).toBe(`/api/v1/friends/rooms/${roomId}/answer-image`)
    expect(results.answers).toHaveLength(2)
    expect(results.answers.filter((answer) => answer.correct)).toHaveLength(1)
    expect(results.members.find((member) => member.role === 'owner')?.score).toBeGreaterThan(0)
    expect(results.members.find((member) => member.role === 'player')?.score).toBe(0)

    const revealedImage = await app.inject({ method: 'GET', url: `/api/v1/friends/rooms/${roomId}/answer-image`, headers: { cookie: playerCookie } })
    expect(revealedImage.statusCode).toBe(200)
    expect(revealedImage.headers['content-type']).toMatch(/^image\//)

    const replayedPlayerAnswer = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/answers`,
      headers: { cookie: playerCookie },
      payload: { text: 'этот текст не должен заменить ответ', idempotencyKey: playerAnswerKey },
    })
    expect(replayedPlayerAnswer.statusCode).toBe(200)
    expect(replayedPlayerAnswer.json().room.answers.find((entry: { userId: string; text: string }) => entry.userId === results.currentUserId)?.text).toBe('заведомо неверный ответ')
  })

  it('requires registration but allows regular players on the production API route', async () => {
    const productionApp = await buildApp({
      config: { ...loadConfig(), production: true, friendsRoomPreview: false },
      db: database.db,
    })
    await productionApp.ready()
    try {
      const guest = await productionApp.inject({ method: 'POST', url: '/api/v1/auth/guest' })
      expect(guest.statusCode).toBe(200)
      const cookie = responseCookie(guest.headers)
      const me = await productionApp.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })
      const userId = me.json().user.id as string

      const denied = await productionApp.inject({
        method: 'POST', url: '/api/v1/friends/rooms', headers: { cookie }, payload: { mode: 'movie' },
      })
      expect(denied.statusCode).toBe(403)
      expect(denied.json().error.code).toBe('FRIENDS_ROOM_ACCOUNT_REQUIRED')

      await database.db.update(user).set({ isAnonymous: false }).where(eq(user.id, userId))
      const allowed = await productionApp.inject({
        method: 'POST', url: '/api/v1/friends/rooms', headers: { cookie }, payload: { mode: 'movie' },
      })
      expect(allowed.statusCode).toBe(201)
      productionRoomId = allowed.json().room.id
    } finally {
      await productionApp.close()
    }
  })
})
