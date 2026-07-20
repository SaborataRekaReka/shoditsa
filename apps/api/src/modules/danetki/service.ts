import { createHash, createHmac, randomBytes } from 'node:crypto'
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import type { DanetkiPayload, PublicDanetka } from '@shoditsa/contracts'
import {
  appSettings,
  backgroundJobs,
  contentItemVersions,
  contentRevisions,
  dailyChallenges,
  danetkiFinalGuesses,
  danetkiInvites,
  danetkiMessages,
  danetkiSessionMembers,
  danetkiSessionState,
  danetkiSurrenderVotes,
  gameSessions,
  type Database,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import { canStartArchiveSession } from '../archive/access.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type SessionRow = typeof gameSessions.$inferSelect

export type DanetkiFeatureFlags = {
  enabled: boolean
  multiplayerEnabled: boolean
}

const settingBoolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback

export const loadDanetkiFeatureFlags = async (db: Pick<Database, 'select'>): Promise<DanetkiFeatureFlags> => {
  const rows = await db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings)
    .where(inArray(appSettings.key, ['danetki.enabled', 'danetki.multiplayerEnabled']))
  const settings = new Map(rows.map((row) => [row.key, row.value]))
  return {
    enabled: settingBoolean(settings.get('danetki.enabled'), false),
    multiplayerEnabled: settingBoolean(settings.get('danetki.multiplayerEnabled'), true),
  }
}

const textArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string')
  : []

export const toPublicDanetka = (value: unknown): PublicDanetka => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(500, 'DANETKI_CONTENT_INVALID', 'Данетка содержит некорректные данные')
  }
  const payload = value as Record<string, unknown>
  if (
    payload.mode !== 'danetki'
    || typeof payload.id !== 'string'
    || typeof payload.titleRu !== 'string'
    || typeof payload.condition !== 'string'
    || !['easy', 'medium', 'hard'].includes(String(payload.difficulty))
  ) {
    throw new ApiError(500, 'DANETKI_CONTENT_INVALID', 'Данетка содержит некорректные данные')
  }
  return {
    id: payload.id,
    titleRu: payload.titleRu,
    condition: payload.condition,
    difficulty: payload.difficulty as PublicDanetka['difficulty'],
    genres: textArray(payload.genres),
    starterQuestions: textArray(payload.starterQuestions),
    contentWarnings: textArray(payload.contentWarnings),
  }
}

const stableIndex = (seed: string, length: number) => {
  const prefix = createHash('sha256').update(seed).digest().readUInt32BE(0)
  return prefix % length
}

export const normalizeDanetkiQuestion = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

export const hashDanetkiInviteToken = (token: string) => createHash('sha256').update(token).digest('hex')

const colorKeyFor = (userId: string) => `player-${stableIndex(userId, 12) + 1}`

const dailySalt = async (tx: Transaction) => {
  const rows = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'daily_global_salt')).limit(1)
  return Number(rows[0]?.value ?? 0) || 0
}

const activeRevisionId = async (tx: Transaction) => {
  const rows = await tx.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!rows[0]) throw new ApiError(503, 'CONTENT_NOT_READY', 'Активная ревизия контента не настроена')
  return rows[0].id
}

const resolveChallenge = async (tx: Transaction, puzzleDate: string) => {
  const salt = await dailySalt(tx)
  const challengeKey = `${puzzleDate}|danetki|all|-|${salt}|v1`
  let challenge = await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1)
  if (challenge[0]) return challenge[0]

  const revisionId = await activeRevisionId(tx)
  const pool = await tx.select({ id: contentItemVersions.id, payload: contentItemVersions.payload })
    .from(contentItemVersions)
    .where(and(
      eq(contentItemVersions.revisionId, revisionId),
      eq(contentItemVersions.mode, 'danetki'),
      eq(contentItemVersions.allowedInGame, true),
      inArray(contentItemVersions.contentStatus, ['test', 'ready']),
    ))
    .orderBy(asc(contentItemVersions.sortOrder))
  if (!pool.length) throw new ApiError(503, 'DANETKI_CONTENT_POOL_EMPTY', 'Нет доступных данеток для запуска')
  const selected = pool[stableIndex(`shoditsa|danetki|${puzzleDate}|${salt}`, pool.length)]
  // Parse the public shape here as well, so a malformed secret payload can
  // never create a player session that subsequently fails to render.
  toPublicDanetka(selected.payload)

  const inserted = await tx.insert(dailyChallenges).values({
    challengeKey,
    puzzleDate,
    mode: 'danetki',
    period: 'all',
    difficulty: null,
    variantKey: '-',
    revisionId,
    answerItemVersionId: selected.id,
    globalSalt: salt,
    algorithmVersion: 1,
  }).onConflictDoNothing().returning()
  challenge = inserted[0]
    ? inserted
    : await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1)
  if (!challenge[0]) throw new ApiError(503, 'DANETKI_CHALLENGE_NOT_READY', 'Не удалось подготовить данетку')
  return challenge[0]
}

