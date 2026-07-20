import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import type { DanetkiPayload } from '@shoditsa/contracts'
import {
  appSettings,
  backgroundJobs,
  contentItemVersions,
  danetkiAiCalls,
  danetkiFinalGuesses,
  danetkiInvites,
  danetkiMessages,
  danetkiSessionMembers,
  danetkiSessionState,
  gameSessions,
  type Database,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { loadIntegrationEnvironment } from '../admin/integration-secrets.js'
import { normalizeDanetkiQuestion, toPublicDanetka } from './service.js'
import { requestDanetkiAnswer, requestDanetkiGuessEvaluation } from './ai.js'

type Job = typeof backgroundJobs.$inferSelect
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''

const settingsFor = async (db: Database) => {
  const rows = await db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(inArray(appSettings.key, [
    'danetki.hostModel', 'danetki.promptVersion', 'danetki.contextMessages', 'danetki.maxOutputTokens', 'danetki.timeoutMs', 'danetki.retryCount',
  ]))
  const values = new Map(rows.map((row) => [row.key, row.value]))
  return {
    model: typeof values.get('danetki.hostModel') === 'string' ? String(values.get('danetki.hostModel')) : 'gpt-5-mini',
    promptVersion: typeof values.get('danetki.promptVersion') === 'string' ? String(values.get('danetki.promptVersion')) : 'danetki-host-v1',
    contextMessages: Math.max(10, Math.min(100, Number(values.get('danetki.contextMessages')) || 30)),
    maxOutputTokens: Math.max(100, Math.min(2_000, Number(values.get('danetki.maxOutputTokens')) || 800)),
    timeoutMs: Math.max(3_000, Math.min(60_000, Number(values.get('danetki.timeoutMs')) || 20_000)),
    retryCount: values.has('danetki.retryCount') ? Math.max(0, Math.min(3, Number(values.get('danetki.retryCount')) || 0)) : 1,
  }
}

const loadContext = async (tx: Transaction, sessionId: string) => {
  const session = (await tx.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.mode, 'danetki'))).limit(1))[0]
  const state = (await tx.select().from(danetkiSessionState).where(eq(danetkiSessionState.sessionId, sessionId)).for('update').limit(1))[0]
  if (!session || !state) throw new ApiError(404, 'DANETKI_SESSION_NOT_FOUND', 'Комната не найдена')
  const payload = (await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1))[0]?.payload
  toPublicDanetka(payload)
  return { session, state, puzzle: payload as DanetkiPayload }
}

const markError = async (db: Database, sessionId: string, input: { model: string; promptVersion: string; purpose: 'answer' | 'evaluate_guess'; triggerMessageId: string | null; error: unknown }) => {
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  await Promise.all([
    db.update(danetkiSessionState).set({ aiStatus: 'error', updatedAt: new Date() }).where(eq(danetkiSessionState.sessionId, sessionId)),
    db.insert(danetkiAiCalls).values({
      sessionId, triggerMessageId: input.triggerMessageId, purpose: input.purpose, model: input.model, promptVersion: input.promptVersion,
      status: 'error', errorCode: input.error instanceof ApiError ? input.error.code : 'OPENAI_REQUEST_FAILED', responseJson: { message: message.slice(0, 300) },
    }).onConflictDoNothing(),
  ])
}

