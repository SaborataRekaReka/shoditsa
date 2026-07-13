import { and, asc, eq, sql } from 'drizzle-orm'
import type { ApiDifficultyKey, AssistHintKey, Hint, PeriodKey, TitleItem, TitleMode } from '@shoditsa/contracts'
import {
  appSettings, contentItemVersions, contentRevisionModes, contentRevisions, dailyChallenges,
  diagnosisVignettes, gameAttempts, gameHintChoices, gameSessions, type Database,
  periodEntitlements,
} from '@shoditsa/database'
import {
  compareTitles,
  dailyTitle,
  localizeMusicCountry,
  musicDifficultyPool,
  musicOriginLabel,
  musicTypeLabel,
  pickDailyVignette,
  poolFor,
} from '@shoditsa/game-core'
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

const legacyPeoplePhotoUrl = (value: string | null | undefined) => {
  if (!value) return null
  if (/^\/?media\//.test(value) || /^https?:\/\//.test(value)) return value
  const normalized = value.replace(/^\.\//, '/')
  const people = normalized.match(/^\/data\/libraries\/people\/img\/(.+)$/)
  return people ? `/media/people/${people[1]}` : value
}

const normalizePeoplePhotos = <T extends { photoUrl?: string | null }>(people?: T[]) =>
  people?.map((person) => ({ ...person, photoUrl: legacyPeoplePhotoUrl(person.photoUrl) ?? undefined }))

const normalizeHintPeople = (hints: Hint[]) => hints.map((hint) => (
  hint.people?.length
    ? { ...hint, people: hint.people.map((person) => ({ ...person, photoUrl: legacyPeoplePhotoUrl(person.photoUrl) ?? undefined })) }
    : hint
))

const cleanHintText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const cropHintText = (value: string, max = 190) => value.length > max ? `${value.slice(0, max).trimEnd()}…` : value
const compactList = (label: string, values: Array<string | null | undefined>, limit = 3) => {
  const normalized = values.map((value) => cleanHintText(value)).filter(Boolean)
  if (!normalized.length) return ''
  return `${label}: ${normalized.slice(0, limit).join(', ')}`
}

const infoHintCandidates = (answer: TitleItem) => {
  if (answer.mode === 'music') {
    return [
      compactList('Страна', (answer.countries ?? []).map(localizeMusicCountry), 2),
      answer.year ? `Начало карьеры: ${answer.year}` : '',
      `Тип: ${musicTypeLabel(answer.musicType)}`,
      answer.musicOrigin ? `Сцена: ${musicOriginLabel(answer.musicOrigin)}` : '',
      compactList('Жанры', answer.genres ?? [], 3),
      compactList('Топ-треки', (answer.topTracks ?? []).map((track) => track.title), 2),
    ].filter(Boolean)
  }

  if (answer.mode === 'game') {
    return [
      answer.year ? `Год релиза: ${answer.year}` : '',
      compactList('Жанры', answer.genres ?? [], 3),
      compactList('Платформы', answer.platforms ?? [], 3),
      compactList('Разработчики', answer.developers ?? [], 2),
      answer.topRank ? `Позиция в топе: #${answer.topRank}` : '',
      answer.ratings?.metacritic != null || answer.metacritic != null ? `Metacritic: ${answer.ratings?.metacritic ?? answer.metacritic}` : '',
    ].filter(Boolean)
  }

  if (answer.mode === 'diagnosis') {
    return [
      compactList('Системы организма', answer.bodySystems ?? [], 3),
      compactList('Ключевые симптомы', answer.keySymptoms ?? [], 3),
      compactList('Диагностика', answer.diagnostics ?? [], 3),
      compactList('МКБ-10', answer.icd10 ?? [], 3),
      answer.icdGroup ? `Группа: ${answer.icdGroup}` : '',
    ].filter(Boolean)
  }

  if (answer.mode === 'anime') {
    return [
      answer.animeKind ? `Формат: ${answer.animeKind}` : '',
      answer.animeStatus ? `Статус: ${answer.animeStatus}` : '',
      answer.episodes ? `Эпизоды: ${answer.episodes}` : '',
      compactList('Студии', answer.studios ?? [], 2),
      compactList('Жанры', answer.genres ?? [], 3),
      answer.year ? `Год релиза: ${answer.year}` : '',
    ].filter(Boolean)
  }

  return [
    answer.year ? `Год релиза: ${answer.year}` : '',
    compactList('Страны', answer.countries ?? [], 2),
    compactList('Жанры', answer.genres ?? [], 3),
    compactList('Режиссёры', (answer.directors ?? []).map((person) => person.nameRu || person.nameOriginal), 2),
    compactList('Каст', (answer.cast ?? []).map((person) => person.nameRu || person.nameOriginal), 3),
  ].filter(Boolean)
}

const factHintValue = (answer: TitleItem) => {
  const fact = cleanHintText((answer.facts ?? [])[0] ?? '')
  if (fact) return cropHintText(fact)

  const fallback = cleanHintText(answer.plotHint ?? answer.shortDescription ?? answer.description ?? '')
  return fallback ? cropHintText(fallback) : ''
}

type BuiltHintOption = {
  key: AssistHintKey
  title: string
  subtitle: string
  value: string
}

const buildHintOptions = (answer: TitleItem, choices: Array<{ hintKey: string }>): BuiltHintOption[] => {
  const options: BuiltHintOption[] = []

  const infoUsedCount = choices.filter((choice) => choice.hintKey === 'info').length
  const infoValue = cleanHintText(infoHintCandidates(answer)[infoUsedCount] ?? '')
  if (infoValue) {
    options.push({
      key: 'info',
      title: 'Неоткрытая информация',
      subtitle: 'Деталь о правильном ответе, которая ещё не показывалась',
      value: infoValue,
    })
  }

  const factAlreadyOpened = choices.some((choice) => choice.hintKey === 'fact')
  const factValue = factAlreadyOpened ? '' : factHintValue(answer)
  if (factValue) {
    options.push({
      key: 'fact',
      title: 'Интересный факт',
      subtitle: 'Факт из карточки или поле подсказки без спойлеров',
      value: factValue,
    })
  }

  return options
}

export const publicCard = (item: TitleItem) => ({
  ...item,
  titleOriginal: item.titleOriginal ?? '',
  year: item.year ?? null,
  genres: item.genres ?? [],
  posterUrl: legacyMediaUrl(item.posterUrl, item.mode, item.id),
  developers: item.developers ?? [],
  publishers: item.publishers ?? [],
  platforms: item.platforms ?? [],
  steamCategories: item.steamCategories ?? [],
  keySymptoms: item.keySymptoms ?? [],
  diagnostics: item.diagnostics ?? [],
  riskFactors: item.riskFactors ?? [],
  topTracks: item.topTracks ?? [],
  topAlbums: item.topAlbums ?? [],
  similarArtists: item.similarArtists ?? [],
  directors: normalizePeoplePhotos(item.directors),
  showrunners: normalizePeoplePhotos(item.showrunners),
  writers: normalizePeoplePhotos(item.writers),
  cast: normalizePeoplePhotos(item.cast),
  supportingCast: normalizePeoplePhotos(item.supportingCast),
})

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
  const answerRows = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const answer = answerRows[0]?.payload as TitleItem | undefined
  const hintOptions = answer ? buildHintOptions(answer, choices.map((choice) => ({ hintKey: String(choice.hintKey) }))) : []
  const result: Record<string, unknown> = {
    id: session.id, kind: session.kind, mode: session.mode, period: session.period, difficulty: session.difficulty,
    puzzleDate: session.puzzleDate, status: session.status, attemptsCount: session.attemptsCount,
    attemptsRemaining: 10 - session.attemptsCount,
    attempts: attempts.map((entry) => ({
      position: entry.position,
      item: publicCard(entry.item as TitleItem),
      hints: normalizeHintPeople(entry.hints as Hint[]),
    })),
    hintCheckpoints: [5, 8].map((round) => ({
      round,
      state: choices.some((choice) => choice.checkpoint === round)
        ? 'opened'
        : session.attemptsCount >= round && hintOptions.length > 0
          ? 'available'
          : 'locked',
    })),
    hintChoices: choices,
    hintOptions: hintOptions.map(({ key, title, subtitle }) => ({ key, title, subtitle })),
    progressiveHints: [],
    diagnosisVignette,
    serverTime: new Date().toISOString(),
  }
  if ((session.mode === 'music' || session.status !== 'playing') && answer) result.answer = publicCard(answer)
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
  const hints = normalizeHintPeople(compareTitles(guess, answer) as Hint[])
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
    progressiveHints: [],
  }
  if (status !== 'playing') { response.answer = publicCard(answer); response.reward = reward }
  await tx.insert(gameAttempts).values({
    sessionId, position, guessedItemVersionId: guessedVersionId, isCorrect, hintsSnapshot: hints, responseSnapshot: response, idempotencyKey,
  })
  return response
})

