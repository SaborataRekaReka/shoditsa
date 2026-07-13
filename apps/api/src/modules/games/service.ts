import { and, asc, eq, sql } from 'drizzle-orm'
import type { ApiDifficultyKey, PeriodKey, TitleItem, TitleMode } from '@shoditsa/contracts'
import {
  appSettings, contentItemVersions, contentRevisionModes, contentRevisions, dailyChallenges,
  diagnosisVignettes, gameAttempts, gameHintChoices, gameSessions, type Database,
  periodEntitlements,
} from '@shoditsa/database'
import { compareTitles, dailyTitle, musicDifficultyPool, pickDailyVignette, poolFor } from '@shoditsa/game-core'
import { ApiError } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import { completeGame } from '../stats/rewards.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReadDatabase = Pick<Database, 'select'>
type SessionRow = typeof gameSessions.$inferSelect

const legacyMediaUrl = (value: string | null | undefined, mode: TitleMode, itemId: string) => {
  if (!value) return null
  if (/^\/?media\//.test(value) || /^https?:\/\//.test(value)) return value
  const normalized = value.replace(/^\.\//, '/')
  const people = normalized.match(/^\/data\/libraries\/people\/img\/(.+)$/)
  if (people) return `/media/people/${people[1]}`
  const content = normalized.match(/^\/data\/libraries\/[^/]+\/img\/(.+)$/)
  return content ? `/media/content/${mode}/${content[1]}` : value
}

export const publicCard = (item: TitleItem) => ({
  id: item.id, mode: item.mode, titleRu: item.titleRu, titleOriginal: item.titleOriginal ?? '',
  year: item.year ?? null, genres: item.genres ?? [], posterUrl: legacyMediaUrl(item.posterUrl, item.mode, item.id),
})

const progressiveMusicHints = (answer: TitleItem, attempts: number) => {
  const result: Array<{ key: string; value: unknown }> = []
  if (attempts >= 2 && answer.topTracks?.[0]) result.push({ key: 'top_track', value: answer.topTracks[0].title })
  if (attempts >= 4 && answer.topAlbums?.[0]) result.push({ key: 'top_album', value: answer.topAlbums[0].title })
  if (attempts >= 6 && answer.similarArtists?.length) result.push({ key: 'similar_artists', value: answer.similarArtists.slice(0, 3).map((entry) => entry.name) })
  if (attempts >= 8 && answer.year) result.push({ key: 'career_start', value: answer.year })
  return result
}

export const answerPool = async (tx: ReadDatabase, revisionId: string, mode: TitleMode, period: PeriodKey, difficulty: ApiDifficultyKey | null) => {
  const rows = await tx.select({ id: contentItemVersions.id, payload: contentItemVersions.payload })
    .from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, revisionId), eq(contentItemVersions.mode, mode), eq(contentItemVersions.allowedInGame, true),
    )).orderBy(asc(contentItemVersions.sortOrder))
  let items = poolFor(rows.map((row) => row.payload as TitleItem), mode, period)
  if (mode === 'music') items = musicDifficultyPool(items, difficulty ?? 'medium')
  const byItemId = new Map(rows.map((row) => [(row.payload as TitleItem).id, row.id]))
  return { items, byItemId }
}

export const activeRevision = async (tx: ReadDatabase) => {
  const rows = await tx.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!rows[0]) throw new ApiError(503, 'CONTENT_NOT_READY', 'Активная ревизия контента не настроена')
  return rows[0].id
}

const dailySalt = async (tx: Transaction) => {
  const rows = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'daily_global_salt')).limit(1)
  return Number(rows[0]?.value ?? 0) || 0
}

