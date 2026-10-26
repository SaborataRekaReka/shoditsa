import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import {
  contentItemVersions, contentRevisions, dailyChallenges, gameSessions, wordActions, wordSessionState, type Database,
} from '@shoditsa/database'
import {
  WORD_HINT_INTERVAL, WORD_LAUNCH_DATE, WORD_MAX_HINTS, isPlayableModeId, normalizeWord,
  type WordActionBody, type WordActionResponse, type GameSessionSnapshot, type WordGameState,
} from '@shoditsa/contracts'
import type { AppConfig } from '@shoditsa/config'
import { ApiError } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import { canStartArchiveSession } from '../archive/access.js'
import { loadAssignedEconomyRules } from '../economy/rules.js'
import { completeGame } from '../stats/rewards.js'
import { readWordPack } from './runtime.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReadDatabase = Database | Transaction
type Session = typeof gameSessions.$inferSelect
type Payload = { mode: 'word'; semanticDatasetHash: string; semanticWordKey: string; titleRu: string }
type WordSnapshot = Extract<GameSessionSnapshot, { engine: 'semantic_word' }>
type StoredWordAction = { wordJournal: 1; guessCount: number; response: WordActionResponse }

const ownedSession = async (db: ReadDatabase, userId: string, id: string, lock = false) => {
  const query = db.select().from(gameSessions).where(and(eq(gameSessions.id, id), eq(gameSessions.userId, userId), eq(gameSessions.mode, 'word'))).limit(1)
  const row = (await (lock ? query.for('update') : query))[0]
  if (!row) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  return row
}

const runtime = async (db: ReadDatabase, session: Session) => {
  const item = (await db.select({ payload: contentItemVersions.payload, mode: contentItemVersions.mode }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1))[0]
  const payload = item?.payload as Payload | undefined
  if (item?.mode !== 'word' || payload?.mode !== 'word' || !payload.semanticWordKey || !payload.semanticDatasetHash) throw new ApiError(503, 'WORD_CONTENT_UNAVAILABLE', 'Словарь временно недоступен. Попробуй позже.')
  try {
    const pack = await readWordPack(payload.semanticDatasetHash)
    if (!pack.targetKeys.includes(payload.semanticWordKey)) throw new Error('Target not in versioned pack')
    return { payload, pack }
  } catch {
    throw new ApiError(503, 'WORD_CONTENT_UNAVAILABLE', 'Словарь временно недоступен. Прогресс сохранён.')
  }
}

export async function buildWordSnapshot(db: ReadDatabase, session: Session): Promise<WordSnapshot> {
  const state = (await db.select().from(wordSessionState).where(eq(wordSessionState.sessionId, session.id)).limit(1))[0]
  if (!state) throw new ApiError(503, 'WORD_STATE_UNAVAILABLE', 'Не удалось открыть партию. Попробуй ещё раз.')
  const { pack, payload } = await runtime(db, session)
  const bestRank = state.guesses.length ? Math.min(...state.guesses.map(guess => guess.rank)) : null
  const terminal = session.status !== 'playing'
  const hintAt = (state.hintsUsed + 1) * WORD_HINT_INTERVAL
  const word: WordGameState = {
    guesses: state.guesses, vocabularySize: pack.vocabularySize, attemptsCount: session.attemptsCount,
    hintsUsed: state.hintsUsed, hintsRemaining: Math.max(0, WORD_MAX_HINTS - state.hintsUsed),
    nextHintAt: terminal || state.hintsUsed >= WORD_MAX_HINTS || bestRank != null && bestRank <= 2 ? null : hintAt,
    hintAvailable: !terminal && state.hintsUsed < WORD_MAX_HINTS && session.attemptsCount >= hintAt && bestRank != null && bestRank > 2,
    bestRank, unlimitedAttempts: true,
    status: session.status === 'won' ? 'won' : terminal ? 'lost' : 'playing',
    ...(terminal ? { answer: payload.titleRu } : {}),
  }
  return {
    engine: 'semantic_word', mode: 'word', id: session.id, kind: session.kind as WordSnapshot['kind'],
    rulesVersion: session.rulesVersion, variantKey: null, period: 'all', difficulty: null,
    puzzleDate: session.puzzleDate, packId: null, packPosition: null,
    status: session.status as WordSnapshot['status'], completionType: session.completionType as WordSnapshot['completionType'],
    finalChoice: null, attemptsCount: session.attemptsCount, attemptsRemaining: 0,
    attempts: [], hintCheckpoints: [], hintChoices: [], hintOptions: [], progressiveHints: [],
    promoPrompt: null, diagnosisVignette: null, serverTime: new Date().toISOString(), word,
  }
}