const resolveFreePlayPuzzle = async (tx: Transaction) => {
  const revisionId = await activeRevisionId(tx)
  const pool = await tx.select({ id: contentItemVersions.id, payload: contentItemVersions.payload })
    .from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, revisionId), eq(contentItemVersions.mode, 'danetki'),
      eq(contentItemVersions.allowedInGame, true), inArray(contentItemVersions.contentStatus, ['test', 'ready']),
    )).orderBy(asc(contentItemVersions.sortOrder))
  if (!pool.length) throw new ApiError(503, 'DANETKI_CONTENT_POOL_EMPTY', 'Нет доступных данеток для запуска')
  const selected = pool[stableIndex(randomBytes(32).toString('hex'), pool.length)]
  toPublicDanetka(selected.payload)
  return { revisionId, answerItemVersionId: selected.id }
}

const iso = (value: Date) => value.toISOString()

export const buildDanetkiSessionSnapshot = async (db: Database | Transaction, session: SessionRow, currentUserId: string) => {
  const member = await db.select({ userId: danetkiSessionMembers.userId }).from(danetkiSessionMembers).where(and(
    eq(danetkiSessionMembers.sessionId, session.id),
    eq(danetkiSessionMembers.userId, currentUserId),
    isNull(danetkiSessionMembers.leftAt),
  )).limit(1)
  if (!member[0]) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  await db.update(danetkiSessionMembers).set({ lastSeenAt: new Date() }).where(and(
    eq(danetkiSessionMembers.sessionId, session.id),
    eq(danetkiSessionMembers.userId, currentUserId),
    isNull(danetkiSessionMembers.leftAt),
    sql`${danetkiSessionMembers.lastSeenAt} < now() - interval '30 seconds'`,
  ))

  const [stateRows, puzzleRows, members, messages] = await Promise.all([
    db.select().from(danetkiSessionState).where(eq(danetkiSessionState.sessionId, session.id)).limit(1),
    db.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1),
    db.select().from(danetkiSessionMembers).where(eq(danetkiSessionMembers.sessionId, session.id)).orderBy(asc(danetkiSessionMembers.joinedAt)),
    db.select().from(danetkiMessages).where(eq(danetkiMessages.sessionId, session.id)).orderBy(asc(danetkiMessages.seq)),
  ])
  const state = stateRows[0]
  const rawPuzzle = puzzleRows[0]?.payload
  if (!state || !rawPuzzle) throw new ApiError(500, 'DANETKI_SESSION_INVALID', 'Данные игровой сессии повреждены')
  const puzzle = toPublicDanetka(rawPuzzle)
  const secret = rawPuzzle as DanetkiPayload
  const memberById = new Map(members.map((entry) => [entry.userId, entry]))

  return {
    engine: 'danetki_chat' as const,
    id: session.id,
    kind: session.kind,
    packId: null,
    packPosition: null,
    mode: 'danetki' as const,
    variantKey: null,
    period: 'all' as const,
    difficulty: null,
    puzzleDate: session.puzzleDate,
    status: session.status,
    attemptsCount: 0,
    attemptsRemaining: 0,
    attempts: [],
    hintCheckpoints: [],
    hintChoices: [],
    hintOptions: [],
    progressiveHints: [],
    promoPrompt: null,
    diagnosisVignette: null,
    serverTime: new Date().toISOString(),
    danetki: {
      puzzle,
      roomMode: state.roomMode,
      questionCount: state.questionCount,
      hintLevel: state.hintLevel,
      aiStatus: state.aiStatus,
      members: members.map((entry) => ({
        userId: entry.userId,
        role: entry.role,
        displayName: entry.displayNameSnapshot,
        colorKey: entry.colorKey,
        joinedAt: iso(entry.joinedAt),
        leftAt: entry.leftAt ? iso(entry.leftAt) : null,
        lastSeenAt: iso(entry.lastSeenAt),
      })),
      messages: messages.map((entry) => {
        const sender = entry.senderUserId ? memberById.get(entry.senderUserId) : null
        return {
          id: entry.id,
          seq: entry.seq,
          senderKind: entry.senderKind,
          senderUserId: entry.senderUserId,
          senderName: sender?.displayNameSnapshot ?? null,
          senderColorKey: sender?.colorKey ?? null,
          messageType: entry.messageType,
          text: entry.text,
          classification: entry.classification as 'yes' | 'no' | 'irrelevant' | 'unclear' | 'invalid' | null,
          importance: entry.importance as 'critical' | 'useful' | 'neutral' | null,
          parentMessageId: entry.parentMessageId,
          createdAt: iso(entry.createdAt),
        }
      }),
      currentUserId,
      canInvite: state.roomMode === 'group' && session.status === 'playing',
      lastSeq: Math.max(0, state.nextMessageSeq - 1),
      outcome: session.status as 'playing' | 'won' | 'lost',
      ...(session.status === 'playing' ? {} : { solution: secret.solution }),
    },
  }
}