export const startGame = async (db: Database, userId: string, input: {
  kind: 'daily' | 'archive'; mode: TitleMode; period?: PeriodKey; difficulty?: ApiDifficultyKey | null; archiveDate?: string | null;
}, authSessionId: string | null = null) => db.transaction(async (tx) => {
  const period = ['game', 'music', 'diagnosis'].includes(input.mode) ? 'all' : input.period ?? 'all'
  const difficulty = input.mode === 'music' ? input.difficulty ?? 'medium' : null
  if (period !== 'all' && ['movie', 'series', 'anime'].includes(input.mode)) {
    const entitlement = await tx.select({ userId: periodEntitlements.userId }).from(periodEntitlements).where(and(
      eq(periodEntitlements.userId, userId), eq(periodEntitlements.mode, input.mode), eq(periodEntitlements.period, period),
    )).limit(1)
    if (!entitlement[0]) throw new ApiError(403, 'PERIOD_LOCKED', 'Сначала разблокируйте этот период')
  }
  const today = getMoscowDate()
  const puzzleDate = input.kind === 'daily' ? today : input.archiveDate
  if (!puzzleDate) throw new ApiError(422, 'ARCHIVE_DATE_REQUIRED', 'Для архивной игры нужна дата')
  if (puzzleDate > today) throw new ApiError(422, 'ARCHIVE_DATE_IN_FUTURE', 'Архивная дата не может быть в будущем')
  const revisionId = await activeRevision(tx)
  const salt = await dailySalt(tx)
  const variant = difficulty ?? '-'
  const challengeKey = `${puzzleDate}|${input.mode}|${period}|${variant}|${salt}|v1`

  let challenge = await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1)
  if (!challenge[0]) {
    const pool = await answerPool(tx, revisionId, input.mode, period, difficulty)
    const answer = dailyTitle(pool.items, input.mode, period, puzzleDate, salt, difficulty ?? '')
    if (!answer) throw new ApiError(503, 'CONTENT_POOL_EMPTY', 'Для выбранного режима нет доступных вариантов')
    const inserted = await tx.insert(dailyChallenges).values({
      challengeKey, puzzleDate, mode: input.mode, period, difficulty, variantKey: variant,
      revisionId, answerItemVersionId: pool.byItemId.get(answer.id)!, globalSalt: salt, algorithmVersion: 1,
    }).onConflictDoNothing().returning()
    challenge = inserted[0] ? inserted : await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1)
  }
  const insertedSession = await tx.insert(gameSessions).values({
    userId, authSessionId, challengeId: challenge[0].id, kind: input.kind, mode: input.mode, period, difficulty,
    puzzleDate, revisionId: challenge[0].revisionId, answerItemVersionId: challenge[0].answerItemVersionId, rulesVersion: 1,
  }).onConflictDoNothing().returning()
  const session = insertedSession[0] ?? (await tx.select().from(gameSessions).where(and(eq(gameSessions.userId, userId), eq(gameSessions.challengeId, challenge[0].id))).limit(1))[0]
  return buildSessionSnapshot(tx, session)
})

export const buildSessionSnapshot = async (tx: Transaction | Database, session: SessionRow) => {
  const attempts = await tx.select({
    position: gameAttempts.position, hints: gameAttempts.hintsSnapshot, item: contentItemVersions.payload,
  }).from(gameAttempts).innerJoin(contentItemVersions, eq(contentItemVersions.id, gameAttempts.guessedItemVersionId))
    .where(eq(gameAttempts.sessionId, session.id)).orderBy(asc(gameAttempts.position))
  const choices = await tx.select({ checkpoint: gameHintChoices.checkpoint, hintKey: gameHintChoices.hintKey, response: gameHintChoices.responseSnapshot })
    .from(gameHintChoices).where(eq(gameHintChoices.sessionId, session.id)).orderBy(asc(gameHintChoices.checkpoint))
  let diagnosisVignette: { id: string; text: string } | null = null
  if (session.mode === 'diagnosis') {
    const rows = await tx.select({ id: diagnosisVignettes.id, text: diagnosisVignettes.text }).from(diagnosisVignettes)
      .where(eq(diagnosisVignettes.itemVersionId, session.answerItemVersionId)).orderBy(asc(diagnosisVignettes.sortOrder))
    diagnosisVignette = pickDailyVignette(rows, session.answerItemVersionId, session.puzzleDate)
  }
  const answerRows = session.mode === 'music' || session.status !== 'playing'
    ? await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
    : []
  const answer = answerRows[0]?.payload as TitleItem | undefined
  const result: Record<string, unknown> = {
    id: session.id, kind: session.kind, mode: session.mode, period: session.period, difficulty: session.difficulty,
    puzzleDate: session.puzzleDate, status: session.status, attemptsCount: session.attemptsCount,
    attemptsRemaining: 10 - session.attemptsCount,
    attempts: attempts.map((entry) => ({ position: entry.position, item: publicCard(entry.item as TitleItem), hints: entry.hints })),
    hintCheckpoints: [5, 8].map((round) => ({ round, state: choices.some((choice) => choice.checkpoint === round) ? 'opened' : session.attemptsCount >= round ? 'available' : 'locked' })),
    hintChoices: choices,
    progressiveHints: session.mode === 'music' && answer ? progressiveMusicHints(answer, session.attemptsCount) : [],
    diagnosisVignette,
    serverTime: new Date().toISOString(),
  }
  if (session.status !== 'playing' && answer) result.answer = publicCard(answer)
  return result
}

