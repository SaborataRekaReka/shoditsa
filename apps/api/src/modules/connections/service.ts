import { and, asc, eq, isNull } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import {
  CONNECTIONS_COLORS,
  GAME_MODE_MANIFEST,
  type ConnectionsColor,
  type ConnectionsGameState,
  type ConnectionsGuessSnapshot,
  type ConnectionsHintSnapshot,
  type ConnectionsRoundPayload,
  type ConnectionsSolvedGroupSnapshot,
  type GameSessionSnapshot,
} from '@shoditsa/contracts'
import {
  connectionsGuesses,
  connectionsHintChoices,
  connectionsSchedule,
  connectionsSessionState,
  contentItemVersions,
  dailyChallenges,
  gameSessions,
  type Database,
} from '@shoditsa/database'
import {
  buildConnectionsRuntimeRound,
  buildConnectionsShareRows,
  canonicalGuessSignature,
  evaluateConnectionsGuess,
  remainingTileIds,
  shouldAutoSolveFinalGroup,
} from '@shoditsa/game-core'
import { ApiError } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import { canStartArchiveSession } from '../archive/access.js'
import { loadAssignedEconomyRules } from '../economy/rules.js'
import { completeGame } from '../stats/rewards.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReadDatabase = Transaction | Database
type SessionRow = typeof gameSessions.$inferSelect

const assertConnectionsSession = (session: SessionRow | undefined) => {
  if (!session) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  if (session.mode !== 'connections' || GAME_MODE_MANIFEST.connections.engine !== 'connections_grid') {
    throw new ApiError(422, 'GAME_ACTION_ENGINE_MISMATCH', 'Для этой игры действие недоступно')
  }
  return session
}

const loadRuntimeRound = async (db: ReadDatabase, session: SessionRow) => {
  const version = (await db.select({
    mode: contentItemVersions.mode,
    payload: contentItemVersions.payload,
  }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1))[0]
  if (!version || version.mode !== 'connections') {
    throw new ApiError(503, 'CONNECTIONS_CONTENT_INVALID', 'Версия раунда недоступна')
  }
  try {
    return buildConnectionsRuntimeRound(version.payload as ConnectionsRoundPayload)
  } catch {
    throw new ApiError(503, 'CONNECTIONS_CONTENT_INVALID', 'Раунд не прошёл проверку')
  }
}

const stateStatus = (session: SessionRow): ConnectionsGameState['status'] => (
  session.status === 'won' ? 'won' : session.status === 'lost' || session.status === 'expired' ? 'lost' : 'playing'
)