export const startDanetkiSession = async (db: Database, user: {
  id: string
  name: string
  authSessionId: string | null
  role: 'player' | 'admin'
}, input: {
  kind: 'daily' | 'archive' | 'free_play'
  roomMode: 'solo' | 'group'
  archiveDate?: string | null
  idempotencyKey?: string
}, config: AppConfig) => {
  const flags = await loadDanetkiFeatureFlags(db)
  if (!flags.enabled) throw new ApiError(404, 'DANETKI_DISABLED', 'Режим «Данетки» пока недоступен')
  if (input.roomMode === 'group' && !flags.multiplayerEnabled) {
    throw new ApiError(404, 'DANETKI_MULTIPLAYER_DISABLED', 'Совместная игра пока недоступна')
  }
  const today = getMoscowDate()
  const puzzleDate = input.kind === 'daily' || input.kind === 'free_play' ? today : input.archiveDate
  if (!puzzleDate) throw new ApiError(422, 'ARCHIVE_DATE_REQUIRED', 'Для архивной игры нужна дата')
  if (puzzleDate > today) throw new ApiError(422, 'ARCHIVE_DATE_IN_FUTURE', 'Архивная дата не может быть в будущем')
  if (input.kind === 'archive') {
    const access = await canStartArchiveSession(db, user.id, puzzleDate, config, new Date(), { mode: 'danetki', period: 'all', difficulty: null })
    if (access.source === 'before-launch') throw new ApiError(422, 'ARCHIVE_DATE_BEFORE_LAUNCH', 'Эта дата была до запуска архива', { archiveDate: puzzleDate, archiveFirstDate: config.commerce.archiveFirstDate })
    if (!access.allowed) throw new ApiError(403, 'ARCHIVE_CLUB_REQUIRED', 'Эта дата входит в полный архив клуба. Сегодня и предыдущие шесть дней доступны всем', { archiveDate: puzzleDate, freeFrom: access.freeFrom })
  }

  return db.transaction(async (tx) => {
    const challenge = input.kind === 'free_play' ? null : await resolveChallenge(tx, puzzleDate)
    const freePlayPuzzle = input.kind === 'free_play' ? await resolveFreePlayPuzzle(tx) : null
    const inserted = await tx.insert(gameSessions).values({
      userId: user.id,
      authSessionId: user.authSessionId,
      challengeId: challenge?.id ?? null,
      kind: input.kind,
      mode: 'danetki',
      period: 'all',
      difficulty: null,
      puzzleDate,
      revisionId: challenge?.revisionId ?? freePlayPuzzle!.revisionId,
      answerItemVersionId: challenge?.answerItemVersionId ?? freePlayPuzzle!.answerItemVersionId,
      rulesVersion: 1,
      startIdempotencyKey: input.idempotencyKey,
    }).onConflictDoNothing().returning()
    const session = inserted[0] ?? (await tx.select().from(gameSessions).where(input.kind === 'free_play'
      ? and(eq(gameSessions.userId, user.id), eq(gameSessions.startIdempotencyKey, input.idempotencyKey!))
      : and(eq(gameSessions.userId, user.id), eq(gameSessions.challengeId, challenge!.id))).limit(1))[0]
    if (!session) throw new ApiError(503, 'DANETKI_SESSION_NOT_READY', 'Не удалось создать игровую сессию')

    await tx.insert(danetkiSessionState).values({ sessionId: session.id, roomMode: input.roomMode }).onConflictDoNothing()
    await tx.insert(danetkiSessionMembers).values({
      sessionId: session.id,
      userId: user.id,
      role: 'owner',
      displayNameSnapshot: user.name.trim().slice(0, 40) || 'Игрок',
      colorKey: colorKeyFor(user.id),
    }).onConflictDoNothing()
    return buildDanetkiSessionSnapshot(tx, session, user.id)
  })
}