export async function getWordSession(db: Database, userId: string, id: string) {
  return buildWordSnapshot(db, await ownedSession(db, userId, id))
}

export async function startWordSession(db: Database, userId: string, input: { kind: 'daily' | 'archive'; archiveDate?: string | null }, authSessionId: string | null, role: 'player' | 'admin', config: AppConfig) {
  if (!isPlayableModeId('word') && role !== 'admin') throw new ApiError(404, 'GAME_MODE_NOT_RELEASED', 'Эта игра ещё не опубликована')
  const today = getMoscowDate()
  const puzzleDate = input.kind === 'daily' ? today : input.archiveDate
  if (!puzzleDate || !/^\d{4}-\d{2}-\d{2}$/.test(puzzleDate)) throw new ApiError(422, 'ARCHIVE_DATE_REQUIRED', 'Выбери дату в архиве')
  const parsedDate = new Date(`${puzzleDate}T00:00:00Z`)
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== puzzleDate || puzzleDate > today || puzzleDate < WORD_LAUNCH_DATE) throw new ApiError(422, 'WORD_DATE_UNAVAILABLE', 'Для этой даты слово ещё не опубликовано')
  const rules = await loadAssignedEconomyRules(db, userId, role, config.economy.v4RolloutPercent)
  return db.transaction(async tx => {
    if (input.kind === 'archive') {
      const access = await canStartArchiveSession(tx as unknown as Database, userId, puzzleDate, config, new Date(), { mode: 'word', period: 'all', difficulty: null })
      if (!access.allowed) throw new ApiError(403, 'ARCHIVE_CLUB_REQUIRED', 'Эта дата доступна участникам клуба')
    }
    const challengeKey = `${puzzleDate}|word|all|-|0|v1`
    let challenge = (await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1))[0]
    if (!challenge) {
      const revision = (await tx.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
      if (!revision) throw new ApiError(503, 'CONTENT_NOT_READY', 'Словарь ещё готовится. Попробуй позже.')
      const items = await tx.select({ id: contentItemVersions.id, payload: contentItemVersions.payload }).from(contentItemVersions).where(and(eq(contentItemVersions.revisionId, revision.id), eq(contentItemVersions.mode, 'word'), eq(contentItemVersions.allowedInGame, true))).orderBy(asc(contentItemVersions.sortOrder))
      if (!items.length) throw new ApiError(503, 'CONTENT_NOT_READY', 'Словарь ещё готовится. Попробуй позже.')
      const day = Math.floor((Date.parse(`${puzzleDate}T00:00:00Z`) - Date.parse(`${WORD_LAUNCH_DATE}T00:00:00Z`)) / 86_400_000)
      const answer = items[day % items.length]
      // Validate the exact immutable dataset before creating any session.
      const payload = answer.payload as Payload
      const pack = await readWordPack(payload.semanticDatasetHash)
      if (!pack.targetKeys.includes(payload.semanticWordKey)) throw new ApiError(503, 'WORD_CONTENT_UNAVAILABLE', 'Словарь ещё готовится. Попробуй позже.')
      await tx.insert(dailyChallenges).values({ challengeKey, puzzleDate, mode: 'word', period: 'all', difficulty: null, revisionId: revision.id, answerItemVersionId: answer.id, globalSalt: 0, algorithmVersion: 1 }).onConflictDoNothing()
      challenge = (await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1))[0]
    }
    const inserted = await tx.insert(gameSessions).values({ userId, authSessionId, challengeId: challenge.id, kind: input.kind, mode: 'word', period: 'all', puzzleDate, revisionId: challenge.revisionId, answerItemVersionId: challenge.answerItemVersionId, rulesVersion: rules.version }).onConflictDoNothing().returning()
    const session = inserted[0] ?? (await tx.select().from(gameSessions).where(and(eq(gameSessions.userId, userId), eq(gameSessions.challengeId, challenge.id))).limit(1))[0]
    await tx.insert(wordSessionState).values({ sessionId: session.id }).onConflictDoNothing()
    return buildWordSnapshot(tx, session)
  })
}

