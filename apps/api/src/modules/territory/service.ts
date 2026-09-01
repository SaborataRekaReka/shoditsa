import { createHash, randomBytes } from 'node:crypto'
import { and, asc, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  TERRITORY_CAPITAL_TOWERS,
  TERRITORY_CAPTURE_TIME_MS,
  TERRITORY_DEFAULT_CELL_COUNT,
  TERRITORY_MAX_DUELS,
  TERRITORY_MAX_QUESTION_COUNT,
  TERRITORY_QUESTION_TIME_MS,
  TERRITORY_RULES_VERSION,
  type TerritoryAnswerRule,
  type TerritoryDifficulty,
  type TerritoryDuelKind,
  type TerritoryDuelResultReason,
  type TerritoryFinishReason,
  type TerritoryMapSnapshot,
  type TerritoryOwnership,
  type TerritoryPublicSnapshot,
  type TerritoryQuestionItem,
  type TerritoryQuestionProvenance,
  type TerritorySiegeState,
} from '@shoditsa/contracts'
import {
  applyTerritoryCapture,
  createInitialTerritoryOwnership,
  createTerritoryMap,
  legalTerritoryCaptures,
  resolveTerritoryDuel,
  resolveTerritoryMatch,
  resolveTerritorySiegeDuel,
  territoryAnswerDistance,
  territoryComparableOptionValues,
  territoryCountForPlayer,
  territoryValueForPlayer,
  validateTerritoryQuestion,
} from '@shoditsa/game-core'
import {
  contentItemVersions,
  friendsRoomMembers,
  friendsRooms,
  territoryAnswers,
  territoryDuels,
  territoryMatches,
  territoryRematchVotes,
  type Database,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type MatchRow = typeof territoryMatches.$inferSelect
type DuelRow = typeof territoryDuels.$inferSelect
type MatchStats = Record<string, { correctAnswers: number; totalCorrectAnswerTimeMs: number }>
type PlayerPair = readonly [string, string]

const COUNTDOWN_MS = 3_000
const REVEAL_MS = 2_800
const PRESENCE_MS = 35_000
const MIN_QUESTION_POOL = 80
const MAX_CLOCK_TRANSITIONS = TERRITORY_MAX_QUESTION_COUNT * 3 + 4

const iso = (value: Date | null) => value?.toISOString() ?? null
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const opaqueOptionId = (seed: string, optionId: string) => `o_${hash(`${seed}:${optionId}`).slice(0, 18)}`

const initialSiegeState = (map: TerritoryMapSnapshot): TerritorySiegeState => ({
  active: null,
  towersRemaining: Object.fromEntries(map.baseCellIds.map((cellId) => [cellId, TERRITORY_CAPITAL_TOWERS])),
})

const safeSiegeState = (match: MatchRow): TerritorySiegeState => {
  const stored = match.siegeState && typeof match.siegeState === 'object' ? match.siegeState : initialSiegeState(match.mapSnapshot)
  const baseCellIds = new Set(match.mapSnapshot.baseCellIds)
  const active = stored.active
    && baseCellIds.has(stored.active.targetCellId)
    && [match.playerOneUserId, match.playerTwoUserId].includes(stored.active.attackerUserId)
    ? stored.active
    : null
  return {
    active,
    towersRemaining: Object.fromEntries(match.mapSnapshot.baseCellIds.map((cellId) => {
      const remaining = stored.towersRemaining?.[cellId]
      return [cellId, Number.isInteger(remaining) ? Math.max(0, Math.min(TERRITORY_CAPITAL_TOWERS, remaining)) : TERRITORY_CAPITAL_TOWERS]
    })),
  }
}

const safeStats = (match: MatchRow): MatchStats => {
  const stored = match.playerStats && typeof match.playerStats === 'object' ? match.playerStats as MatchStats : {}
  return Object.fromEntries([match.playerOneUserId, match.playerTwoUserId].map((userId) => {
    const current = stored[userId]
    return [userId, {
      correctAnswers: Number.isInteger(current?.correctAnswers) ? Math.max(0, current.correctAnswers) : 0,
      totalCorrectAnswerTimeMs: Number.isFinite(current?.totalCorrectAnswerTimeMs) ? Math.max(0, Math.trunc(current.totalCorrectAnswerTimeMs)) : 0,
    }]
  }))
}

const latestMatch = async (db: Pick<Database, 'select'>, roomId: string) => (
  (await db.select().from(territoryMatches)
    .where(eq(territoryMatches.roomId, roomId))
    .orderBy(desc(territoryMatches.matchNumber)).limit(1))[0] ?? null
)

const currentDuel = async (db: Pick<Database, 'select'>, match: MatchRow) => (
  (await db.select().from(territoryDuels).where(and(
    eq(territoryDuels.matchId, match.id),
    eq(territoryDuels.position, match.currentDuel),
  )).limit(1))[0] ?? null
)

const lockRoomAndMatch = async (tx: Transaction, roomId: string) => {
  const room = (await tx.select().from(friendsRooms).where(eq(friendsRooms.id, roomId)).for('update').limit(1))[0]
  if (!room || room.closedAt) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
  if (room.gameType !== 'territory') throw new ApiError(409, 'TERRITORY_ROOM_REQUIRED', 'Эта комната использует другой режим')
  const match = (await tx.select().from(territoryMatches)
    .where(eq(territoryMatches.roomId, roomId))
    .orderBy(desc(territoryMatches.matchNumber)).for('update').limit(1))[0] ?? null
  return { room, match }
}

const assertActiveMember = async (tx: Transaction, roomId: string, userId: string) => {
  const member = (await tx.select().from(friendsRoomMembers).where(and(
    eq(friendsRoomMembers.roomId, roomId),
    eq(friendsRoomMembers.userId, userId),
    isNull(friendsRoomMembers.leftAt),
  )).limit(1))[0]
  if (!member) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
  return member
}

const shuffledPublicOptions = (question: TerritoryQuestionItem, seed: string) => {
  const ordered = [...question.options].sort((left, right) => (
    hash(`${seed}:order:${left.id}`).localeCompare(hash(`${seed}:order:${right.id}`))
  ))
  const options = ordered.map((option) => ({ id: opaqueOptionId(seed, option.id), text: option.text })) as [
    { id: string; text: string },
    { id: string; text: string },
    { id: string; text: string },
    { id: string; text: string },
  ]
  const correctOptionId = options[ordered.findIndex((option) => option.id === question.correctOptionId)]?.id
  if (!correctOptionId) throw new ApiError(500, 'TERRITORY_QUESTION_INVALID', 'Правильный вариант вопроса не найден')
  return { options, correctOptionId }
}

const createDuel = async (tx: Transaction, match: MatchRow, position: number, kind: TerritoryDuelKind = 'regular') => {
  if (position > TERRITORY_MAX_QUESTION_COUNT) throw new ApiError(500, 'TERRITORY_QUESTION_LIMIT', 'Превышен лимит вопросов матча')
  const candidates = await tx.select({
    id: contentItemVersions.id,
    itemId: contentItemVersions.itemId,
    payload: contentItemVersions.payload,
  }).from(contentItemVersions).where(and(
    eq(contentItemVersions.revisionId, match.revisionId),
    eq(contentItemVersions.mode, 'territory'),
    eq(contentItemVersions.allowedInGame, true),
    eq(contentItemVersions.contentStatus, 'ready'),
  )).orderBy(asc(contentItemVersions.itemId))
  if (candidates.length < MIN_QUESTION_POOL) {
    throw new ApiError(503, 'TERRITORY_CONTENT_NOT_READY', `Для игры нужно минимум ${MIN_QUESTION_POOL} проверенных вопросов`)
  }
  const used = new Set((await tx.select({ id: territoryDuels.contentItemVersionId }).from(territoryDuels)
    .where(eq(territoryDuels.matchId, match.id))).map((entry) => entry.id))
  const candidate = [...candidates]
    .sort((left, right) => hash(`${match.mapSeed}:question:${left.itemId}`).localeCompare(hash(`${match.mapSeed}:question:${right.itemId}`)))
    .find((entry) => !used.has(entry.id))
  if (!candidate) throw new ApiError(503, 'TERRITORY_QUESTIONS_EXHAUSTED', 'Вопросы для матча закончились')
  const question = candidate.payload as TerritoryQuestionItem
  const errors = validateTerritoryQuestion(question).filter((issue) => issue.severity === 'error')
  if (errors.length) {
    throw new ApiError(500, 'TERRITORY_QUESTION_INVALID', `Вопрос ${candidate.itemId} не прошёл проверку: ${errors.map((issue) => issue.code).join(', ')}`)
  }
  const shuffled = shuffledPublicOptions(question, `${match.mapSeed}:${position}:${candidate.itemId}`)
  const inserted = (await tx.insert(territoryDuels).values({
    matchId: match.id,
    position,
    kind,
    contentItemVersionId: candidate.id,
    prompt: question.prompt,
    categoryId: question.category.id,
    categoryLabel: question.category.label,
    difficulty: question.difficulty,
    options: shuffled.options,
    correctOptionId: shuffled.correctOptionId,
    explanation: question.explanation,
    provenance: question.provenance,
  }).returning())[0]
  if (!inserted) throw new ApiError(500, 'TERRITORY_DUEL_CREATE_FAILED', 'Не удалось подготовить вопрос')
  return inserted
}

const createMatch = async (
  tx: Transaction,
  room: typeof friendsRooms.$inferSelect,
  playerIds: PlayerPair,
  matchNumber: number,
  startedAt: Date,
) => {
  const mapSeed = `territory:${room.id}:${matchNumber}:${randomBytes(12).toString('hex')}`
  const map = createTerritoryMap(mapSeed, TERRITORY_DEFAULT_CELL_COUNT)
  const ownership = createInitialTerritoryOwnership(map, playerIds)
  const playerStats: MatchStats = Object.fromEntries(playerIds.map((userId) => [userId, {
    correctAnswers: 0,
    totalCorrectAnswerTimeMs: 0,
  }]))
  const match = (await tx.insert(territoryMatches).values({
    roomId: room.id,
    matchNumber,
    revisionId: room.revisionId,
    playerOneUserId: playerIds[0],
    playerTwoUserId: playerIds[1],
    phase: 'countdown',
    phaseStartedAt: startedAt,
    phaseEndsAt: new Date(startedAt.getTime() + COUNTDOWN_MS),
    mapSeed,
    mapVersion: map.version,
    mapSnapshot: map,
    ownership,
    siegeState: initialSiegeState(map),
    playerStats,
    currentDuel: 1,
    maxDuels: TERRITORY_MAX_DUELS,
    rulesVersion: TERRITORY_RULES_VERSION,
  }).returning())[0]
  if (!match) throw new ApiError(500, 'TERRITORY_MATCH_CREATE_FAILED', 'Не удалось создать матч')
  await createDuel(tx, match, 1)
  await tx.update(friendsRoomMembers).set({ score: 0 }).where(eq(friendsRoomMembers.roomId, room.id))
  await tx.update(friendsRooms).set({
    mode: 'territory',
    packs: [],
    roundsTotal: TERRITORY_MAX_DUELS,
    answerTimeSeconds: TERRITORY_QUESTION_TIME_MS / 1_000,
    phase: 'countdown',
    currentRound: 1,
    phaseStartedAt: startedAt,
    phaseEndsAt: new Date(startedAt.getTime() + COUNTDOWN_MS),
    version: sql`${friendsRooms.version} + 1`,
    updatedAt: startedAt,
  }).where(eq(friendsRooms.id, room.id))
  return match
}

export const startTerritoryMatch = async (db: Database, roomId: string, userId: string) => {
  await db.transaction(async (tx) => {
    const { room, match } = await lockRoomAndMatch(tx, roomId)
    if (room.ownerUserId !== userId) throw new ApiError(403, 'FRIENDS_ROOM_HOST_REQUIRED', 'Запустить матч может создатель комнаты')
    await assertActiveMember(tx, roomId, userId)
    if (match || room.phase !== 'lobby') return
    const members = await tx.select().from(friendsRoomMembers).where(and(
      eq(friendsRoomMembers.roomId, roomId),
      isNull(friendsRoomMembers.leftAt),
    )).orderBy(asc(friendsRoomMembers.joinedAt), asc(friendsRoomMembers.userId))
    if (members.length !== 2) throw new ApiError(409, 'TERRITORY_REQUIRES_TWO_PLAYERS', 'Для «Захвата» нужны ровно два игрока')
    const now = new Date()
    if (members.some((member) => now.getTime() - member.lastSeenAt.getTime() > PRESENCE_MS)) {
      throw new ApiError(409, 'TERRITORY_PLAYER_OFFLINE', 'Оба игрока должны быть в комнате перед стартом')
    }
    await createMatch(tx, room, [members[0].userId, members[1].userId], 1, now)
  })
}

const updateRoomClock = async (tx: Transaction, roomId: string, phase: 'countdown' | 'active' | 'finished', startedAt: Date, endsAt: Date | null, currentRound: number) => {
  await tx.update(friendsRooms).set({
    phase,
    phaseStartedAt: startedAt,
    phaseEndsAt: endsAt,
    currentRound,
    version: sql`${friendsRooms.version} + 1`,
    updatedAt: new Date(),
  }).where(eq(friendsRooms.id, roomId))
}

const resolveDuel = async (tx: Transaction, match: MatchRow, duel: DuelRow, resolvedAt: Date) => {
  if (duel.resolvedAt) return
  const answers = await tx.select().from(territoryAnswers).where(eq(territoryAnswers.duelId, duel.id))
  const resolution = resolveTerritoryDuel({
    playerIds: [match.playerOneUserId, match.playerTwoUserId],
    answers: answers.map((answer) => ({
      userId: answer.userId,
      correct: answer.isCorrect,
      distance: territoryAnswerDistance(duel.options, duel.correctOptionId, answer.optionId),
      elapsedMs: answer.elapsedMs,
    })),
  })
  let ownership = match.ownership
  let siegeState = safeSiegeState(match)
  let capturedCellId: string | null = null
  let previousOwnerUserId: string | null = null
  if (duel.kind === 'siege') {
    if (!siegeState.active) throw new ApiError(500, 'TERRITORY_SIEGE_INVALID', 'Состояние осады повреждено')
    const targetCellId = siegeState.active.targetCellId
    const siegeResolution = resolveTerritorySiegeDuel({
      map: match.mapSnapshot,
      ownership,
      siegeState,
      playerIds: [match.playerOneUserId, match.playerTwoUserId],
      winnerUserId: resolution.winnerUserId,
    })
    ownership = siegeResolution.ownership
    siegeState = siegeResolution.siegeState
    previousOwnerUserId = siegeResolution.previousOwnerUserId
    if (siegeResolution.capitalCaptured) capturedCellId = targetCellId
  }
  await tx.update(territoryDuels).set({
    resolvedAt,
    result: resolution.result,
    winnerUserId: resolution.winnerUserId,
    ...(capturedCellId ? { capturedCellId, previousOwnerUserId } : {}),
  }).where(eq(territoryDuels.id, duel.id))
  const revealEndsAt = new Date(resolvedAt.getTime() + REVEAL_MS)
  await tx.update(territoryMatches).set({
    phase: 'reveal',
    phaseStartedAt: resolvedAt,
    phaseEndsAt: revealEndsAt,
    ownership,
    siegeState,
    updatedAt: new Date(),
  }).where(eq(territoryMatches.id, match.id))
  await updateRoomClock(tx, match.roomId, 'active', resolvedAt, revealEndsAt, match.currentDuel)
}

const finishMatch = async (
  tx: Transaction,
  match: MatchRow,
  finishedAt: Date,
  winnerUserId: string | null,
  finishReason: TerritoryFinishReason,
) => {
  await tx.update(territoryMatches).set({
    phase: 'finished',
    phaseStartedAt: finishedAt,
    phaseEndsAt: null,
    winnerUserId,
    finishReason,
    updatedAt: new Date(),
  }).where(eq(territoryMatches.id, match.id))
  await updateRoomClock(tx, match.roomId, 'finished', finishedAt, null, match.currentDuel)
}

const startNextDuel = async (
  tx: Transaction,
  match: MatchRow,
  ownership: TerritoryOwnership,
  transitionAt: Date,
  kind: TerritoryDuelKind,
) => {
  const position = match.currentDuel + 1
  const nextMatch = { ...match, ownership, currentDuel: position }
  await createDuel(tx, nextMatch, position, kind)
  const countdownEndsAt = new Date(transitionAt.getTime() + COUNTDOWN_MS)
  await tx.update(territoryMatches).set({
    ownership,
    siegeState: safeSiegeState(nextMatch),
    currentDuel: position,
    phase: 'countdown',
    phaseStartedAt: transitionAt,
    phaseEndsAt: countdownEndsAt,
    updatedAt: new Date(),
  }).where(eq(territoryMatches.id, match.id))
  await updateRoomClock(tx, match.roomId, 'countdown', transitionAt, countdownEndsAt, position)
}

const completedRegularDuelCount = async (tx: Transaction, matchId: string) => {
  const row = (await tx.select({ value: count() }).from(territoryDuels).where(and(
    eq(territoryDuels.matchId, matchId),
    eq(territoryDuels.kind, 'regular'),
    isNotNull(territoryDuels.resolvedAt),
  )))[0]
  return Number(row?.value ?? 0)
}

const continueOrFinish = async (tx: Transaction, match: MatchRow, ownership: TerritoryOwnership, transitionAt: Date) => {
  const stats = safeStats(match)
  const regularDuelCount = await completedRegularDuelCount(tx, match.id)
  const resolution = resolveTerritoryMatch({
    map: match.mapSnapshot,
    ownership,
    players: [
      { userId: match.playerOneUserId, ...stats[match.playerOneUserId] },
      { userId: match.playerTwoUserId, ...stats[match.playerTwoUserId] },
    ],
    duelCount: regularDuelCount,
  })
  if (resolution.status === 'finished') {
    await finishMatch(tx, match, transitionAt, resolution.winnerUserId, resolution.finishReason!)
    return
  }
  await startNextDuel(tx, match, ownership, transitionAt, 'regular')
}

const capture = async (
  tx: Transaction,
  match: MatchRow,
  duel: DuelRow,
  cellId: string,
  capturedAt: Date,
  idempotencyKey: string | null,
) => {
  const actorUserId = duel.winnerUserId
  if (!actorUserId) throw new ApiError(409, 'TERRITORY_CAPTURE_NOT_AVAILABLE', 'В этой дуэли нет победителя')
  const legal = legalTerritoryCaptures(match.mapSnapshot, match.ownership, actorUserId)
  if (!legal.includes(cellId)) throw new ApiError(409, 'TERRITORY_CAPTURE_ILLEGAL', 'Эту территорию сейчас нельзя захватить')
  const previousOwnerUserId = match.ownership[cellId] ?? null
  const capitalIndex = match.mapSnapshot.baseCellIds.indexOf(cellId)
  if (capitalIndex >= 0) {
    const defenderUserId = capitalIndex === 0 ? match.playerOneUserId : match.playerTwoUserId
    if (defenderUserId === actorUserId || previousOwnerUserId !== defenderUserId) {
      throw new ApiError(409, 'TERRITORY_CAPITAL_INVALID', 'Эту столицу нельзя атаковать')
    }
    const siegeState: TerritorySiegeState = {
      ...safeSiegeState(match),
      active: { attackerUserId: actorUserId, targetCellId: cellId },
    }
    await tx.update(territoryDuels).set({
      previousOwnerUserId,
      ...(idempotencyKey ? { captureIdempotencyKey: idempotencyKey } : {}),
    }).where(eq(territoryDuels.id, duel.id))
    await startNextDuel(tx, { ...match, siegeState }, match.ownership, capturedAt, 'siege')
    return
  }
  const ownership = applyTerritoryCapture(match.mapSnapshot, match.ownership, actorUserId, cellId)
  await tx.update(territoryDuels).set({
    capturedCellId: cellId,
    previousOwnerUserId,
    ...(idempotencyKey ? { captureIdempotencyKey: idempotencyKey } : {}),
  }).where(eq(territoryDuels.id, duel.id))
  await tx.update(territoryMatches).set({ ownership, updatedAt: new Date() }).where(eq(territoryMatches.id, match.id))
  await continueOrFinish(tx, { ...match, ownership }, ownership, capturedAt)
}

const advanceOneClockTransition = async (db: Database, roomId: string) => db.transaction(async (tx) => {
  const { match } = await lockRoomAndMatch(tx, roomId)
  if (!match || match.phase === 'finished' || !match.phaseEndsAt || match.phaseEndsAt.getTime() > Date.now()) return false
  const transitionAt = match.phaseEndsAt
  const duel = (await tx.select().from(territoryDuels).where(and(
    eq(territoryDuels.matchId, match.id),
    eq(territoryDuels.position, match.currentDuel),
  )).for('update').limit(1))[0]
  if (!duel) throw new ApiError(500, 'TERRITORY_DUEL_NOT_FOUND', 'Текущая дуэль не найдена')

  if (match.phase === 'countdown') {
    const endsAt = new Date(transitionAt.getTime() + TERRITORY_QUESTION_TIME_MS)
    await tx.update(territoryDuels).set({ startedAt: transitionAt, endsAt }).where(eq(territoryDuels.id, duel.id))
    await tx.update(territoryMatches).set({ phase: 'question', phaseStartedAt: transitionAt, phaseEndsAt: endsAt, updatedAt: new Date() }).where(eq(territoryMatches.id, match.id))
    await updateRoomClock(tx, roomId, 'active', transitionAt, endsAt, match.currentDuel)
    return true
  }
  if (match.phase === 'question') {
    await resolveDuel(tx, match, duel, transitionAt)
    return true
  }
  if (match.phase === 'reveal') {
    if (duel.kind === 'siege') {
      const siegeState = safeSiegeState(match)
      if (siegeState.active && duel.winnerUserId === siegeState.active.attackerUserId) {
        await startNextDuel(tx, match, match.ownership, transitionAt, 'siege')
      } else {
        await continueOrFinish(tx, match, match.ownership, transitionAt)
      }
      return true
    }
    if (duel.winnerUserId) {
      const legal = legalTerritoryCaptures(match.mapSnapshot, match.ownership, duel.winnerUserId)
      if (legal.length) {
        const endsAt = new Date(transitionAt.getTime() + TERRITORY_CAPTURE_TIME_MS)
        await tx.update(territoryMatches).set({ phase: 'capture', phaseStartedAt: transitionAt, phaseEndsAt: endsAt, updatedAt: new Date() }).where(eq(territoryMatches.id, match.id))
        await updateRoomClock(tx, roomId, 'active', transitionAt, endsAt, match.currentDuel)
        return true
      }
    }
    await continueOrFinish(tx, match, match.ownership, transitionAt)
    return true
  }
  if (match.phase === 'capture') {
    if (!duel.winnerUserId) throw new ApiError(500, 'TERRITORY_CAPTURE_WINNER_MISSING', 'Не найден игрок, который выбирает территорию')
    const legal = legalTerritoryCaptures(match.mapSnapshot, match.ownership, duel.winnerUserId)
    if (!legal.length) {
      await continueOrFinish(tx, match, match.ownership, transitionAt)
      return true
    }
    const values = new Map(match.mapSnapshot.cells.map((cell) => [cell.id, cell.value]))
    const automaticCellId = [...legal].sort((left, right) => (values.get(right)! - values.get(left)!) || left.localeCompare(right))[0]
    await capture(tx, match, duel, automaticCellId, transitionAt, null)
    return true
  }
  return false
})

export const advanceTerritoryClock = async (db: Database, roomId: string) => {
  for (let index = 0; index < MAX_CLOCK_TRANSITIONS; index += 1) {
    if (!await advanceOneClockTransition(db, roomId)) break
  }
}

export const submitTerritoryAnswer = async (
  db: Database,
  roomId: string,
  userId: string,
  duelId: string,
  optionId: string,
  idempotencyKey: string,
) => {
  await advanceTerritoryClock(db, roomId)
  await db.transaction(async (tx) => {
    const { match } = await lockRoomAndMatch(tx, roomId)
    if (!match) throw new ApiError(409, 'TERRITORY_MATCH_NOT_STARTED', 'Матч ещё не начался')
    await assertActiveMember(tx, roomId, userId)
    const replay = (await tx.select().from(territoryAnswers).where(and(
      eq(territoryAnswers.roomId, roomId),
      eq(territoryAnswers.userId, userId),
      eq(territoryAnswers.idempotencyKey, idempotencyKey),
    )).limit(1))[0]
    if (replay) return
    if (match.phase !== 'question' || !match.phaseEndsAt || match.phaseEndsAt.getTime() <= Date.now()) {
      throw new ApiError(409, 'TERRITORY_NOT_ACCEPTING_ANSWERS', 'Вопрос уже закрыт')
    }
    const duel = (await tx.select().from(territoryDuels).where(and(
      eq(territoryDuels.matchId, match.id),
      eq(territoryDuels.position, match.currentDuel),
    )).for('update').limit(1))[0]
    if (!duel || !duel.startedAt) throw new ApiError(500, 'TERRITORY_DUEL_NOT_READY', 'Вопрос ещё не готов')
    if (duel.id !== duelId) throw new ApiError(409, 'TERRITORY_QUESTION_CHANGED', 'Этот вопрос уже завершён')
    if (!duel.options.some((option) => option.id === optionId)) throw new ApiError(422, 'TERRITORY_OPTION_INVALID', 'Такого варианта ответа нет')
    const previous = (await tx.select({ id: territoryAnswers.id }).from(territoryAnswers).where(and(
      eq(territoryAnswers.duelId, duel.id),
      eq(territoryAnswers.userId, userId),
    )).limit(1))[0]
    if (previous) throw new ApiError(409, 'TERRITORY_ALREADY_ANSWERED', 'Ответ уже принят')
    const elapsedMs = Math.max(0, Math.min(TERRITORY_QUESTION_TIME_MS, Date.now() - duel.startedAt.getTime()))
    const correct = optionId === duel.correctOptionId
    const inserted = (await tx.insert(territoryAnswers).values({
      roomId,
      matchId: match.id,
      duelId: duel.id,
      userId,
      optionId,
      isCorrect: correct,
      elapsedMs,
      idempotencyKey,
    }).onConflictDoNothing().returning())[0]
    if (!inserted) return
    if (correct) {
      const stats = safeStats(match)
      stats[userId] = {
        correctAnswers: stats[userId].correctAnswers + 1,
        totalCorrectAnswerTimeMs: stats[userId].totalCorrectAnswerTimeMs + elapsedMs,
      }
      await tx.update(territoryMatches).set({ playerStats: stats, updatedAt: new Date() }).where(eq(territoryMatches.id, match.id))
    }
    await tx.update(friendsRooms).set({ version: sql`${friendsRooms.version} + 1`, updatedAt: new Date() }).where(eq(friendsRooms.id, roomId))
    const answerCount = (await tx.select({ id: territoryAnswers.id }).from(territoryAnswers).where(eq(territoryAnswers.duelId, duel.id))).length
    if (answerCount >= 2) await resolveDuel(tx, match, duel, new Date())
  })
}

export const submitTerritoryCapture = async (
  db: Database,
  roomId: string,
  userId: string,
  cellId: string,
  idempotencyKey: string,
) => {
  await advanceTerritoryClock(db, roomId)
  await db.transaction(async (tx) => {
    const { match } = await lockRoomAndMatch(tx, roomId)
    if (!match) throw new ApiError(409, 'TERRITORY_MATCH_NOT_STARTED', 'Матч ещё не начался')
    await assertActiveMember(tx, roomId, userId)
    const duel = (await tx.select().from(territoryDuels).where(and(
      eq(territoryDuels.matchId, match.id),
      eq(territoryDuels.position, match.currentDuel),
    )).for('update').limit(1))[0]
    if (!duel) throw new ApiError(500, 'TERRITORY_DUEL_NOT_FOUND', 'Текущая дуэль не найдена')
    if (duel.captureIdempotencyKey === idempotencyKey) return
    if (match.phase !== 'capture' || !match.phaseEndsAt || match.phaseEndsAt.getTime() <= Date.now()) {
      throw new ApiError(409, 'TERRITORY_NOT_ACCEPTING_CAPTURE', 'Выбор территории уже закрыт')
    }
    if (duel.winnerUserId !== userId) throw new ApiError(403, 'TERRITORY_CAPTURE_FORBIDDEN', 'Территорию выбирает победитель дуэли')
    await capture(tx, match, duel, cellId, new Date(), idempotencyKey)
  })
}

export const voteTerritoryRematch = async (db: Database, roomId: string, userId: string, idempotencyKey: string) => {
  await db.transaction(async (tx) => {
    const { room, match } = await lockRoomAndMatch(tx, roomId)
    if (!match || match.phase !== 'finished') throw new ApiError(409, 'TERRITORY_MATCH_NOT_FINISHED', 'Реванш доступен после завершения матча')
    await assertActiveMember(tx, roomId, userId)
    const replay = (await tx.select().from(territoryRematchVotes).where(and(
      eq(territoryRematchVotes.matchId, match.id),
      eq(territoryRematchVotes.userId, userId),
    )).limit(1))[0]
    if (!replay) {
      await tx.insert(territoryRematchVotes).values({ matchId: match.id, userId, idempotencyKey }).onConflictDoNothing()
      await tx.update(friendsRooms).set({ version: sql`${friendsRooms.version} + 1`, updatedAt: new Date() }).where(eq(friendsRooms.id, roomId))
    }
    const votes = await tx.select({ userId: territoryRematchVotes.userId }).from(territoryRematchVotes).where(eq(territoryRematchVotes.matchId, match.id))
    if (votes.length < 2) return
    const members = await tx.select({ userId: friendsRoomMembers.userId }).from(friendsRoomMembers).where(and(
      eq(friendsRoomMembers.roomId, roomId),
      isNull(friendsRoomMembers.leftAt),
    ))
    const expected = new Set([match.playerOneUserId, match.playerTwoUserId])
    if (members.length !== 2 || members.some((member) => !expected.has(member.userId))) {
      throw new ApiError(409, 'TERRITORY_REMATCH_PLAYERS_CHANGED', 'Для реванша нужны оба исходных игрока')
    }
    await createMatch(tx, room, [match.playerTwoUserId, match.playerOneUserId], match.matchNumber + 1, new Date())
  })
}

const publicProvenance = (value: TerritoryQuestionProvenance) => ({
  dataset: value.dataset,
  sourceUrl: value.sourceUrl ?? null,
  license: value.license,
  licenseUrl: value.licenseUrl ?? null,
  attribution: value.attribution ?? null,
})

export const getTerritoryPublicSnapshot = async (
  db: Database,
  roomId: string,
  currentUserId: string,
): Promise<TerritoryPublicSnapshot | null> => {
  const match = await latestMatch(db, roomId)
  if (!match) return null
  const duel = match.currentDuel > 0 ? await currentDuel(db, match) : null
  const [members, answers, votes] = await Promise.all([
    db.select({ userId: friendsRoomMembers.userId, displayName: friendsRoomMembers.displayNameSnapshot })
      .from(friendsRoomMembers).where(eq(friendsRoomMembers.roomId, roomId)),
    duel ? db.select().from(territoryAnswers).where(eq(territoryAnswers.duelId, duel.id)) : Promise.resolve([]),
    match.phase === 'finished'
      ? db.select({ userId: territoryRematchVotes.userId }).from(territoryRematchVotes).where(eq(territoryRematchVotes.matchId, match.id))
      : Promise.resolve([]),
  ])
  const memberNames = new Map(members.map((member) => [member.userId, member.displayName]))
  const answersByUser = new Map(answers.map((answer) => [answer.userId, answer]))
  const stats = safeStats(match)
  const playerIds: [string, string] = [match.playerOneUserId, match.playerTwoUserId]
  const players = playerIds.map((userId, index) => ({
    userId,
    displayName: memberNames.get(userId) ?? 'Игрок',
    baseCellId: match.mapSnapshot.baseCellIds[index],
    territoryCount: territoryCountForPlayer(match.mapSnapshot, match.ownership, userId),
    territoryValueTotal: territoryValueForPlayer(match.mapSnapshot, match.ownership, userId),
    correctAnswers: stats[userId].correctAnswers,
    totalCorrectAnswerTimeMs: stats[userId].totalCorrectAnswerTimeMs,
  })) as TerritoryPublicSnapshot['players']
  const now = new Date()
  const common = {
    matchId: match.id,
    matchNumber: match.matchNumber,
    rulesVersion: match.rulesVersion,
    serverTime: now.toISOString(),
    phaseStartedAt: match.phaseStartedAt.toISOString(),
    duelNumber: match.currentDuel,
    maxDuels: TERRITORY_MAX_DUELS,
    map: match.mapSnapshot,
    ownership: match.ownership,
    siege: safeSiegeState(match),
    players,
  }
  const questionFields = duel && duel.startedAt ? {
    duelId: duel.id,
    position: duel.position,
    duelKind: duel.kind as TerritoryDuelKind,
    answerRule: (territoryComparableOptionValues(duel.options) ? 'numeric_closest' : 'exact') as TerritoryAnswerRule,
    prompt: duel.prompt,
    category: { id: duel.categoryId, label: duel.categoryLabel },
    difficulty: duel.difficulty as TerritoryDifficulty,
    options: duel.options,
    startedAt: duel.startedAt.toISOString(),
  } : null
  const revealedAnswers = playerIds.map((userId) => {
    const answer = answersByUser.get(userId)
    return {
      userId,
      optionId: answer?.optionId ?? null,
      correct: answer?.isCorrect ?? false,
      distance: answer ? territoryAnswerDistance(duel?.options ?? [], duel?.correctOptionId ?? '', answer.optionId) : null,
      elapsedMs: answer?.elapsedMs ?? null,
    }
  }) as [
    { userId: string; optionId: string | null; correct: boolean; distance: number | null; elapsedMs: number | null },
    { userId: string; optionId: string | null; correct: boolean; distance: number | null; elapsedMs: number | null },
  ]
  const reveal = duel?.resolvedAt && duel.result && questionFields ? {
    ...questionFields,
    endedAt: duel.resolvedAt.toISOString(),
    correctOptionId: duel.correctOptionId,
    explanation: duel.explanation,
    provenance: publicProvenance(duel.provenance),
    answers: revealedAnswers,
    result: duel.result as TerritoryDuelResultReason,
    winnerUserId: duel.winnerUserId,
    capturedCellId: duel.capturedCellId,
    previousOwnerUserId: duel.previousOwnerUserId,
  } : null

  if (match.phase === 'countdown') return {
    ...common,
    phase: 'countdown',
    phaseEndsAt: match.phaseEndsAt!.toISOString(),
    question: null,
    reveal: null,
    capture: null,
    winnerUserId: null,
    finishReason: null,
    rematchReadyUserIds: [],
  }
  if (match.phase === 'question') {
    if (!questionFields || !duel?.endsAt) throw new ApiError(500, 'TERRITORY_QUESTION_SNAPSHOT_INVALID', 'Публичный вопрос повреждён')
    const ownAnswer = answersByUser.get(currentUserId)
    return {
      ...common,
      phase: 'question',
      phaseEndsAt: match.phaseEndsAt!.toISOString(),
      question: {
        ...questionFields,
        endsAt: duel.endsAt.toISOString(),
        ownOptionId: ownAnswer?.optionId ?? null,
        opponentAnswered: answers.some((answer) => answer.userId !== currentUserId),
      },
      reveal: null,
      capture: null,
      winnerUserId: null,
      finishReason: null,
      rematchReadyUserIds: [],
    }
  }
  if (match.phase === 'reveal') {
    if (!reveal) throw new ApiError(500, 'TERRITORY_REVEAL_SNAPSHOT_INVALID', 'Результат дуэли повреждён')
    return {
      ...common,
      phase: 'reveal',
      phaseEndsAt: match.phaseEndsAt!.toISOString(),
      question: null,
      reveal,
      capture: null,
      winnerUserId: null,
      finishReason: null,
      rematchReadyUserIds: [],
    }
  }
  if (match.phase === 'capture') {
    if (!reveal?.winnerUserId) throw new ApiError(500, 'TERRITORY_CAPTURE_SNAPSHOT_INVALID', 'Ход захвата повреждён')
    return {
      ...common,
      phase: 'capture',
      phaseEndsAt: match.phaseEndsAt!.toISOString(),
      question: null,
      reveal,
      capture: {
        actorUserId: reveal.winnerUserId,
        legalCellIds: legalTerritoryCaptures(match.mapSnapshot, match.ownership, reveal.winnerUserId),
      },
      winnerUserId: null,
      finishReason: null,
      rematchReadyUserIds: [],
    }
  }
  return {
    ...common,
    phase: 'finished',
    phaseEndsAt: null,
    question: null,
    reveal,
    capture: null,
    winnerUserId: match.winnerUserId,
    finishReason: match.finishReason as TerritoryFinishReason,
    rematchReadyUserIds: votes.map((vote) => vote.userId),
  }
}

export const leaveTerritoryMatch = async (db: Database, roomId: string, userId: string) => {
  return db.transaction(async (tx) => {
    const { room, match } = await lockRoomAndMatch(tx, roomId)
    const member = (await tx.select().from(friendsRoomMembers).where(and(
      eq(friendsRoomMembers.roomId, roomId),
      eq(friendsRoomMembers.userId, userId),
    )).for('update').limit(1))[0]
    if (!member || member.leftAt) return true
    if (room.phase === 'lobby') return false
    const now = new Date()
    await tx.update(friendsRoomMembers).set({ leftAt: now, lastSeenAt: now }).where(and(
      eq(friendsRoomMembers.roomId, roomId),
      eq(friendsRoomMembers.userId, userId),
    ))
    const otherUserId = match
      ? match.playerOneUserId === userId ? match.playerTwoUserId : match.playerOneUserId
      : null
    if (match && match.phase !== 'finished') {
      await tx.update(territoryMatches).set({
        phase: 'finished',
        phaseStartedAt: now,
        phaseEndsAt: null,
        winnerUserId: otherUserId,
        finishReason: 'forfeit',
        updatedAt: now,
      }).where(eq(territoryMatches.id, match.id))
    }
    const remaining = await tx.select({ userId: friendsRoomMembers.userId }).from(friendsRoomMembers).where(and(
      eq(friendsRoomMembers.roomId, roomId),
      isNull(friendsRoomMembers.leftAt),
    ))
    await tx.update(friendsRooms).set({
      phase: 'finished',
      phaseStartedAt: now,
      phaseEndsAt: null,
      ...(remaining.length ? {} : { closedAt: now }),
      version: sql`${friendsRooms.version} + 1`,
      updatedAt: now,
    }).where(eq(friendsRooms.id, roomId))
    return true
  })
}