export const getDanetkiSession = async (db: Database, userId: string, sessionId: string) => {
  const rows = await db.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.mode, 'danetki'))).limit(1)
  if (!rows[0]) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  return buildDanetkiSessionSnapshot(db, rows[0], userId)
}

type MemberContext = {
  session: SessionRow
  state: typeof danetkiSessionState.$inferSelect
  member: typeof danetkiSessionMembers.$inferSelect
}

const lockMemberContext = async (tx: Transaction, sessionId: string, userId: string): Promise<MemberContext> => {
  const sessions = await tx.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.mode, 'danetki'))).for('update').limit(1)
  const session = sessions[0]
  if (!session) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  const states = await tx.select().from(danetkiSessionState).where(eq(danetkiSessionState.sessionId, sessionId)).for('update').limit(1)
  if (!states[0]) throw new ApiError(500, 'DANETKI_SESSION_INVALID', 'Данные игровой сессии повреждены')
  const members = await tx.select().from(danetkiSessionMembers).where(and(
    eq(danetkiSessionMembers.sessionId, sessionId),
    eq(danetkiSessionMembers.userId, userId),
    isNull(danetkiSessionMembers.leftAt),
  )).limit(1)
  if (!members[0]) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  return { session, state: states[0], member: members[0] }
}

const nextSeq = (state: typeof danetkiSessionState.$inferSelect) => state.nextMessageSeq

const messageDto = (entry: typeof danetkiMessages.$inferSelect, sender?: typeof danetkiSessionMembers.$inferSelect | null) => ({
  id: entry.id,
  seq: entry.seq,
  senderKind: entry.senderKind,
  senderUserId: entry.senderUserId,
  senderName: sender?.displayNameSnapshot ?? null,
  senderColorKey: sender?.colorKey ?? null,
  messageType: entry.messageType,
  text: entry.text,
  classification: entry.classification as 'yes' | 'no' | 'irrelevant' | 'unclear' | 'invalid' | null,
  importance: entry.importance as 'critical' | 'useful' | 'neutral' | null,
  parentMessageId: entry.parentMessageId,
  createdAt: iso(entry.createdAt),
})