export const buildConnectionsSessionSnapshot = async (
  db: ReadDatabase,
  session: SessionRow,
  hintsEnabled = true,
): Promise<GameSessionSnapshot> => {
  const runtime = await loadRuntimeRound(db, session)
  const state = (await db.select().from(connectionsSessionState)
    .where(eq(connectionsSessionState.sessionId, session.id)).limit(1))[0]
  if (!state) throw new ApiError(503, 'CONNECTIONS_STATE_MISSING', 'Состояние игры недоступно')
  const [guessRows, hintRows] = await Promise.all([
    db.select().from(connectionsGuesses).where(eq(connectionsGuesses.sessionId, session.id)).orderBy(asc(connectionsGuesses.position)),
    db.select().from(connectionsHintChoices).where(eq(connectionsHintChoices.sessionId, session.id)).orderBy(asc(connectionsHintChoices.checkpoint)),
  ])
  const solvedColors = state.solvedColors as ConnectionsColor[]
  const solvedSet = new Set(solvedColors)
  const guessedCorrectColors = new Set(guessRows.flatMap((guess) => guess.matchedColor ? [guess.matchedColor] : []))
  const terminal = session.status === 'won' || session.status === 'lost' || session.status === 'expired'
  const tileById = new Map(runtime.tiles.map((tile) => [tile.id, tile]))
  const solvedGroups: ConnectionsSolvedGroupSnapshot[] = runtime.groups
    .filter((group) => solvedSet.has(group.color) || terminal)
    .map((group) => ({
      color: group.color,
      title: group.title,
      tiles: group.tileIds.map((tileId) => tileById.get(tileId)!),
      ...(session.status === 'won' && solvedSet.has(group.color) && !guessedCorrectColors.has(group.color) ? { autoSolved: true } : {}),
    }))

  const shareRows = terminal
    ? buildConnectionsShareRows(guessRows.map((guess) => ({
        tileIds: guess.tileIds as [string, string, string, string],
        result: guess.result,
      })), runtime)
    : []
  const guesses: ConnectionsGuessSnapshot[] = guessRows.map((guess, index) => ({
    position: guess.position,
    tileIds: guess.tileIds as [string, string, string, string],
    result: guess.result,
    ...(guess.matchedColor ? { matchedColor: guess.matchedColor } : {}),
    ...(terminal ? { colorRow: shareRows[index] } : {}),
  }))
  const hints: ConnectionsHintSnapshot[] = hintRows.map((hint) => {
    const snapshot = hint.responseSnapshot as Partial<ConnectionsHintSnapshot> & {
      hint?: Partial<ConnectionsHintSnapshot>
    }
    return {
      checkpoint: hint.checkpoint as 1 | 3,
      text: String(snapshot.hint?.text ?? snapshot.text ?? ''),
    }
  })
  const usedCheckpoints = new Set(hints.map((hint) => hint.checkpoint))
  const hintAvailableAt = !hintsEnabled
    ? null
    : state.mistakesUsed >= 1 && !usedCheckpoints.has(1)
      ? 1
      : state.mistakesUsed >= 3 && !usedCheckpoints.has(3)
        ? 3
        : null
  const connections: ConnectionsGameState = {
    tiles: runtime.tiles,
    solvedGroups,
    guesses,
    hints,
    mistakesUsed: state.mistakesUsed,
    mistakesRemaining: Math.max(0, 4 - state.mistakesUsed),
    maxMistakes: 4,
    maxGuesses: 6,
    hintAvailableAt,
    status: stateStatus(session),
  }
  return {
    engine: 'connections_grid',
    rulesVersion: session.rulesVersion,
    id: session.id,
    kind: session.kind as GameSessionSnapshot['kind'],
    packId: null,
    packPosition: null,
    mode: 'connections',
    variantKey: null,
    period: 'all',
    difficulty: runtime.difficulty,
    puzzleDate: session.puzzleDate,
    status: session.status as GameSessionSnapshot['status'],
    completionType: session.completionType as GameSessionSnapshot['completionType'],
    finalChoice: null,
    attemptsCount: guessRows.length,
    attemptsRemaining: Math.max(0, 6 - guessRows.length),
    maxAttempts: 6,
    attempts: [],
    hintCheckpoints: [],
    hintChoices: [],
    hintOptions: [],
    progressiveHints: [],
    promoPrompt: null,
    diagnosisVignette: null,
    serverTime: new Date().toISOString(),
    connections,
  }
}