export async function applyWordAction(db: Database, userId: string, sessionId: string, body: WordActionBody, idempotencyKey: string): Promise<WordActionResponse> {
  const signature = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  return db.transaction(async tx => {
    const session = await ownedSession(tx, userId, sessionId, true)
    const replay = (await tx.select().from(wordActions).where(and(eq(wordActions.sessionId, sessionId), eq(wordActions.idempotencyKey, idempotencyKey))).limit(1))[0]
    if (replay) {
      if (replay.requestSignature !== signature) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Повтори действие с новым запросом')
      const stored = replay.responseSnapshot as StoredWordAction | WordActionResponse
      if ('wordJournal' in stored && stored.wordJournal === 1) {
        const [state] = await tx.select().from(wordSessionState).where(eq(wordSessionState.sessionId, sessionId)).limit(1)
        if (!state || stored.guessCount > state.guesses.length) throw new ApiError(503, 'WORD_STATE_UNAVAILABLE', 'Прогресс сохранён. Обнови страницу.')
        return { ...stored.response, session: { ...stored.response.session, word: { ...stored.response.session.word, guesses: state.guesses.slice(0, stored.guessCount) } } }
      }
      return stored as WordActionResponse
    }
    if (session.status !== 'playing') throw new ApiError(409, 'GAME_ALREADY_FINISHED', 'Партия уже завершена')
    const state = (await tx.select().from(wordSessionState).where(eq(wordSessionState.sessionId, sessionId)).limit(1))[0]
    if (!state) throw new ApiError(503, 'WORD_STATE_UNAVAILABLE', 'Не удалось открыть партию. Попробуй ещё раз.')
    const { pack, payload } = await runtime(tx, session)
    const guesses = [...state.guesses]
    let hintsUsed = state.hintsUsed
    let attemptsCount = session.attemptsCount
    let result: WordActionResponse['result'] = body.action === 'hint' ? 'hint' : body.action === 'give_up' ? 'given_up' : 'guess'
    let terminal = body.action === 'give_up'
    let won = false
    if (body.action !== 'give_up') {
      let input = body.action === 'guess' ? body.word : ''
      if (body.action === 'hint') {
        const snapshot = await buildWordSnapshot(tx, session)
        if (!snapshot.word.hintAvailable) throw new ApiError(409, 'WORD_HINT_UNAVAILABLE', 'Подсказка пока недоступна')
        const seen = new Set(guesses.map(guess => normalizeWord(guess.word)))
        const start = Math.max(2, Math.min(500, Math.floor(snapshot.word.bestRank! / 2)))
        for (let rank = start; rank >= 2; rank -= 1) {
          const word = pack.wordAtRank(payload.semanticWordKey, rank)
          if (word && !seen.has(normalizeWord(word))) { input = word; break }
        }
        if (!input) throw new ApiError(409, 'WORD_HINT_UNAVAILABLE', 'Ты уже нашёл самые близкие подсказки. Остался ответ!')
        hintsUsed += 1
      }
      const guess = pack.resolveWord(input)
      if (!guess) throw new ApiError(422, 'WORD_NOT_IN_DICTIONARY', 'Такого слова пока нет в словаре. Попробуй другое слово в начальной форме.')
      if (guesses.some(row => normalizeWord(row.word) === guess.key)) result = 'duplicate'
      else {
        const rank = pack.rank(payload.semanticWordKey, guess.index)
        guesses.push({ position: guesses.length + 1, word: guess.word, rank, source: body.action })
        if (body.action === 'guess') attemptsCount += 1
        won = rank === 1
        terminal = won
        if (won) result = 'won'
      }
    }
    await tx.update(wordSessionState).set({ guesses, hintsUsed, updatedAt: new Date() }).where(eq(wordSessionState.sessionId, sessionId))
    const [updated] = await tx.update(gameSessions).set({ attemptsCount, updatedAt: new Date(), ...(terminal ? { status: won ? 'won' : 'lost', completionType: won ? 'direct_win' : 'answer_revealed', completedAt: new Date() } : {}) }).where(eq(gameSessions.id, sessionId)).returning()
    const reward = terminal ? await completeGame(tx, { sessionId, userId, kind: session.kind, mode: 'word', difficulty: null, puzzleDate: session.puzzleDate, won, attemptsCount, rulesVersion: session.rulesVersion, completionType: won ? 'direct_win' : 'answer_revealed' }) : null
    const response: WordActionResponse = { result, session: await buildWordSnapshot(tx, updated), ...(reward ? { reward } : {}) }
    // Keep one append-only guess history. Copying it into every idempotency
    // response would make unlimited games consume quadratic permanent storage.
    const stored: StoredWordAction = { wordJournal: 1, guessCount: guesses.length, response: { ...response, session: { ...response.session, word: { ...response.session.word, guesses: [] } } } }
    await tx.insert(wordActions).values({ sessionId, idempotencyKey, action: body.action, requestSignature: signature, responseSnapshot: stored })
    return response
  })
}