export const createDanetkiMessage = async (db: Database, userId: string, sessionId: string, input: {
  text: string
  idempotencyKey: string
}) => db.transaction(async (tx) => {
  const replay = await tx.select().from(danetkiMessages).where(and(
    eq(danetkiMessages.sessionId, sessionId),
    eq(danetkiMessages.senderUserId, userId),
    eq(danetkiMessages.idempotencyKey, input.idempotencyKey),
  )).limit(1)
  if (replay[0]) return { message: messageDto(replay[0]), aiStatus: 'queued' as const }

  const { session, state, member } = await lockMemberContext(tx, sessionId, userId)
  if (session.status !== 'playing') throw new ApiError(409, 'GAME_ALREADY_COMPLETED', 'Игра уже завершена')
  const normalized = normalizeDanetkiQuestion(input.text)
  if (normalized.length < 2) throw new ApiError(422, 'DANETKI_QUESTION_TOO_SHORT', 'Сформулируйте вопрос подробнее')

  const rateSettings = await tx.select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(inArray(appSettings.key, [
    'danetki.userCooldownMs', 'danetki.roomQuestionsPerMinute',
  ]))
  const rateValues = new Map(rateSettings.map((entry) => [entry.key, Number(entry.value)]))
  const userCooldownMs = Math.max(500, Math.min(30_000, rateValues.get('danetki.userCooldownMs') || 2_000))
  const roomQuestionsPerMinute = Math.max(1, Math.min(120, rateValues.get('danetki.roomQuestionsPerMinute') || 20))
  const twoSecondsAgo = new Date(Date.now() - userCooldownMs)
  const minuteAgo = new Date(Date.now() - 60_000)
  const [recentUser, roomRate] = await Promise.all([
    tx.select({ id: danetkiMessages.id }).from(danetkiMessages).where(and(
      eq(danetkiMessages.sessionId, sessionId), eq(danetkiMessages.senderUserId, userId),
      eq(danetkiMessages.messageType, 'question'), gt(danetkiMessages.createdAt, twoSecondsAgo),
    )).limit(1),
    tx.select({ value: count() }).from(danetkiMessages).where(and(
      eq(danetkiMessages.sessionId, sessionId), eq(danetkiMessages.messageType, 'question'), gt(danetkiMessages.createdAt, minuteAgo),
    )),
  ])
  if (recentUser[0]) throw new ApiError(429, 'DANETKI_QUESTION_RATE_LIMITED', 'Подождите пару секунд перед следующим вопросом')
  if (Number(roomRate[0]?.value ?? 0) >= roomQuestionsPerMinute) throw new ApiError(429, 'DANETKI_ROOM_RATE_LIMITED', 'В комнате слишком много вопросов. Сделайте короткую паузу')

  const inserted = await tx.insert(danetkiMessages).values({
    sessionId,
    seq: nextSeq(state),
    senderKind: 'user',
    senderUserId: userId,
    messageType: 'question',
    text: input.text.trim(),
    idempotencyKey: input.idempotencyKey,
  }).returning()
  const message = inserted[0]
  await tx.update(danetkiSessionState).set({
    nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`,
    questionCount: sql`${danetkiSessionState.questionCount} + 1`,
    aiStatus: 'queued',
    updatedAt: new Date(),
  }).where(eq(danetkiSessionState.sessionId, sessionId))
  await tx.insert(backgroundJobs).values({
    type: 'danetki_ai_reply',
    idempotencyKey: `danetki:reply:${message.id}`,
    createdBy: userId,
    payload: { sessionId, messageId: message.id, normalizedQuestion: normalized },
  }).onConflictDoNothing()
  return { message: messageDto(message, member), aiStatus: 'queued' as const }
})

export const retryDanetkiAi = async (db: Database, userId: string, sessionId: string, idempotencyKey: string) => db.transaction(async (tx) => {
  const { session, state } = await lockMemberContext(tx, sessionId, userId)
  if (session.status !== 'playing') throw new ApiError(409, 'GAME_ALREADY_COMPLETED', 'Игра уже завершена')
  if (state.aiStatus !== 'error') throw new ApiError(409, 'DANETKI_AI_RETRY_NOT_NEEDED', 'Ведущий уже отвечает или ожидает вопрос')
  const original = await tx.select().from(backgroundJobs).where(and(
    eq(backgroundJobs.status, 'failed'),
    inArray(backgroundJobs.type, ['danetki_ai_reply', 'danetki_guess_evaluate']),
    sql`${backgroundJobs.payload}->>'sessionId' = ${sessionId}`,
  )).orderBy(sql`${backgroundJobs.createdAt} desc`).limit(1)
  if (!original[0]) throw new ApiError(409, 'DANETKI_AI_JOB_NOT_RETRYABLE', 'Не удалось найти запрос для повтора')
  const jobKey = `danetki:player-retry:${sessionId}:${userId}:${idempotencyKey}`
  const inserted = await tx.insert(backgroundJobs).values({
    type: original[0].type, idempotencyKey: jobKey, createdBy: userId,
    payload: { ...(original[0].payload as Record<string, unknown>), retryOf: original[0].id },
  }).onConflictDoNothing().returning()
  const job = inserted[0] ?? (await tx.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, jobKey)).limit(1))[0]
  await tx.update(danetkiSessionState).set({ aiStatus: 'queued', updatedAt: new Date() }).where(eq(danetkiSessionState.sessionId, sessionId))
  return { queued: true, jobId: job.id }
})

const loadSecretPuzzle = async (tx: Transaction, session: SessionRow): Promise<DanetkiPayload> => {
  const rows = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const payload = rows[0]?.payload
  toPublicDanetka(payload)
  return payload as DanetkiPayload
}

export const revealDanetkiHint = async (db: Database, userId: string, sessionId: string, idempotencyKey: string) => db.transaction(async (tx) => {
  const replay = await tx.select().from(danetkiMessages).where(and(
    eq(danetkiMessages.sessionId, sessionId), eq(danetkiMessages.senderUserId, userId), eq(danetkiMessages.idempotencyKey, idempotencyKey),
  )).limit(1)
  if (replay[0]) return { message: messageDto(replay[0]), hintLevel: replay[0].text.match(/^Подсказка (\d)/)?.[1] ? Number(replay[0].text.match(/^Подсказка (\d)/)![1]) : null }
  const { session, state } = await lockMemberContext(tx, sessionId, userId)
  if (session.status !== 'playing') throw new ApiError(409, 'GAME_ALREADY_COMPLETED', 'Игра уже завершена')
  if (state.hintLevel >= 3) throw new ApiError(409, 'DANETKI_HINTS_EXHAUSTED', 'Все подсказки уже открыты')
  const puzzle = await loadSecretPuzzle(tx, session)
  const level = state.hintLevel + 1 as 1 | 2 | 3
  const hint = puzzle.hints.find((entry) => entry.level === level)
  if (!hint) throw new ApiError(500, 'DANETKI_HINT_INVALID', 'Подсказка не настроена')
  const message = (await tx.insert(danetkiMessages).values({
    sessionId, seq: nextSeq(state), senderKind: 'system', senderUserId: userId, messageType: 'hint',
    text: `Подсказка ${level}: ${hint.text}`, idempotencyKey,
  }).returning())[0]
  await tx.update(danetkiSessionState).set({ hintLevel: level, nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`, updatedAt: new Date() }).where(eq(danetkiSessionState.sessionId, sessionId))
  return { message: messageDto(message), hintLevel: level }
})