export const chooseHint = async (db: Database, userId: string, sessionId: string, checkpoint: 5 | 8, hintKey: AssistHintKey, idempotencyKey: string) => db.transaction(async (tx) => {
  const replay = await tx.select({ response: gameHintChoices.responseSnapshot }).from(gameHintChoices).where(and(eq(gameHintChoices.sessionId, sessionId), eq(gameHintChoices.idempotencyKey, idempotencyKey))).limit(1)
  if (replay[0]) return replay[0].response
  const sessions = await tx.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId))).for('update').limit(1)
  const session = sessions[0]
  if (!session) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  const lockedReplay = await tx.select({ response: gameHintChoices.responseSnapshot }).from(gameHintChoices).where(and(eq(gameHintChoices.sessionId, sessionId), eq(gameHintChoices.idempotencyKey, idempotencyKey))).limit(1)
  if (lockedReplay[0]) return lockedReplay[0].response
  if (session.attemptsCount < checkpoint) throw new ApiError(422, 'HINT_CHECKPOINT_LOCKED', 'Эта подсказка пока недоступна')
  const existingChoices = await tx.select({ checkpoint: gameHintChoices.checkpoint, hintKey: gameHintChoices.hintKey }).from(gameHintChoices).where(eq(gameHintChoices.sessionId, sessionId)).orderBy(asc(gameHintChoices.checkpoint))
  if (existingChoices.some((choice) => choice.checkpoint === checkpoint)) throw new ApiError(409, 'HINT_ALREADY_CHOSEN', 'Подсказка на этом этапе уже выбрана')
  const answers = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const options = buildHintOptions(answers[0].payload as TitleItem, existingChoices.map((choice) => ({ hintKey: String(choice.hintKey) })))
  const selectedOption = options.find((option) => option.key === hintKey)
  if (!selectedOption) throw new ApiError(422, 'HINT_NOT_AVAILABLE', 'Для этого этапа нет доступных вариантов подсказки')
  const response = { checkpoint, hintKey: selectedOption.key, value: selectedOption.value }
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