export const startConnectionsSession = async (
  db: Database,
  userId: string,
  input: { kind: 'daily' | 'archive'; archiveDate?: string | null },
  authSessionId: string | null,
  role: 'player' | 'admin',
  config: AppConfig,
) => {
  const rules = await loadAssignedEconomyRules(db, userId, role, config.economy.v4RolloutPercent)
  return db.transaction(async (tx) => {
  if (!config.connectionsEnabled && role !== 'admin') {
    throw new ApiError(404, 'CONNECTIONS_DISABLED', 'Режим пока недоступен')
  }
  const today = getMoscowDate()
  const puzzleDate = input.kind === 'daily' ? today : input.archiveDate
  if (!puzzleDate) throw new ApiError(422, 'ARCHIVE_DATE_REQUIRED', 'Для архивной игры нужна дата')
  if (puzzleDate > today) throw new ApiError(422, 'ARCHIVE_DATE_IN_FUTURE', 'Архивная дата не может быть в будущем')
  if (config.connectionsLaunchDate && puzzleDate < config.connectionsLaunchDate && role !== 'admin') {
    throw new ApiError(404, 'CONNECTIONS_NOT_LAUNCHED', 'Режим пока недоступен')
  }
  if (input.kind === 'archive') {
    const access = await canStartArchiveSession(tx as unknown as Database, userId, puzzleDate, config, new Date(), {
      mode: 'connections',
      period: 'all',
      difficulty: null,
    })
    if (access.source === 'before-launch') {
      throw new ApiError(422, 'ARCHIVE_DATE_BEFORE_LAUNCH', 'Эта дата была до запуска архива')
    }
    if (!access.allowed) throw new ApiError(403, 'ARCHIVE_CLUB_REQUIRED', 'Эта дата доступна участникам клуба')
  }
  const schedule = (await tx.select({
    itemVersionId: connectionsSchedule.itemVersionId,
    revisionId: contentItemVersions.revisionId,
    mode: contentItemVersions.mode,
    payload: contentItemVersions.payload,
  }).from(connectionsSchedule)
    .innerJoin(contentItemVersions, eq(contentItemVersions.id, connectionsSchedule.itemVersionId))
    .where(and(eq(connectionsSchedule.puzzleDate, puzzleDate), isNull(connectionsSchedule.cancelledAt)))
    .limit(1))[0]
  if (!schedule) throw new ApiError(503, 'CONNECTIONS_PUZZLE_NOT_SCHEDULED', 'Раунд готовится')
  if (schedule.mode !== 'connections') throw new ApiError(503, 'CONNECTIONS_CONTENT_INVALID', 'В расписании указана неверная версия')
  const payload = schedule.payload as ConnectionsRoundPayload
  const runtime = buildConnectionsRuntimeRound(payload)
  const challengeKey = `${puzzleDate}|connections|all|-|0|v1`
  let challenge = (await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1))[0]
  if (!challenge) {
    challenge = (await tx.insert(dailyChallenges).values({
      challengeKey,
      puzzleDate,
      mode: 'connections',
      period: 'all',
      difficulty: runtime.difficulty,
      variantKey: '-',
      revisionId: schedule.revisionId,
      answerItemVersionId: schedule.itemVersionId,
      globalSalt: 0,
      algorithmVersion: 1,
    }).onConflictDoNothing().returning())[0]
      ?? (await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1))[0]
  }
  const inserted = await tx.insert(gameSessions).values({
    userId,
    authSessionId,
    challengeId: challenge.id,
    kind: input.kind,
    mode: 'connections',
    period: 'all',
    difficulty: runtime.difficulty,
    puzzleDate,
    revisionId: schedule.revisionId,
    answerItemVersionId: schedule.itemVersionId,
    rulesVersion: rules.version,
  }).onConflictDoNothing().returning()
  let session = inserted[0] ?? (await tx.select().from(gameSessions)
    .where(and(eq(gameSessions.userId, userId), eq(gameSessions.challengeId, challenge.id))).limit(1))[0]
  if (session.status === 'playing' && session.rulesVersion !== rules.version) {
    session = (await tx.update(gameSessions)
      .set({ rulesVersion: rules.version, updatedAt: new Date() })
      .where(eq(gameSessions.id, session.id))
      .returning())[0] ?? session
  }
  await tx.insert(connectionsSessionState).values({ sessionId: session.id }).onConflictDoNothing()
  return buildConnectionsSessionSnapshot(tx, session, config.connectionsHintsEnabled)
  })
}

export const getConnectionsSession = async (
  db: Database,
  userId: string,
  sessionId: string,
  config: AppConfig,
) => {
  const session = assertConnectionsSession((await db.select().from(gameSessions)
    .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId))).limit(1))[0])
  return buildConnectionsSessionSnapshot(db, session, config.connectionsHintsEnabled)
}

