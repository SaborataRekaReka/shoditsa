import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import type { DanetkiPayload } from '@shoditsa/contracts'
import {
  appSettings,
  backgroundJobs,
  contentItemVersions,
  danetkiAiCallAttempts,
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
import { completeDanetkiDaily } from '../stats/rewards.js'
import { requestDanetkiAnswer, requestDanetkiGuessEvaluation } from './ai.js'
import { completeDanetkiParticipantStats, normalizeDanetkiQuestion, toPublicDanetka } from './service.js'

type Job = typeof backgroundJobs.$inferSelect
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type AiPurpose = 'answer' | 'evaluate_guess'
type AttemptRef = { callId: string; attemptId: string }

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
  const session = (await tx.select().from(gameSessions).where(and(
    eq(gameSessions.id, sessionId),
    eq(gameSessions.mode, 'danetki'),
  )).limit(1))[0]
  const state = (await tx.select().from(danetkiSessionState)
    .where(eq(danetkiSessionState.sessionId, sessionId)).for('update').limit(1))[0]
  if (!session || !state) throw new ApiError(404, 'DANETKI_SESSION_NOT_FOUND', 'Комната не найдена')
  const payload = (await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions)
    .where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1))[0]?.payload
  toPublicDanetka(payload)
  return { session, state, puzzle: payload as DanetkiPayload }
}

/**
 * A danetki_ai_calls row is the idempotent logical request. Every execution is
 * appended to danetki_ai_call_attempts, so a provider failure can be retried
 * without colliding with the logical request's unique key.
 */
export const beginDanetkiAiAttempt = async (
  tx: Transaction,
  job: Job,
  input: { sessionId: string; triggerMessageId: string; purpose: AiPurpose; model: string; promptVersion: string },
): Promise<AttemptRef> => {
  let call = (await tx.select().from(danetkiAiCalls).where(and(
    eq(danetkiAiCalls.triggerMessageId, input.triggerMessageId),
    eq(danetkiAiCalls.purpose, input.purpose),
  )).for('update').limit(1))[0]
  if (!call) {
    call = (await tx.insert(danetkiAiCalls).values({
      sessionId: input.sessionId,
      triggerMessageId: input.triggerMessageId,
      purpose: input.purpose,
      model: input.model,
      promptVersion: input.promptVersion,
    }).onConflictDoNothing().returning())[0]
      ?? (await tx.select().from(danetkiAiCalls).where(and(
        eq(danetkiAiCalls.triggerMessageId, input.triggerMessageId),
        eq(danetkiAiCalls.purpose, input.purpose),
      )).for('update').limit(1))[0]
  }
  if (!call) throw new Error('Failed to claim Danetki AI call')
  const countRow = (await tx.select({
    value: sql<number>`coalesce(max(${danetkiAiCallAttempts.attemptNumber}), 0)::int`,
  }).from(danetkiAiCallAttempts).where(eq(danetkiAiCallAttempts.callId, call.id)))[0]
  const attempt = (await tx.insert(danetkiAiCallAttempts).values({
    callId: call.id,
    jobId: job.id,
    attemptNumber: Number(countRow?.value ?? 0) + 1,
    model: input.model,
    promptVersion: input.promptVersion,
  }).returning({ id: danetkiAiCallAttempts.id }))[0]
  await tx.update(danetkiAiCalls).set({
    status: 'pending',
    model: input.model,
    promptVersion: input.promptVersion,
    errorCode: null,
    responseJson: null,
    updatedAt: new Date(),
  }).where(eq(danetkiAiCalls.id, call.id))
  return { callId: call.id, attemptId: attempt.id }
}