export const submitDanetkiGuess = async (db: Database, userId: string, sessionId: string, input: {
  text: string
  idempotencyKey: string
}) => db.transaction(async (tx) => {
  const replay = await tx.select().from(danetkiFinalGuesses).where(and(
    eq(danetkiFinalGuesses.sessionId, sessionId), eq(danetkiFinalGuesses.userId, userId), eq(danetkiFinalGuesses.idempotencyKey, input.idempotencyKey),
  )).limit(1)
  if (replay[0]) return { guess: replay[0] }
  const { session, state } = await lockMemberContext(tx, sessionId, userId)
  if (session.status !== 'playing') throw new ApiError(409, 'GAME_ALREADY_COMPLETED', 'Игра уже завершена')
  const message = (await tx.insert(danetkiMessages).values({
    sessionId, seq: nextSeq(state), senderKind: 'user', senderUserId: userId, messageType: 'guess', text: input.text.trim(), idempotencyKey: input.idempotencyKey,
  }).returning())[0]
  const guess = (await tx.insert(danetkiFinalGuesses).values({ sessionId, userId, text: input.text.trim(), idempotencyKey: input.idempotencyKey }).returning())[0]
  await tx.update(danetkiSessionState).set({ aiStatus: 'queued', nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`, updatedAt: new Date() }).where(eq(danetkiSessionState.sessionId, sessionId))
  await tx.insert(backgroundJobs).values({
    type: 'danetki_guess_evaluate', idempotencyKey: `danetki:guess:${guess.id}`, createdBy: userId,
    payload: { sessionId, guessId: guess.id, messageId: message.id },
  }).onConflictDoNothing()
  return { guess }
})

const addSystemMessage = async (tx: Transaction, state: typeof danetkiSessionState.$inferSelect, input: {
  sessionId: string
  text: string
  messageType?: 'event' | 'solution'
}) => tx.insert(danetkiMessages).values({
  sessionId: input.sessionId,
  seq: nextSeq(state),
  senderKind: 'system',
  messageType: input.messageType ?? 'event',
  text: input.text,
}).returning()

const finishLost = async (tx: Transaction, context: MemberContext) => {
  const puzzle = await loadSecretPuzzle(tx, context.session)
  const message = (await addSystemMessage(tx, context.state, { sessionId: context.session.id, messageType: 'solution', text: puzzle.solution }))[0]
  const now = new Date()
  await Promise.all([
    tx.update(gameSessions).set({ status: 'lost', completedAt: now, updatedAt: now }).where(eq(gameSessions.id, context.session.id)),
    tx.update(danetkiSessionState).set({ nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`, aiStatus: 'idle', updatedAt: now }).where(eq(danetkiSessionState.sessionId, context.session.id)),
    tx.update(danetkiInvites).set({ revokedAt: now }).where(and(eq(danetkiInvites.sessionId, context.session.id), isNull(danetkiInvites.revokedAt))),
  ])
  return message
}

export const voteDanetkiSurrender = async (db: Database, userId: string, sessionId: string) => db.transaction(async (tx) => {
  const context = await lockMemberContext(tx, sessionId, userId)
  if (context.session.status !== 'playing') return { completed: true, votes: 0, required: 0 }
  await tx.insert(danetkiSurrenderVotes).values({ sessionId, userId }).onConflictDoNothing()
  const [votes, active] = await Promise.all([
    tx.select({ value: count() }).from(danetkiSurrenderVotes).where(eq(danetkiSurrenderVotes.sessionId, sessionId)),
    tx.select({ value: count() }).from(danetkiSessionMembers).where(and(eq(danetkiSessionMembers.sessionId, sessionId), isNull(danetkiSessionMembers.leftAt))),
  ])
  const voteCount = Number(votes[0]?.value ?? 0)
  const required = context.state.roomMode === 'solo' ? 1 : Number(active[0]?.value ?? 0)
  const completed = required > 0 && voteCount >= required
  if (completed) await finishLost(tx, context)
  return { completed, votes: voteCount, required }
})