export const getOwnedSession = async (db: Database, userId: string, sessionId: string) => {
  const session = await db.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId))).limit(1)
  if (!session[0]) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  return buildSessionSnapshot(db, session[0])
}

export const submitAttempt = async (db: Database, userId: string, sessionId: string, itemId: string, idempotencyKey: string) => db.transaction(async (tx) => {
  const replay = await tx.select({ response: gameAttempts.responseSnapshot }).from(gameAttempts).where(and(eq(gameAttempts.sessionId, sessionId), eq(gameAttempts.idempotencyKey, idempotencyKey))).limit(1)
  if (replay[0]) return replay[0].response
  const sessions = await tx.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId))).for('update').limit(1)
  const session = sessions[0]
  if (!session) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  const lockedReplay = await tx.select({ response: gameAttempts.responseSnapshot }).from(gameAttempts).where(and(eq(gameAttempts.sessionId, sessionId), eq(gameAttempts.idempotencyKey, idempotencyKey))).limit(1)
  if (lockedReplay[0]) return lockedReplay[0].response
  if (session.status !== 'playing') throw new ApiError(409, 'GAME_ALREADY_COMPLETED', 'Игра уже завершена')
  if (session.attemptsCount >= 10) throw new ApiError(409, 'GAME_ATTEMPTS_EXHAUSTED', 'Попытки закончились')

  const pool = await answerPool(tx, session.revisionId, session.mode, session.period, session.difficulty)
  const guess = pool.items.find((item) => item.id === itemId)
  if (!guess) throw new ApiError(422, 'GAME_ITEM_OUTSIDE_POOL', 'Вариант недоступен в этой игре')
  const guessedVersionId = pool.byItemId.get(guess.id)!
  const duplicate = await tx.select({ id: gameAttempts.id }).from(gameAttempts).where(and(eq(gameAttempts.sessionId, sessionId), eq(gameAttempts.guessedItemVersionId, guessedVersionId))).limit(1)
  if (duplicate[0]) throw new ApiError(409, 'GAME_DUPLICATE_GUESS', 'Этот вариант уже был в попытках')
  const answers = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const answer = answers[0].payload as TitleItem
  const isCorrect = guess.id === answer.id
  const position = session.attemptsCount + 1
  const status = isCorrect ? 'won' : position >= 10 ? 'lost' : 'playing'
  const hints = compareTitles(guess, answer)
  let reward: Awaited<ReturnType<typeof completeGame>> = null
  if (status !== 'playing') reward = await completeGame(tx, {
    sessionId, userId, kind: session.kind, mode: session.mode, difficulty: session.difficulty,
    puzzleDate: session.puzzleDate, won: status === 'won', attemptsCount: position,
  })
  await tx.update(gameSessions).set({
    attemptsCount: position, status, updatedAt: new Date(), completedAt: status === 'playing' ? null : new Date(),
    rewardLedgerId: reward?.ledgerId ?? null,
  }).where(eq(gameSessions.id, sessionId))
  const response: Record<string, unknown> = {
    attempt: { position, item: publicCard(guess), hints },
    session: { status, attemptsCount: position, attemptsRemaining: 10 - position },
    progressiveHints: session.mode === 'music' ? progressiveMusicHints(answer, position) : [],
  }
  if (status !== 'playing') { response.answer = publicCard(answer); response.reward = reward }
  await tx.insert(gameAttempts).values({
    sessionId, position, guessedItemVersionId: guessedVersionId, isCorrect, hintsSnapshot: hints, responseSnapshot: response, idempotencyKey,
  })
  return response
})