export const submitConnectionsGuess = async (
  db: Database,
  userId: string,
  role: 'player' | 'admin',
  sessionId: string,
  tileIds: [string, string, string, string],
  idempotencyKey: string,
  config: AppConfig,
) => {
  const rules = await loadAssignedEconomyRules(db, userId, role, config.economy.v4RolloutPercent)
  return db.transaction(async (tx) => {
  const replay = (await tx.select({ response: connectionsGuesses.responseSnapshot }).from(connectionsGuesses)
    .innerJoin(gameSessions, eq(gameSessions.id, connectionsGuesses.sessionId))
    .where(and(
      eq(connectionsGuesses.sessionId, sessionId),
      eq(connectionsGuesses.idempotencyKey, idempotencyKey),
      eq(gameSessions.userId, userId),
    )).limit(1))[0]
  if (replay) return replay.response
  let session = assertConnectionsSession((await tx.select().from(gameSessions)
    .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId))).for('update').limit(1))[0])
  const state = (await tx.select().from(connectionsSessionState)
    .where(eq(connectionsSessionState.sessionId, sessionId)).for('update').limit(1))[0]
  if (!state) throw new ApiError(503, 'CONNECTIONS_STATE_MISSING', 'Состояние игры недоступно')
  if (session.status !== 'playing') throw new ApiError(409, 'CONNECTIONS_SESSION_FINISHED', 'Игра уже завершена')
  if (session.rulesVersion !== rules.version) {
    session = (await tx.update(gameSessions)
      .set({ rulesVersion: rules.version, updatedAt: new Date() })
      .where(eq(gameSessions.id, session.id))
      .returning())[0] ?? session
  }
  if (tileIds.length !== 4 || new Set(tileIds).size !== 4) {
    throw new ApiError(422, 'CONNECTIONS_SELECTION_SIZE_INVALID', 'Выберите четыре разные карточки')
  }
  const runtime = await loadRuntimeRound(tx, session)
  const known = new Set(runtime.tiles.map((tile) => tile.id))
  if (tileIds.some((tileId) => !known.has(tileId))) {
    throw new ApiError(422, 'CONNECTIONS_TILE_UNKNOWN', 'Карточка не относится к этому раунду')
  }
  const solvedColors = state.solvedColors as ConnectionsColor[]
  const remaining = new Set(remainingTileIds(runtime, solvedColors))
  if (tileIds.some((tileId) => !remaining.has(tileId))) {
    throw new ApiError(409, 'CONNECTIONS_TILE_ALREADY_SOLVED', 'Эта карточка уже раскрыта')
  }
  const signature = canonicalGuessSignature(tileIds)
  const duplicate = (await tx.select({ id: connectionsGuesses.id }).from(connectionsGuesses)
    .where(and(eq(connectionsGuesses.sessionId, sessionId), eq(connectionsGuesses.signature, signature))).limit(1))[0]
  if (duplicate) throw new ApiError(409, 'CONNECTIONS_GUESS_ALREADY_SUBMITTED', 'Эта четвёрка уже проверялась')
  const position = session.attemptsCount + 1
  if (position > 6) throw new ApiError(409, 'CONNECTIONS_GUESS_LIMIT_REACHED', 'Лимит проверок исчерпан')

  const evaluated = evaluateConnectionsGuess(runtime, solvedColors, tileIds)
  const nextSolved = [...solvedColors]
  let mistakesUsed = state.mistakesUsed
  if (evaluated.result === 'correct' && evaluated.matchedColor) nextSolved.push(evaluated.matchedColor)
  else mistakesUsed += 1
  if (shouldAutoSolveFinalGroup(nextSolved)) {
    const finalColor = CONNECTIONS_COLORS.find((color) => !nextSolved.includes(color))
    if (finalColor) nextSolved.push(finalColor)
  }
  const status = nextSolved.length === 4 ? 'won' : mistakesUsed >= 4 ? 'lost' : 'playing'
  const completionType = status === 'won' ? 'direct_win' : status === 'lost' ? 'attempts_exhausted' : null
  let reward: Awaited<ReturnType<typeof completeGame>> = null
  if (status !== 'playing') {
    reward = await completeGame(tx, {
      sessionId,
      userId,
      kind: session.kind,
      mode: 'connections',
      difficulty: runtime.difficulty,
      puzzleDate: session.puzzleDate,
      won: status === 'won',
      attemptsCount: Math.max(1, mistakesUsed + 1),
      distributionIndex: mistakesUsed,
      rulesVersion: session.rulesVersion,
      completionType,
    })
  }
  await tx.update(connectionsSessionState).set({
    solvedColors: nextSolved,
    mistakesUsed,
    updatedAt: new Date(),
  }).where(eq(connectionsSessionState.sessionId, sessionId))
  await tx.update(gameSessions).set({
    attemptsCount: position,
    status,
    completionType,
    completedAt: status === 'playing' ? null : new Date(),
    updatedAt: new Date(),
    rewardLedgerId: reward?.ledgerId ?? null,
    rulesVersion: rules.version,
  }).where(eq(gameSessions.id, sessionId))
  const insertedGuess = (await tx.insert(connectionsGuesses).values({
    sessionId,
    position,
    tileIds,
    signature,
    result: evaluated.result,
    matchedColor: evaluated.matchedColor,
    mistakesAfter: mistakesUsed,
    responseSnapshot: {},
    idempotencyKey,
  }).returning({ id: connectionsGuesses.id }))[0]
  const updatedSession = { ...session, attemptsCount: position, status, completionType } as SessionRow
  const snapshot = await buildConnectionsSessionSnapshot(tx, updatedSession, config.connectionsHintsEnabled)
  const response = { result: evaluated.result, session: snapshot, ...(reward ? { reward } : {}) }
  await tx.update(connectionsGuesses).set({ responseSnapshot: response }).where(eq(connectionsGuesses.id, insertedGuess.id))
  return response
  })
}