export const createDanetkiInvite = async (db: Database, userId: string, sessionId: string, idempotencyKey: string, config: AppConfig) => db.transaction(async (tx) => {
  const context = await lockMemberContext(tx, sessionId, userId)
  if (context.session.status !== 'playing') throw new ApiError(409, 'GAME_ALREADY_COMPLETED', 'Игра уже завершена')
  if (context.state.roomMode !== 'group') throw new ApiError(422, 'DANETKI_INVITE_SOLO_FORBIDDEN', 'В одиночную комнату нельзя приглашать игроков')
  const rawToken = createHmac('sha256', config.pipelineSecretsKey).update(`danetki-invite:v1:${sessionId}:${userId}:${idempotencyKey}`).digest('base64url')
  const tokenHash = hashDanetkiInviteToken(rawToken)
  const existing = await tx.select().from(danetkiInvites).where(eq(danetkiInvites.tokenHash, tokenHash)).limit(1)
  if (existing[0]) return { token: rawToken, expiresAt: iso(existing[0].expiresAt) }
  const invite = (await tx.insert(danetkiInvites).values({
    sessionId, tokenHash, createdBy: userId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000), maxUses: 5,
  }).returning())[0]
  return { token: rawToken, expiresAt: iso(invite.expiresAt) }
})

const activeInvite = async (tx: Database | Transaction, token: string, lock = false) => {
  let query = tx.select({
    invite: danetkiInvites,
    session: gameSessions,
    titleRu: contentItemVersions.titleRu,
  }).from(danetkiInvites)
    .innerJoin(gameSessions, eq(gameSessions.id, danetkiInvites.sessionId))
    .innerJoin(contentItemVersions, eq(contentItemVersions.id, gameSessions.answerItemVersionId))
    .where(eq(danetkiInvites.tokenHash, hashDanetkiInviteToken(token)))
  const rows = lock ? await query.for('update').limit(1) : await query.limit(1)
  const row = rows[0]
  if (!row) throw new ApiError(404, 'DANETKI_INVITE_NOT_FOUND', 'Приглашение не найдено')
  if (row.invite.revokedAt) throw new ApiError(410, 'DANETKI_INVITE_REVOKED', 'Приглашение отозвано')
  if (row.invite.expiresAt <= new Date()) throw new ApiError(410, 'DANETKI_INVITE_EXPIRED', 'Срок действия приглашения истёк')
  if (row.session.status !== 'playing') throw new ApiError(410, 'DANETKI_ROOM_FINISHED', 'Эта игра уже завершена')
  if (row.invite.usesCount >= row.invite.maxUses) throw new ApiError(409, 'DANETKI_INVITE_EXHAUSTED', 'Лимит приглашения исчерпан')
  return row
}

export const previewDanetkiInvite = async (db: Database, token: string) => {
  const row = await activeInvite(db, token)
  const [owner, active] = await Promise.all([
    db.select({ name: danetkiSessionMembers.displayNameSnapshot }).from(danetkiSessionMembers).where(and(eq(danetkiSessionMembers.sessionId, row.session.id), eq(danetkiSessionMembers.role, 'owner'), isNull(danetkiSessionMembers.leftAt))).limit(1),
    db.select({ value: count() }).from(danetkiSessionMembers).where(and(eq(danetkiSessionMembers.sessionId, row.session.id), isNull(danetkiSessionMembers.leftAt))),
  ])
  const participants = Number(active[0]?.value ?? 0)
  if (participants >= 6) throw new ApiError(409, 'DANETKI_ROOM_FULL', 'В комнате уже шесть участников')
  return { title: row.titleRu, ownerName: owner[0]?.name ?? 'Игрок', participants, capacity: 6, expiresAt: iso(row.invite.expiresAt) }
}