export const markDanetkiAiAttemptError = async (db: Database, sessionId: string, attempt: AttemptRef | null, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const now = new Date()
  const errorCode = error instanceof ApiError ? error.code : 'OPENAI_REQUEST_FAILED'
  await db.transaction(async (tx) => {
    await tx.update(danetkiSessionState).set({ aiStatus: 'error', updatedAt: now })
      .where(eq(danetkiSessionState.sessionId, sessionId))
    if (!attempt) return
    await Promise.all([
      tx.update(danetkiAiCalls).set({
        status: 'error',
        errorCode,
        responseJson: { message: message.slice(0, 300) },
        updatedAt: now,
      }).where(eq(danetkiAiCalls.id, attempt.callId)),
      tx.update(danetkiAiCallAttempts).set({
        status: 'error',
        errorCode,
        responseJson: { message: message.slice(0, 300) },
        finishedAt: now,
      }).where(eq(danetkiAiCallAttempts.id, attempt.attemptId)),
    ])
  })
}

const markSuccess = async (
  tx: Transaction,
  attempt: AttemptRef,
  result: { responseId: string | null; usage: { inputTokens: number | null; outputTokens: number | null }; latencyMs: number },
  responseJson: unknown,
) => {
  const now = new Date()
  await Promise.all([
    tx.update(danetkiAiCalls).set({
      status: 'success',
      providerResponseId: result.responseId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.latencyMs,
      errorCode: null,
      responseJson,
      updatedAt: now,
    }).where(eq(danetkiAiCalls.id, attempt.callId)),
    tx.update(danetkiAiCallAttempts).set({
      status: 'success',
      providerResponseId: result.responseId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.latencyMs,
      errorCode: null,
      responseJson,
      finishedAt: now,
    }).where(eq(danetkiAiCallAttempts.id, attempt.attemptId)),
  ])
}