const assistValue = (answer: TitleItem, key: string) => {
  if (key === 'plot') return answer.plotHint ?? answer.shortDescription ?? null
  if (key === 'slogan') return answer.slogan ?? null
  if (key === 'cast_main') return (answer.cast ?? []).slice(0, 5).map((person) => person.nameRu || person.nameOriginal)
  if (key === 'cast_secondary') return (answer.supportingCast ?? []).slice(0, 5).map((person) => person.nameRu || person.nameOriginal)
  if (key === 'fact') return answer.facts?.[0] ?? null
  if (key === 'awards') return answer.awards ?? null
  return null
}

export const chooseHint = async (db: Database, userId: string, sessionId: string, checkpoint: 5 | 8, hintKey: string, idempotencyKey: string) => db.transaction(async (tx) => {
  const replay = await tx.select({ response: gameHintChoices.responseSnapshot }).from(gameHintChoices).where(and(eq(gameHintChoices.sessionId, sessionId), eq(gameHintChoices.idempotencyKey, idempotencyKey))).limit(1)
  if (replay[0]) return replay[0].response
  const sessions = await tx.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId))).for('update').limit(1)
  const session = sessions[0]
  if (!session) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  const lockedReplay = await tx.select({ response: gameHintChoices.responseSnapshot }).from(gameHintChoices).where(and(eq(gameHintChoices.sessionId, sessionId), eq(gameHintChoices.idempotencyKey, idempotencyKey))).limit(1)
  if (lockedReplay[0]) return lockedReplay[0].response
  if (session.attemptsCount < checkpoint) throw new ApiError(422, 'HINT_CHECKPOINT_LOCKED', 'Эта подсказка пока недоступна')
  const existing = await tx.select().from(gameHintChoices).where(and(eq(gameHintChoices.sessionId, sessionId), eq(gameHintChoices.checkpoint, checkpoint))).limit(1)
  if (existing[0]) throw new ApiError(409, 'HINT_ALREADY_CHOSEN', 'Подсказка на этом этапе уже выбрана')
  const answers = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const value = assistValue(answers[0].payload as TitleItem, hintKey)
  if (value == null || (Array.isArray(value) && !value.length)) throw new ApiError(422, 'HINT_NOT_AVAILABLE', 'У ответа нет выбранной подсказки')
  const response = { checkpoint, hintKey, value }
  await tx.insert(gameHintChoices).values({ sessionId, checkpoint, hintKey, responseSnapshot: response, idempotencyKey })
  return response
})

export const searchCatalog = async (db: Database, input: { mode: TitleMode; q: string; period?: PeriodKey; difficulty?: ApiDifficultyKey; sessionId?: string; limit?: number }, userId?: string) => {
  let revisionId: string
  let period = input.period ?? 'all'
  let difficulty = input.difficulty ?? null
  const excluded = new Set<string>()
  if (input.sessionId) {
    const sessions = await db.select().from(gameSessions).where(eq(gameSessions.id, input.sessionId)).limit(1)
    const session = sessions[0]
    if (!session || (userId && session.userId !== userId)) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
    revisionId = session.revisionId; period = session.period; difficulty = session.difficulty
    const used = await db.select({ itemId: contentItemVersions.itemId }).from(gameAttempts).innerJoin(contentItemVersions, eq(contentItemVersions.id, gameAttempts.guessedItemVersionId)).where(eq(gameAttempts.sessionId, session.id))
    used.forEach((row) => excluded.add(row.itemId))
  } else {
    revisionId = await activeRevision(db)
  }
  const pool = await answerPool(db, revisionId, input.mode, period, difficulty ?? null)
  const { searchTitles } = await import('@shoditsa/game-core')
  return searchTitles(pool.items, input.q, excluded).slice(0, input.limit ?? 10).map(publicCard)
}