const handleReply = async (db: Database, config: AppConfig, job: Job) => {
  const payload = record(job.payload)
  const sessionId = text(payload.sessionId); const messageId = text(payload.messageId)
  if (!sessionId || !messageId) throw new ApiError(422, 'DANETKI_JOB_INVALID', 'AI-задача не содержит sessionId/messageId')
  const [settings, environment] = await Promise.all([settingsFor(db), loadIntegrationEnvironment(db, config)])
  if (!environment.OPENAI_API_KEY) throw new ApiError(409, 'OPENAI_API_KEY_REQUIRED', 'OpenAI API key не настроен')
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`)
      const existing = await tx.select().from(danetkiMessages).where(and(eq(danetkiMessages.parentMessageId, messageId), eq(danetkiMessages.senderKind, 'ai'))).limit(1)
      if (existing[0]) return { messageId: existing[0].id, replayed: true }
      const { session, state, puzzle } = await loadContext(tx, sessionId)
      if (session.status !== 'playing') return { skipped: 'finished' }
      const question = (await tx.select().from(danetkiMessages).where(and(eq(danetkiMessages.id, messageId), eq(danetkiMessages.sessionId, sessionId), eq(danetkiMessages.messageType, 'question'))).limit(1))[0]
      if (!question) throw new ApiError(404, 'DANETKI_QUESTION_NOT_FOUND', 'Вопрос не найден')
      await tx.update(danetkiSessionState).set({ aiStatus: 'processing', updatedAt: new Date() }).where(eq(danetkiSessionState.sessionId, sessionId))

      const allMessages = await tx.select().from(danetkiMessages).where(eq(danetkiMessages.sessionId, sessionId)).orderBy(asc(danetkiMessages.seq))
      const normalized = normalizeDanetkiQuestion(question.text)
      const duplicate = [...allMessages].reverse().find((entry) => entry.id !== question.id && entry.messageType === 'question' && normalizeDanetkiQuestion(entry.text) === normalized)
      const reused = duplicate ? allMessages.find((entry) => entry.senderKind === 'ai' && entry.parentMessageId === duplicate.id) : null
      if (reused) {
        const answer = (await tx.insert(danetkiMessages).values({
          sessionId, seq: state.nextMessageSeq, senderKind: 'ai', messageType: 'answer', text: reused.text,
          classification: reused.classification, importance: reused.importance, parentMessageId: question.id,
        }).returning())[0]
        await tx.update(danetkiSessionState).set({ nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`, aiStatus: 'idle', updatedAt: new Date() }).where(eq(danetkiSessionState.sessionId, sessionId))
        return { messageId: answer.id, reusedQuestionId: duplicate!.id }
      }

      const recent = allMessages.slice(-settings.contextMessages).map((entry) => ({ senderKind: entry.senderKind, text: entry.text }))
      const call = (await tx.insert(danetkiAiCalls).values({ sessionId, triggerMessageId: question.id, purpose: 'answer', model: settings.model, promptVersion: settings.promptVersion }).returning())[0]
      const result = await requestDanetkiAnswer({
        apiKey: environment.OPENAI_API_KEY,
        proxyUrl: environment.OPENAI_OUTBOUND_PROXY_URL || environment.MUSIC_OUTBOUND_PROXY_URL,
        model: settings.model, promptVersion: settings.promptVersion, puzzle, question: question.text,
        revealedFactIds: state.revealedFactIds, summary: state.stateSummary, messages: recent,
        timeoutMs: settings.timeoutMs, retryCount: settings.retryCount, maxOutputTokens: settings.maxOutputTokens,
      })
      const revealedFactIds = [...new Set([...state.revealedFactIds, ...result.value.revealedFactIds])]
      const answer = (await tx.insert(danetkiMessages).values({
        sessionId, seq: state.nextMessageSeq, senderKind: 'ai', messageType: 'answer', text: result.value.answer,
        classification: result.value.classification, importance: result.value.importance, parentMessageId: question.id,
      }).returning())[0]
      await Promise.all([
        tx.update(danetkiSessionState).set({
          nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`, aiStatus: 'idle', revealedFactIds,
          stateSummary: result.value.shouldUpdateSummary ? `${state.stateSummary}\nQ: ${question.text}\nA: ${result.value.answer}`.trim().slice(-4_000) : state.stateSummary,
          updatedAt: new Date(),
        }).where(eq(danetkiSessionState.sessionId, sessionId)),
        tx.update(danetkiAiCalls).set({
          status: 'success', providerResponseId: result.responseId, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
          latencyMs: result.latencyMs, responseJson: result.value,
        }).where(eq(danetkiAiCalls.id, call.id)),
      ])
      return { messageId: answer.id, classification: result.value.classification }
    })
  } catch (error) {
    await markError(db, sessionId, { model: settings.model, promptVersion: settings.promptVersion, purpose: 'answer', triggerMessageId: messageId, error })
    throw error
  }
}

const handleGuess = async (db: Database, config: AppConfig, job: Job) => {
  const payload = record(job.payload)
  const sessionId = text(payload.sessionId); const guessId = text(payload.guessId); const messageId = text(payload.messageId)
  if (!sessionId || !guessId || !messageId) throw new ApiError(422, 'DANETKI_JOB_INVALID', 'Guess-задача содержит неполные данные')
  const [settings, environment] = await Promise.all([settingsFor(db), loadIntegrationEnvironment(db, config)])
  if (!environment.OPENAI_API_KEY) throw new ApiError(409, 'OPENAI_API_KEY_REQUIRED', 'OpenAI API key не настроен')
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`)
      const { session, state, puzzle } = await loadContext(tx, sessionId)
      const guess = (await tx.select().from(danetkiFinalGuesses).where(and(eq(danetkiFinalGuesses.id, guessId), eq(danetkiFinalGuesses.sessionId, sessionId))).for('update').limit(1))[0]
      if (!guess) throw new ApiError(404, 'DANETKI_GUESS_NOT_FOUND', 'Финальная версия не найдена')
      if (guess.status !== 'pending') return { status: guess.status, replayed: true }
      if (session.status !== 'playing') return { skipped: 'finished' }
      await tx.update(danetkiSessionState).set({ aiStatus: 'processing', updatedAt: new Date() }).where(eq(danetkiSessionState.sessionId, sessionId))
      const call = (await tx.insert(danetkiAiCalls).values({ sessionId, triggerMessageId: messageId, purpose: 'evaluate_guess', model: settings.model, promptVersion: settings.promptVersion }).returning())[0]
      const result = await requestDanetkiGuessEvaluation({
        apiKey: environment.OPENAI_API_KEY, proxyUrl: environment.OPENAI_OUTBOUND_PROXY_URL || environment.MUSIC_OUTBOUND_PROXY_URL,
        model: settings.model, promptVersion: settings.promptVersion, puzzle, guess: guess.text,
        timeoutMs: settings.timeoutMs, retryCount: settings.retryCount, maxOutputTokens: settings.maxOutputTokens,
      })
      const factIds = new Set(puzzle.keyFacts.map((fact) => fact.id))
      const matched = [...new Set(result.value.matchedFactIds.filter((id) => factIds.has(id)))]
      const required = [...new Set(puzzle.answerRules.requiredFactIds)]
      const missingRequired = required.filter((id) => !matched.includes(id))
      const isCorrect = missingRequired.length === 0 && result.value.coverage >= puzzle.answerRules.minCoverage
      const evaluation = { ...result.value, isCorrect, matchedFactIds: matched, missingRequiredFactIds: missingRequired }
      const feedback = (await tx.insert(danetkiMessages).values({
        sessionId, seq: state.nextMessageSeq, senderKind: 'ai', messageType: 'answer', text: result.value.feedback,
        parentMessageId: messageId, importance: isCorrect ? 'critical' : 'neutral',
      }).returning())[0]
      let increment = 1
      if (isCorrect) {
        await tx.insert(danetkiMessages).values({ sessionId, seq: state.nextMessageSeq + 1, senderKind: 'system', messageType: 'solution', text: puzzle.solution })
        increment = 2
      }
      const now = new Date()
      await Promise.all([
        tx.update(danetkiFinalGuesses).set({ status: isCorrect ? 'correct' : 'incorrect', evaluation }).where(eq(danetkiFinalGuesses.id, guess.id)),
        tx.update(danetkiSessionState).set({ nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + ${increment}`, aiStatus: 'idle', updatedAt: now }).where(eq(danetkiSessionState.sessionId, sessionId)),
        tx.update(danetkiAiCalls).set({ status: 'success', providerResponseId: result.responseId, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, latencyMs: result.latencyMs, responseJson: evaluation }).where(eq(danetkiAiCalls.id, call.id)),
        ...(isCorrect ? [
          tx.update(gameSessions).set({ status: 'won', completedAt: now, updatedAt: now }).where(eq(gameSessions.id, sessionId)),
          tx.update(danetkiInvites).set({ revokedAt: now }).where(and(eq(danetkiInvites.sessionId, sessionId), isNull(danetkiInvites.revokedAt))),
        ] : []),
      ])
      return { messageId: feedback.id, status: isCorrect ? 'correct' : 'incorrect', coverage: evaluation.coverage }
    })
  } catch (error) {
    await markError(db, sessionId, { model: settings.model, promptVersion: settings.promptVersion, purpose: 'evaluate_guess', triggerMessageId: messageId, error })
    throw error
  }
}

export const handleDanetkiJob = async (db: Database, config: AppConfig, job: Job) => {
  if (job.type === 'danetki_ai_reply') return handleReply(db, config, job)
  if (job.type === 'danetki_guess_evaluate') return handleGuess(db, config, job)
  if (job.type === 'danetki_room_expire') {
    const sessionId = text(record(job.payload).sessionId)
    if (!sessionId) throw new ApiError(422, 'DANETKI_JOB_INVALID', 'Expiry-задача не содержит sessionId')
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`)
      const session = (await tx.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.mode, 'danetki'))).for('update').limit(1))[0]
      if (!session || session.status !== 'playing') return { skipped: 'finished-or-missing' }
      const active = await tx.select({ value: count() }).from(danetkiSessionMembers).where(and(eq(danetkiSessionMembers.sessionId, sessionId), isNull(danetkiSessionMembers.leftAt)))
      if (Number(active[0]?.value ?? 0) > 0) return { skipped: 'room-is-active' }
      const now = new Date()
      await Promise.all([
        tx.update(gameSessions).set({ status: 'lost', completedAt: now, updatedAt: now }).where(eq(gameSessions.id, sessionId)),
        tx.update(danetkiSessionState).set({ aiStatus: 'idle', updatedAt: now }).where(eq(danetkiSessionState.sessionId, sessionId)),
        tx.update(danetkiInvites).set({ revokedAt: now }).where(and(eq(danetkiInvites.sessionId, sessionId), isNull(danetkiInvites.revokedAt))),
      ])
      return { expired: true, sessionId }
    })
  }
  throw new ApiError(422, 'DANETKI_JOB_UNSUPPORTED', `Unsupported Danetki job: ${job.type}`)
}