export const chooseConnectionsHint = async (
  db: Database,
  userId: string,
  sessionId: string,
  checkpoint: 1 | 3,
  idempotencyKey: string,
  config: AppConfig,
) => db.transaction(async (tx) => {
  if (!config.connectionsHintsEnabled) throw new ApiError(404, 'CONNECTIONS_HINTS_DISABLED', 'Подсказки отключены')
  const replay = (await tx.select({ response: connectionsHintChoices.responseSnapshot }).from(connectionsHintChoices)
    .innerJoin(gameSessions, eq(gameSessions.id, connectionsHintChoices.sessionId))
    .where(and(
      eq(connectionsHintChoices.sessionId, sessionId),
      eq(connectionsHintChoices.idempotencyKey, idempotencyKey),
      eq(gameSessions.userId, userId),
    )).limit(1))[0]
  if (replay) return replay.response
  const session = assertConnectionsSession((await tx.select().from(gameSessions)
    .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId))).for('update').limit(1))[0])
  const state = (await tx.select().from(connectionsSessionState)
    .where(eq(connectionsSessionState.sessionId, sessionId)).for('update').limit(1))[0]
  if (!state) throw new ApiError(503, 'CONNECTIONS_STATE_MISSING', 'Состояние игры недоступно')
  if (session.status !== 'playing') throw new ApiError(409, 'CONNECTIONS_SESSION_FINISHED', 'Игра уже завершена')
  if (state.mistakesUsed < checkpoint) throw new ApiError(409, 'CONNECTIONS_HINT_LOCKED', 'Подсказка пока недоступна')
  const existingCheckpoint = (await tx.select({ id: connectionsHintChoices.id }).from(connectionsHintChoices)
    .where(and(eq(connectionsHintChoices.sessionId, sessionId), eq(connectionsHintChoices.checkpoint, checkpoint))).limit(1))[0]
  if (existingCheckpoint) throw new ApiError(409, 'CONNECTIONS_HINT_ALREADY_USED', 'Эта подсказка уже использована')
  const runtime = await loadRuntimeRound(tx, session)
  const usedColors = new Set((await tx.select({ color: connectionsHintChoices.groupColor }).from(connectionsHintChoices)
    .where(eq(connectionsHintChoices.sessionId, sessionId))).map((row) => row.color))
  const solved = new Set(state.solvedColors as ConnectionsColor[])
  const group = runtime.groups.find((candidate) => !solved.has(candidate.color) && !usedColors.has(candidate.color) && candidate.hint)
  if (!group?.hint) throw new ApiError(409, 'CONNECTIONS_HINT_UNAVAILABLE', 'Для оставшихся групп нет подсказки')
  const hint: ConnectionsHintSnapshot = { checkpoint, text: group.hint }
  const inserted = (await tx.insert(connectionsHintChoices).values({
    sessionId,
    checkpoint,
    groupColor: group.color,
    responseSnapshot: hint,
    idempotencyKey,
  }).returning({ id: connectionsHintChoices.id }))[0]
  await tx.update(connectionsSessionState).set({ hintsUsed: state.hintsUsed + 1, updatedAt: new Date() })
    .where(eq(connectionsSessionState.sessionId, sessionId))
  const snapshot = await buildConnectionsSessionSnapshot(tx, session, config.connectionsHintsEnabled)
  const response = { hint, session: snapshot }
  await tx.update(connectionsHintChoices).set({ responseSnapshot: response }).where(eq(connectionsHintChoices.id, inserted.id))
  return response
})