const handleReply = async (db: Database, config: AppConfig, job: Job) => {
  const payload = record(job.payload)
  const sessionId = text(payload.sessionId)
  const messageId = text(payload.messageId)
  if (!sessionId || !messageId) throw new ApiError(422, 'DANETKI_JOB_INVALID', 'AI-задача не содержит sessionId/messageId')
  const [settings, environment] = await Promise.all([settingsFor(db), loadIntegrationEnvironment(db, config)])
  if (!environment.OPENAI_API_KEY) throw new ApiError(409, 'OPENAI_API_KEY_REQUIRED', 'OpenAI API key не настроен')
  let attempt: AttemptRef | null = null
  try {
    const prepared = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`)
      const existing = await tx.select().from(danetkiMessages).where(and(
        eq(danetkiMessages.parentMessageId, messageId),
        eq(danetkiMessages.senderKind, 'ai'),
      )).limit(1)
      if (existing[0]) return { kind: 'done' as const, value: { messageId: existing[0].id, replayed: true } }
      const { session, state, puzzle } = await loadContext(tx, sessionId)
      if (session.status !== 'playing') return { kind: 'done' as const, value: { skipped: 'finished' } }
      const question = (await tx.select().from(danetkiMessages).where(and(
        eq(danetkiMessages.id, messageId),
        eq(danetkiMessages.sessionId, sessionId),
        eq(danetkiMessages.messageType, 'question'),
      )).limit(1))[0]
      if (!question) throw new ApiError(404, 'DANETKI_QUESTION_NOT_FOUND', 'Вопрос не найден')
      const allMessages = await tx.select().from(danetkiMessages)
        .where(eq(danetkiMessages.sessionId, sessionId)).orderBy(asc(danetkiMessages.seq))
      const normalized = normalizeDanetkiQuestion(question.text)
      const duplicate = [...allMessages].reverse().find((entry) => (
        entry.id !== question.id
        && entry.messageType === 'question'
        && normalizeDanetkiQuestion(entry.text) === normalized
      ))
      const reused = duplicate ? allMessages.find((entry) => entry.senderKind === 'ai' && entry.parentMessageId === duplicate.id) : null
      if (reused) {
        const answer = (await tx.insert(danetkiMessages).values({
          sessionId,
          seq: state.nextMessageSeq,
          senderKind: 'ai',
          messageType: 'answer',
          text: reused.text,
          classification: reused.classification,
          importance: reused.importance,
          parentMessageId: question.id,
        }).returning())[0]
        await tx.update(danetkiSessionState).set({
          nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`,
          aiStatus: 'idle',
          updatedAt: new Date(),
        }).where(eq(danetkiSessionState.sessionId, sessionId))
        return { kind: 'done' as const, value: { messageId: answer.id, reusedQuestionId: duplicate!.id } }
      }
      await tx.update(danetkiSessionState).set({ aiStatus: 'processing', updatedAt: new Date() })
        .where(eq(danetkiSessionState.sessionId, sessionId))
      const claimed = await beginDanetkiAiAttempt(tx, job, {
        sessionId,
        triggerMessageId: question.id,
        purpose: 'answer',
        model: settings.model,
        promptVersion: settings.promptVersion,
      })
      return {
        kind: 'call' as const,
        attempt: claimed,
        puzzle,
        question: { id: question.id, text: question.text },
        revealedFactIds: state.revealedFactIds,
        summary: state.stateSummary,
        messages: allMessages.slice(-settings.contextMessages).map((entry) => ({ senderKind: entry.senderKind, text: entry.text })),
      }
    })
    if (prepared.kind === 'done') return prepared.value
    attempt = prepared.attempt
    // Provider I/O intentionally happens outside a PostgreSQL transaction.
    const result = await requestDanetkiAnswer({
      apiKey: environment.OPENAI_API_KEY,
      proxyUrl: environment.MUSIC_OUTBOUND_PROXY_URL,
      model: settings.model,
      promptVersion: settings.promptVersion,
      puzzle: prepared.puzzle,
      question: prepared.question.text,
      revealedFactIds: prepared.revealedFactIds,
      summary: prepared.summary,
      messages: prepared.messages,
      timeoutMs: settings.timeoutMs,
      retryCount: settings.retryCount,
      maxOutputTokens: settings.maxOutputTokens,
    })
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`)
      const existing = (await tx.select().from(danetkiMessages).where(and(
        eq(danetkiMessages.parentMessageId, prepared.question.id),
        eq(danetkiMessages.senderKind, 'ai'),
      )).limit(1))[0]
      if (existing) {
        await markSuccess(tx, prepared.attempt, result, { ...result.value, replayed: true })
        await tx.update(danetkiSessionState).set({ aiStatus: 'idle', updatedAt: new Date() })
          .where(eq(danetkiSessionState.sessionId, sessionId))
        return { messageId: existing.id, replayed: true }
      }
      const state = (await tx.select().from(danetkiSessionState)
        .where(eq(danetkiSessionState.sessionId, sessionId)).for('update').limit(1))[0]
      if (!state) throw new ApiError(404, 'DANETKI_SESSION_NOT_FOUND', 'Комната не найдена')
      const revealedFactIds = [...new Set([...state.revealedFactIds, ...result.value.revealedFactIds])]
      const answer = (await tx.insert(danetkiMessages).values({
        sessionId,
        seq: state.nextMessageSeq,
        senderKind: 'ai',
        messageType: 'answer',
        text: result.value.answer,
        classification: result.value.classification,
        importance: result.value.importance,
        parentMessageId: prepared.question.id,
      }).returning())[0]
      await Promise.all([
        tx.update(danetkiSessionState).set({
          nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + 1`,
          aiStatus: 'idle',
          revealedFactIds,
          stateSummary: result.value.shouldUpdateSummary
            ? `${state.stateSummary}\nQ: ${prepared.question.text}\nA: ${result.value.answer}`.trim().slice(-4_000)
            : state.stateSummary,
          updatedAt: new Date(),
        }).where(eq(danetkiSessionState.sessionId, sessionId)),
        markSuccess(tx, prepared.attempt, result, result.value),
      ])
      return { messageId: answer.id, classification: result.value.classification }
    })
  } catch (error) {
    await markDanetkiAiAttemptError(db, sessionId, attempt, error)
    throw error
  }
}

