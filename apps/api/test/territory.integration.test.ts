import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import type { FriendsRoomSnapshot } from '@shoditsa/contracts'
import {
  createDatabase,
  friendsRooms,
  territoryAnswers,
  territoryDuels,
  territoryMatches,
  user,
  userEntitlements,
} from '@shoditsa/database'
import { buildApp } from '../src/app.js'

const responseCookie = (headers: Record<string, unknown>) => {
  const raw = headers['set-cookie']
  return (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map((value) => String(value).split(';')[0]).join('; ')
}

describe('territory multiplayer API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let database: ReturnType<typeof createDatabase>
  let ownerCookie = ''
  let playerCookie = ''
  let thirdCookie = ''
  let ownerUserId = ''
  let playerUserId = ''
  let thirdUserId = ''
  let roomId = ''

  const createGuest = async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/guest' })
    expect(response.statusCode).toBe(200)
    return responseCookie(response.headers)
  }

  const currentUserId = async (cookie: string) => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })
    expect(response.statusCode).toBe(200)
    return response.json().user.id as string
  }

  const roomSnapshot = async (cookie: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/friends/rooms/${roomId}/snapshot`,
      headers: { cookie },
    })
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
    process.env.TERRITORY_ENABLED = 'true'
    const config = loadConfig()
    database = createDatabase(config)
    app = await buildApp({ config, db: database.db })
    await app.ready()

    ownerCookie = await createGuest()
    playerCookie = await createGuest()
    thirdCookie = await createGuest()
    ownerUserId = await currentUserId(ownerCookie)
    playerUserId = await currentUserId(playerCookie)
    thirdUserId = await currentUserId(thirdCookie)
    await database.db.update(user).set({ isAnonymous: false }).where(eq(user.id, ownerUserId))
    await database.db.insert(userEntitlements).values({
      userId: ownerUserId,
      entitlementKey: 'club',
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 86_400_000),
      sourceType: 'admin',
      sourceId: `territory-integration-${crypto.randomUUID()}`,
    })
  })

  afterAll(async () => {
    if (roomId) await database.db.delete(friendsRooms).where(eq(friendsRooms.id, roomId))
    for (const userId of [ownerUserId, playerUserId, thirdUserId]) {
      if (userId) await database.db.delete(user).where(eq(user.id, userId))
    }
    await app?.close()
    await database?.client.end()
  })

  it('plays a leak-free duel, captures a legal cell, and starts a swapped rematch', async () => {
    const meta = await app.inject({ method: 'GET', url: '/api/v1/meta', headers: { cookie: ownerCookie } })
    expect(meta.statusCode).toBe(200)
    expect(meta.json().features.territoryEnabled).toBe(true)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/rooms',
      headers: { cookie: ownerCookie },
      payload: { gameType: 'territory' },
    })
    expect(created.statusCode).toBe(201)
    const lobby = created.json().room as FriendsRoomSnapshot
    roomId = lobby.id
    expect(lobby).toMatchObject({ gameType: 'territory', capacity: 2, phase: 'lobby', roundsTotal: 20, answerTimeSeconds: 20 })
    expect(lobby.packs).toEqual([])

    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/code/${lobby.code}/join`,
      headers: { cookie: playerCookie },
      payload: { displayName: 'Соперник' },
    })
    expect(joined.statusCode).toBe(200)
    expect(joined.json().room.members).toHaveLength(2)

    const full = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/code/${lobby.code}/join`,
      headers: { cookie: thirdCookie },
      payload: { displayName: 'Третий' },
    })
    expect(full.statusCode).toBe(409)
    expect(full.json().error.code).toBe('FRIENDS_ROOM_FULL')

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/start`,
      headers: { cookie: ownerCookie },
      payload: { idempotencyKey: crypto.randomUUID() },
    })
    expect(started.statusCode).toBe(200)
    const countdown = started.json().room as FriendsRoomSnapshot
    expect(countdown.phase).toBe('countdown')
    expect(countdown.territory).toMatchObject({ phase: 'countdown', duelNumber: 1, maxDuels: 20 })
    expect(countdown.territory?.map.cells).toHaveLength(12)

    const match = (await database.db.select().from(territoryMatches)
      .where(eq(territoryMatches.roomId, roomId)).limit(1))[0]
    const duel = (await database.db.select().from(territoryDuels)
      .where(eq(territoryDuels.matchId, match.id)).limit(1))[0]
    expect(match.mapSeed).toEqual(expect.any(String))
    expect(match.mapSnapshot.seed).toBe(match.mapSeed)

    const expired = new Date(Date.now() - 1_000)
    await database.db.update(territoryMatches).set({
      phase: 'countdown',
      phaseEndsAt: expired,
    }).where(eq(territoryMatches.id, match.id))
    await database.db.update(friendsRooms).set({
      phase: 'countdown',
      phaseEndsAt: expired,
    }).where(eq(friendsRooms.id, roomId))

    const ownerQuestion = await roomSnapshot(ownerCookie)
    const playerQuestion = await roomSnapshot(playerCookie)
    expect(ownerQuestion.territory?.phase).toBe('question')
    expect(playerQuestion.territory?.phase).toBe('question')
    if (ownerQuestion.territory?.phase !== 'question' || playerQuestion.territory?.phase !== 'question') throw new Error('Question phase expected')
    expect(ownerQuestion.territory.question.options.every((option) => option.id.startsWith('o_'))).toBe(true)
    expect(JSON.stringify(ownerQuestion.territory.question)).not.toContain('correctOptionId')
    expect(JSON.stringify(playerQuestion.territory.question)).not.toContain('correctOptionId')

    const correctOptionId = duel.correctOptionId
    const wrongOptionIds = ownerQuestion.territory.question.options.filter((option) => option.id !== correctOptionId).map((option) => option.id)
    const [closerOptionId, fartherOptionId] = wrongOptionIds
    const numericOptions = duel.options.map((option) => ({
      ...option,
      text: option.id === correctOptionId ? '100' : option.id === closerOptionId ? '95' : option.id === fartherOptionId ? '160' : '0',
    })) as typeof duel.options
    await database.db.update(territoryDuels).set({ options: numericOptions }).where(eq(territoryDuels.id, duel.id))
    const duelId = ownerQuestion.territory.question.duelId
    const staleAnswer = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/territory/answers`,
      headers: { cookie: ownerCookie, 'idempotency-key': crypto.randomUUID() },
      payload: { duelId: crypto.randomUUID(), optionId: correctOptionId },
    })
    expect(staleAnswer.statusCode).toBe(409)
    const ownerAnswerKey = crypto.randomUUID()
    const ownerAnswer = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/territory/answers`,
      headers: { cookie: ownerCookie, 'idempotency-key': ownerAnswerKey },
      payload: { duelId, optionId: closerOptionId },
    })
    expect(ownerAnswer.statusCode).toBe(200)
    expect(ownerAnswer.json().room.territory.question.ownOptionId).toBe(closerOptionId)
    expect(JSON.stringify(ownerAnswer.json().room.territory.question)).not.toContain('correctOptionId')

    const replayedAnswer = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/territory/answers`,
      headers: { cookie: ownerCookie, 'idempotency-key': ownerAnswerKey },
      payload: { duelId, optionId: fartherOptionId },
    })
    expect(replayedAnswer.statusCode).toBe(200)

    const playerAnswer = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/territory/answers`,
      headers: { cookie: playerCookie, 'idempotency-key': crypto.randomUUID() },
      payload: { duelId, optionId: fartherOptionId },
    })
    expect(playerAnswer.statusCode).toBe(200)
    expect(playerAnswer.json().room.territory).toMatchObject({
      phase: 'reveal',
      reveal: { correctOptionId, winnerUserId: ownerUserId, result: 'closer' },
    })
    const storedAnswers = await database.db.select().from(territoryAnswers).where(and(
      eq(territoryAnswers.matchId, match.id),
      eq(territoryAnswers.duelId, duel.id),
    ))
    expect(storedAnswers).toHaveLength(2)

    await database.db.update(territoryMatches).set({ phaseEndsAt: expired }).where(eq(territoryMatches.id, match.id))
    const captureTurn = await roomSnapshot(ownerCookie)
    expect(captureTurn.territory?.phase).toBe('capture')
    if (captureTurn.territory?.phase !== 'capture') throw new Error('Capture phase expected')
    expect(captureTurn.territory.capture.actorUserId).toBe(ownerUserId)
    const targetCellId = captureTurn.territory.capture.legalCellIds[0]

    const forbiddenCapture = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/territory/captures`,
      headers: { cookie: playerCookie, 'idempotency-key': crypto.randomUUID() },
      payload: { cellId: targetCellId },
    })
    expect(forbiddenCapture.statusCode).toBe(403)
    expect(forbiddenCapture.json().error.code).toBe('TERRITORY_CAPTURE_FORBIDDEN')

    const captureKey = crypto.randomUUID()
    const captured = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/territory/captures`,
      headers: { cookie: ownerCookie, 'idempotency-key': captureKey },
      payload: { cellId: targetCellId },
    })
    expect(captured.statusCode).toBe(200)
    expect(captured.json().room.territory).toMatchObject({
      phase: 'countdown',
      ownership: { [targetCellId]: ownerUserId },
    })

    await database.db.update(territoryMatches).set({
      phase: 'finished',
      phaseStartedAt: new Date(),
      phaseEndsAt: null,
      winnerUserId: ownerUserId,
      finishReason: 'territories',
    }).where(eq(territoryMatches.id, match.id))
    await database.db.update(friendsRooms).set({ phase: 'finished', phaseEndsAt: null }).where(eq(friendsRooms.id, roomId))

    const ownerVote = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/territory/rematch`,
      headers: { cookie: ownerCookie, 'idempotency-key': crypto.randomUUID() },
      payload: {},
    })
    expect(ownerVote.statusCode).toBe(200)
    expect(ownerVote.json().room.territory.rematchReadyUserIds).toContain(ownerUserId)

    const playerVote = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/rooms/${roomId}/territory/rematch`,
      headers: { cookie: playerCookie, 'idempotency-key': crypto.randomUUID() },
      payload: {},
    })
    expect(playerVote.statusCode).toBe(200)
    expect(playerVote.json().room.territory).toMatchObject({ phase: 'countdown', matchNumber: 2 })
    expect(playerVote.json().room.territory.players.map((entry: { userId: string }) => entry.userId)).toEqual([playerUserId, ownerUserId])
    expect(playerVote.json().room.territory.map.seed).not.toBe(match.mapSeed)
  })
})
