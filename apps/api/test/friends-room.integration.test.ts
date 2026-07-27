import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import type { FriendsRoomSnapshot, TitleItem } from '@shoditsa/contracts'
import {
  contentItemVersions,
  createDatabase,
  danetkiSessionMembers,
  danetkiSessionState,
  friendsRoomMembers,
  friendsRoomRounds,
  friendsRooms,
  gameSessions,
  playerProfiles,
  user,
  userEntitlements,
  walletAccounts,
} from '@shoditsa/database'
import { buildApp } from '../src/app.js'
import { finishLinkedDanetkiFriendsRoom } from '../src/modules/danetki/service.js'

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
  let danetkiRoomId = ''
  let danetkiSessionId = ''
  let productionRoomId = ''
  let staleRecoveryRoomIds: string[] = []
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

  const grantClub = async (cookie: string) => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })
    const userId = me.json().user.id as string
    await database.db.insert(userEntitlements).values({
      userId,
      entitlementKey: 'club',
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 86_400_000),
      sourceType: 'admin',
      sourceId: `friends-room-test-${crypto.randomUUID()}`,
    })
    return userId
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
    await grantClub(ownerCookie)
  })

  afterAll(async () => {
    if (roomId) await database.db.delete(friendsRooms).where(eq(friendsRooms.id, roomId))
    if (danetkiRoomId) await database.db.delete(friendsRooms).where(eq(friendsRooms.id, danetkiRoomId))
    if (danetkiSessionId) await database.db.delete(gameSessions).where(eq(gameSessions.id, danetkiSessionId))
    if (productionRoomId) await database.db.delete(friendsRooms).where(eq(friendsRooms.id, productionRoomId))
    for (const staleRoomId of staleRecoveryRoomIds) {
      await database.db.delete(friendsRooms).where(eq(friendsRooms.id, staleRoomId))
    }
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

    const duplicateCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/rooms',
      headers: { cookie: ownerCookie },
      payload: { gameType: 'danetki' },
    })
    expect(duplicateCreate.statusCode).toBe(201)
    expect(duplicateCreate.json().room).toMatchObject({ id: roomId, code: roomCode, gameType: 'quiz' })

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

    const ownerRooms = await app.inject({ method: 'GET', url: '/api/v1/friends/rooms', headers: { cookie: ownerCookie } })
    expect(ownerRooms.statusCode).toBe(200)
    expect(ownerRooms.json().rooms).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: roomId, code: roomCode, isHost: true, players: 2, capacity: 8, phase: 'lobby' }),
    ]))
    const playerRooms = await app.inject({ method: 'GET', url: '/api/v1/friends/rooms', headers: { cookie: playerCookie } })
    expect(playerRooms.statusCode).toBe(200)
    expect(playerRooms.json().rooms).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: roomId, code: roomCode, isHost: false, players: 2 }),
    ]))

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

    const left = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/leave`,
      headers: { cookie: ownerCookie },
      payload: { idempotencyKey: crypto.randomUUID() },
    })
    expect(left.statusCode).toBe(200)
    const ownerRoomsAfterLeave = await app.inject({ method: 'GET', url: '/api/v1/friends/rooms', headers: { cookie: ownerCookie } })
    const playerRoomsAfterHostLeave = await app.inject({ method: 'GET', url: '/api/v1/friends/rooms', headers: { cookie: playerCookie } })
    expect(ownerRoomsAfterLeave.json().rooms).toEqual([])
    expect(playerRoomsAfterHostLeave.json().rooms).toEqual([])
  })

  it('releases a stale membership from a closed room before creating another room', async () => {
    const cookie = await createGuest()
    await grantClub(cookie)
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/rooms',
      headers: { cookie },
      payload: { mode: 'series' },
    })
    expect(first.statusCode).toBe(201)
    const firstRoomId = first.json().room.id as string
    staleRecoveryRoomIds.push(firstRoomId)

    await database.db.update(friendsRooms).set({
      phase: 'finished',
      closedAt: new Date(),
      phaseEndsAt: null,
    }).where(eq(friendsRooms.id, firstRoomId))

    const recovered = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/rooms',
      headers: { cookie },
      payload: { mode: 'movie' },
    })
    expect(recovered.statusCode).toBe(201)
    const recoveredRoomId = recovered.json().room.id as string
    staleRecoveryRoomIds.push(recoveredRoomId)
    expect(recoveredRoomId).not.toBe(firstRoomId)

    const staleMembership = await database.db.select().from(friendsRoomMembers).where(eq(friendsRoomMembers.roomId, firstRoomId))
    expect(staleMembership[0]?.leftAt).toBeInstanceOf(Date)

    const left = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${recoveredRoomId}/leave`,
      headers: { cookie },
      payload: { idempotencyKey: crypto.randomUUID() },
    })
    expect(left.statusCode).toBe(200)
  })

  it('starts a shared Danetki session inside the universal room', async () => {
    const ownerMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: ownerCookie } })
    const ownerUserId = ownerMe.json().user.id as string
    const playerMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: playerCookie } })
    const playerUserId = playerMe.json().user.id as string
    await database.db.insert(walletAccounts).values({ userId: ownerUserId, balance: 10_000 }).onConflictDoUpdate({
      target: walletAccounts.userId,
      set: { balance: 10_000 },
    })

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/rooms',
      headers: { cookie: ownerCookie },
      payload: { gameType: 'danetki' },
    })
    expect(created.statusCode).toBe(201)
    const room = created.json().room as FriendsRoomSnapshot
    danetkiRoomId = room.id
    expect(room).toMatchObject({ gameType: 'danetki', capacity: 4, phase: 'lobby', danetkiSessionId: null })
    expect(room.danetkiLaunchCost).toEqual(expect.any(Number))

    const preview = await app.inject({
      method: 'GET',
      url: `/api/v1/friends/rooms/code/${room.code}`,
      headers: { cookie: playerCookie },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({
      gameType: 'danetki',
      danetkiLaunchCost: room.danetkiLaunchCost,
      players: 1,
      capacity: 4,
    })

    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/code/${room.code}/join`,
      headers: { cookie: playerCookie },
      payload: { displayName: 'Сыщик' },
    })
    expect(joined.statusCode).toBe(200)
    expect(joined.json().room.members).toHaveLength(2)
    expect(joined.json().room.danetkiLaunchCost).toBe(room.danetkiLaunchCost)

    const startKey = crypto.randomUUID()
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${room.id}/start`,
      headers: { cookie: ownerCookie },
      payload: { idempotencyKey: startKey },
    })
    expect(started.statusCode).toBe(200)
    expect(started.json().room).toMatchObject({ gameType: 'danetki', phase: 'active' })
    danetkiSessionId = started.json().room.danetkiSessionId
    expect(danetkiSessionId).toEqual(expect.any(String))

    const playerSession = await app.inject({
      method: 'GET',
      url: `/api/v1/games/${danetkiSessionId}`,
      headers: { cookie: playerCookie },
    })
    expect(playerSession.statusCode).toBe(200)
    expect(playerSession.json().session).toMatchObject({
      id: danetkiSessionId,
      engine: 'danetki_chat',
      danetki: {
        roomMode: 'group',
        capacity: 4,
        startedAt: expect.any(String),
        currentTurnUserId: expect.any(String),
      },
    })
    expect(playerSession.json().session.danetki.members.filter((member: { leftAt: string | null }) => !member.leftAt)).toHaveLength(2)

    const [state, members] = await Promise.all([
      database.db.select().from(danetkiSessionState).where(eq(danetkiSessionState.sessionId, danetkiSessionId)),
      database.db.select().from(danetkiSessionMembers).where(eq(danetkiSessionMembers.sessionId, danetkiSessionId)),
    ])
    expect(state[0]?.startedAt).toBeInstanceOf(Date)
    expect(members).toHaveLength(2)

    const replayed = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${room.id}/start`,
      headers: { cookie: ownerCookie },
      payload: { idempotencyKey: startKey },
    })
    expect(replayed.statusCode).toBe(200)
    expect(replayed.json().room.danetkiSessionId).toBe(danetkiSessionId)

    await finishLinkedDanetkiFriendsRoom(database.db, danetkiSessionId)
    const finishedForOwner = await app.inject({
      method: 'GET',
      url: `/api/v1/friends/rooms/${room.id}/snapshot`,
      headers: { cookie: ownerCookie },
    })
    const finishedForPlayer = await app.inject({
      method: 'GET',
      url: `/api/v1/friends/rooms/${room.id}/snapshot`,
      headers: { cookie: playerCookie },
    })
    expect(finishedForOwner.json().room.phase).toBe('finished')
    expect(finishedForPlayer.json().room.phase).toBe('finished')

    const playerLeft = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${room.id}/leave`,
      headers: { cookie: playerCookie },
      payload: { idempotencyKey: crypto.randomUUID() },
    })
    expect(playerLeft.statusCode).toBe(200)
    const playerMembership = await database.db.select().from(danetkiSessionMembers).where(and(
      eq(danetkiSessionMembers.sessionId, danetkiSessionId),
      eq(danetkiSessionMembers.userId, playerUserId),
    ))
    expect(playerMembership[0]?.leftAt).toBeInstanceOf(Date)
    const ownerAfterPlayerLeave = await app.inject({
      method: 'GET',
      url: `/api/v1/friends/rooms/${room.id}/snapshot`,
      headers: { cookie: ownerCookie },
    })
    expect(ownerAfterPlayerLeave.json().room.members.filter((member: { leftAt: string | null }) => !member.leftAt)).toHaveLength(1)

    const ownerLeft = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${room.id}/leave`,
      headers: { cookie: ownerCookie },
      payload: { idempotencyKey: crypto.randomUUID() },
    })
    expect(ownerLeft.statusCode).toBe(200)
    const closedRoom = await database.db.select().from(friendsRooms).where(eq(friendsRooms.id, room.id))
    expect(closedRoom[0]?.closedAt).toBeInstanceOf(Date)
    const [ownerRooms, playerRooms, stalePreview] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/friends/rooms', headers: { cookie: ownerCookie } }),
      app.inject({ method: 'GET', url: '/api/v1/friends/rooms', headers: { cookie: playerCookie } }),
      app.inject({ method: 'GET', url: `/api/v1/friends/rooms/code/${room.code}`, headers: { cookie: playerCookie } }),
    ])
    expect(ownerRooms.json().rooms).toEqual([])
    expect(playerRooms.json().rooms).toEqual([])
    expect(stalePreview.statusCode).toBe(404)
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
      const clubDenied = await productionApp.inject({
        method: 'POST', url: '/api/v1/friends/rooms', headers: { cookie }, payload: { mode: 'movie' },
      })
      expect(clubDenied.statusCode).toBe(403)
      expect(clubDenied.json().error.code).toBe('FRIENDS_ROOM_CLUB_REQUIRED')

      await database.db.insert(userEntitlements).values({
        userId,
        entitlementKey: 'club',
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 86_400_000),
        sourceType: 'admin',
        sourceId: `friends-room-production-test-${crypto.randomUUID()}`,
      })
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