const handleGuess = async (db: Database, config: AppConfig, job: Job) => {
  const payload = record(job.payload)
  const sessionId = text(payload.sessionId)
  const guessId = text(payload.guessId)
  const messageId = text(payload.messageId)
  if (!sessionId || !guessId || !messageId) throw new ApiError(422, 'DANETKI_JOB_INVALID', 'Guess-задача содержит неполные данные')
  const [settings, environment] = await Promise.all([settingsFor(db), loadIntegrationEnvironment(db, config)])
  if (!environment.OPENAI_API_KEY) throw new ApiError(409, 'OPENAI_API_KEY_REQUIRED', 'OpenAI API key не настроен')
  let attempt: AttemptRef | null = null
  try {
    const prepared = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`)
      const { session, puzzle } = await loadContext(tx, sessionId)
      const guess = (await tx.select().from(danetkiFinalGuesses).where(and(
        eq(danetkiFinalGuesses.id, guessId),
        eq(danetkiFinalGuesses.sessionId, sessionId),
      )).for('update').limit(1))[0]
      if (!guess) throw new ApiError(404, 'DANETKI_GUESS_NOT_FOUND', 'Финальная версия не найдена')
      if (guess.status !== 'pending') return { kind: 'done' as const, value: { status: guess.status, replayed: true } }
      if (session.status !== 'playing') return { kind: 'done' as const, value: { skipped: 'finished' } }
      await tx.update(danetkiSessionState).set({ aiStatus: 'processing', updatedAt: new Date() })
        .where(eq(danetkiSessionState.sessionId, sessionId))
      const claimed = await beginDanetkiAiAttempt(tx, job, {
        sessionId,
        triggerMessageId: messageId,
        purpose: 'evaluate_guess',
        model: settings.model,
        promptVersion: settings.promptVersion,
      })
      return { kind: 'call' as const, attempt: claimed, puzzle, guess: { id: guess.id, text: guess.text } }
    })
    if (prepared.kind === 'done') return prepared.value
    attempt = prepared.attempt
    // Provider I/O intentionally happens outside a PostgreSQL transaction.
    const result = await requestDanetkiGuessEvaluation({
      apiKey: environment.OPENAI_API_KEY,
      proxyUrl: environment.MUSIC_OUTBOUND_PROXY_URL,
      model: settings.model,
      promptVersion: settings.promptVersion,
      puzzle: prepared.puzzle,
      guess: prepared.guess.text,
      timeoutMs: settings.timeoutMs,
      retryCount: settings.retryCount,
      maxOutputTokens: settings.maxOutputTokens,
    })
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`)
      const guess = (await tx.select().from(danetkiFinalGuesses)
        .where(eq(danetkiFinalGuesses.id, prepared.guess.id)).for('update').limit(1))[0]
      if (!guess) throw new ApiError(404, 'DANETKI_GUESS_NOT_FOUND', 'Финальная версия не найдена')
      if (guess.status !== 'pending') {
        await markSuccess(tx, prepared.attempt, result, { ...result.value, replayed: true })
        await tx.update(danetkiSessionState).set({ aiStatus: 'idle', updatedAt: new Date() })
          .where(eq(danetkiSessionState.sessionId, sessionId))
        return { status: guess.status, replayed: true }
      }
      const state = (await tx.select().from(danetkiSessionState)
        .where(eq(danetkiSessionState.sessionId, sessionId)).for('update').limit(1))[0]
      const session = (await tx.select().from(gameSessions)
        .where(eq(gameSessions.id, sessionId)).for('update').limit(1))[0]
      if (!state || !session) throw new ApiError(404, 'DANETKI_SESSION_NOT_FOUND', 'Комната не найдена')
      const factIds = new Set(prepared.puzzle.keyFacts.map((fact) => fact.id))
      const matched = [...new Set(result.value.matchedFactIds.filter((id) => factIds.has(id)))]
      const required = [...new Set(prepared.puzzle.answerRules.requiredFactIds)]
      const missingRequired = required.filter((id) => !matched.includes(id))
      const isCorrect = missingRequired.length === 0 && result.value.coverage >= prepared.puzzle.answerRules.minCoverage
      const evaluation = { ...result.value, isCorrect, matchedFactIds: matched, missingRequiredFactIds: missingRequired }
      const feedback = (await tx.insert(danetkiMessages).values({
        sessionId,
        seq: state.nextMessageSeq,
        senderKind: 'ai',
        messageType: 'answer',
        text: result.value.feedback,
        parentMessageId: messageId,
        importance: isCorrect ? 'critical' : 'neutral',
      }).returning())[0]
      let increment = 1
      if (isCorrect) {
        await tx.insert(danetkiMessages).values({
          sessionId,
          seq: state.nextMessageSeq + 1,
          senderKind: 'system',
          messageType: 'solution',
          text: prepared.puzzle.solution,
        })
        increment = 2
      }
      const now = new Date()
      if (isCorrect) await completeDanetkiParticipantStats(tx, sessionId, true)
      const reward = isCorrect && session.kind === 'daily' ? await completeDanetkiDaily(tx, {
        sessionId,
        userId: session.userId,
        puzzleDate: session.puzzleDate,
        won: true,
        rulesVersion: session.rulesVersion,
      }) : null
      await Promise.all([
        tx.update(danetkiFinalGuesses).set({
          status: isCorrect ? 'correct' : 'incorrect',
          evaluation,
        }).where(eq(danetkiFinalGuesses.id, guess.id)),
        tx.update(danetkiSessionState).set({
          nextMessageSeq: sql`${danetkiSessionState.nextMessageSeq} + ${increment}`,
          aiStatus: 'idle',
          updatedAt: now,
        }).where(eq(danetkiSessionState.sessionId, sessionId)),
        markSuccess(tx, prepared.attempt, result, evaluation),
        ...(isCorrect ? [
          tx.update(gameSessions).set({
            status: 'won',
            completedAt: now,
            updatedAt: now,
            rewardLedgerId: reward?.ledgerId ?? null,
          }).where(eq(gameSessions.id, sessionId)),
          tx.update(danetkiInvites).set({ revokedAt: now }).where(and(
            eq(danetkiInvites.sessionId, sessionId),
            isNull(danetkiInvites.revokedAt),
          )),
        ] : []),
      ])
      return { messageId: feedback.id, status: isCorrect ? 'correct' : 'incorrect', coverage: evaluation.coverage }
    })
  } catch (error) {
    await markDanetkiAiAttemptError(db, sessionId, attempt, error)
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
      const session = (await tx.select().from(gameSessions).where(and(
        eq(gameSessions.id, sessionId),
        eq(gameSessions.mode, 'danetki'),
      )).for('update').limit(1))[0]
      if (!session || session.status !== 'playing') return { skipped: 'finished-or-missing' }
      const active = await tx.select({ value: count() }).from(danetkiSessionMembers).where(and(
        eq(danetkiSessionMembers.sessionId, sessionId),
        isNull(danetkiSessionMembers.leftAt),
      ))
      if (Number(active[0]?.value ?? 0) > 0) return { skipped: 'room-is-active' }
      const now = new Date()
      await Promise.all([
        tx.update(gameSessions).set({ status: 'expired', completedAt: now, updatedAt: now }).where(eq(gameSessions.id, sessionId)),
        tx.update(danetkiSessionState).set({ aiStatus: 'idle', updatedAt: now }).where(eq(danetkiSessionState.sessionId, sessionId)),
        tx.update(danetkiInvites).set({ revokedAt: now }).where(and(
          eq(danetkiInvites.sessionId, sessionId),
          isNull(danetkiInvites.revokedAt),
        )),
      ])
      return { expired: true, sessionId }
    })
  }
  throw new ApiError(422, 'DANETKI_JOB_UNSUPPORTED', `Unsupported Danetki job: ${job.type}`)
}