export const joinDanetkiInvite = async (db: Database, user: { id: string; name: string }, token: string, displayName?: string) => db.transaction(async (tx) => {
  const row = await activeInvite(tx, token, true)
  const state = (await tx.select().from(danetkiSessionState).where(eq(danetkiSessionState.sessionId, row.session.id)).for('update').limit(1))[0]
  if (!state || state.roomMode !== 'group') throw new ApiError(422, 'DANETKI_INVITE_INVALID_ROOM', 'Приглашение ведёт в недоступную комнату')
  const active = await tx.select({ value: count() }).from(danetkiSessionMembers).where(and(eq(danetkiSessionMembers.sessionId, row.session.id), isNull(danetkiSessionMembers.leftAt)))
  const existing = await tx.select().from(danetkiSessionMembers).where(and(eq(danetkiSessionMembers.sessionId, row.session.id), eq(danetkiSessionMembers.userId, user.id))).limit(1)
  if (!existing[0] && Number(active[0]?.value ?? 0) >= 6) throw new ApiError(409, 'DANETKI_ROOM_FULL', 'В комнате уже шесть участников')
  const name = (displayName?.trim() || user.name.trim() || 'Игрок').slice(0, 40)
  await tx.insert(danetkiSessionMembers).values({
    sessionId: row.session.id, userId: user.id, role: 'player', displayNameSnapshot: name, colorKey: colorKeyFor(user.id),
  }).onConflictDoUpdate({ target: [danetkiSessionMembers.sessionId, danetkiSessionMembers.userId], set: { leftAt: null, lastSeenAt: new Date(), displayNameSnapshot: name } })
  if (!existing[0] || existing[0].leftAt) {
    await addSystemMessage(tx, state, { sessionId: row.session.id, text: `${name} присоединяется к расследованию` })
    await tx.update(danetkiSessionState).set({ nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`, updatedAt: new Date() }).where(eq(danetkiSessionState.sessionId, row.session.id))
    await tx.update(danetkiInvites).set({ usesCount: sql`${danetkiInvites.usesCount} + 1` }).where(eq(danetkiInvites.id, row.invite.id))
  }
  return buildDanetkiSessionSnapshot(tx, row.session, user.id)
})

export const leaveDanetkiSession = async (db: Database, userId: string, sessionId: string) => db.transaction(async (tx) => {
  const existingMember = (await tx.select().from(danetkiSessionMembers).where(and(
    eq(danetkiSessionMembers.sessionId, sessionId),
    eq(danetkiSessionMembers.userId, userId),
  )).for('update').limit(1))[0]
  if (!existingMember) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  if (existingMember.leftAt) return { left: true, newOwnerUserId: null, message: null }
  const context = await lockMemberContext(tx, sessionId, userId)
  const now = new Date()
  await tx.update(danetkiSessionMembers).set({ leftAt: now, lastSeenAt: now }).where(and(eq(danetkiSessionMembers.sessionId, sessionId), eq(danetkiSessionMembers.userId, userId)))
  let newOwnerUserId: string | null = null
  if (context.member.role === 'owner') {
    const next = await tx.select().from(danetkiSessionMembers).where(and(eq(danetkiSessionMembers.sessionId, sessionId), isNull(danetkiSessionMembers.leftAt))).orderBy(asc(danetkiSessionMembers.joinedAt)).limit(1)
    if (next[0]) {
      newOwnerUserId = next[0].userId
      await tx.update(danetkiSessionMembers).set({ role: 'owner' }).where(and(eq(danetkiSessionMembers.sessionId, sessionId), eq(danetkiSessionMembers.userId, next[0].userId)))
    }
  }
  const event = (await addSystemMessage(tx, context.state, { sessionId, text: `${context.member.displayNameSnapshot} покидает расследование` }))[0]
  await tx.update(danetkiSessionState).set({ nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`, updatedAt: now }).where(eq(danetkiSessionState.sessionId, sessionId))
  const active = await tx.select({ value: count() }).from(danetkiSessionMembers).where(and(eq(danetkiSessionMembers.sessionId, sessionId), isNull(danetkiSessionMembers.leftAt)))
  if (context.session.status === 'playing' && Number(active[0]?.value ?? 0) === 0) {
    const ttl = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'danetki.emptyRoomTtlMinutes')).limit(1)
    const ttlMinutes = Math.max(1, Math.min(10_080, Number(ttl[0]?.value) || 60))
    await tx.insert(backgroundJobs).values({
      type: 'danetki_room_expire', idempotencyKey: `danetki:expire:${sessionId}:${now.toISOString()}`,
      createdBy: userId, payload: { sessionId, emptySince: now.toISOString() }, nextRetryAt: new Date(now.getTime() + ttlMinutes * 60_000),
    }).onConflictDoNothing()
  }
  return { left: true, newOwnerUserId, message: messageDto(event) }
})
