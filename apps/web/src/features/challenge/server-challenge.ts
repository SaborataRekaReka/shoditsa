import { GAME_MODE_MANIFEST, isCatalogGuessModeId, isPlayableModeId, type GameSessionSnapshot } from '@shoditsa/contracts'
import { challengeOutcome, parseChallengeUrl, buildChallengeUrl, type ChallengePayload, type ChallengeResult } from './challenge'

export type ChallengeSession = Pick<GameSessionSnapshot,
  'id' | 'kind' | 'mode' | 'packId' | 'period' | 'difficulty' | 'variantKey' | 'puzzleDate' | 'status' | 'completionType' | 'attemptsCount' | 'maxAttempts'>

export type ServerChallengeContext = {
  sessionId: string
  challenge: Omit<ChallengePayload, 'from'>
  /** Allows the UI to distinguish joining an unfinished game from comparing an old result. */
  joinedWhilePlaying: boolean
}

type ChallengeStorage = Pick<Storage, 'getItem' | 'setItem'>
const STORAGE_KEY = 'shoditsa:challenge-game:v1'
const memoryContexts = new Map<string, ServerChallengeContext>()

const sessionStorageIfAvailable = (): ChallengeStorage | null => {
  try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null }
}

export const canShareExactChallenge = (session: ChallengeSession) => (
  isPlayableModeId(session.mode) && isCatalogGuessModeId(session.mode)
  && (session.kind === 'daily' || session.kind === 'archive') && !session.packId
  && (session.maxAttempts === undefined || session.maxAttempts === 10)
  && (!session.variantKey || session.variantKey === '-' || (session.mode === 'city'
    && (GAME_MODE_MANIFEST.city.variants as readonly { id: string }[]).some((variant) => variant.id === session.variantKey))
    || (session.mode === 'music' && session.variantKey === session.difficulty))
)

export const isMatchingChallengeSession = (challenge: ChallengePayload, session: ChallengeSession) => {
  if (!canShareExactChallenge(session) || session.mode !== challenge.mode || session.puzzleDate !== challenge.date) return false
  const period = GAME_MODE_MANIFEST[challenge.mode].periodPolicy === 'year' ? challenge.period : 'all'
  const difficulty = challenge.mode === 'music' ? challenge.difficulty ?? 'medium' : null
  const variant = challenge.mode === 'city' ? challenge.variantKey ?? 'capitals' : null
  const sessionVariant = session.variantKey === '-' || session.mode === 'music' ? null : session.variantKey
  return session.period === period && session.difficulty === difficulty && sessionVariant === variant
}

/** The recipient's result is derived exclusively from a final server snapshot. */
export const serverChallengeResult = (session: ChallengeSession): ChallengeResult | null => {
  if (session.status === 'lost' || session.status === 'expired') return 'x'
  if (session.status !== 'won') return null
  if (session.completionType === 'final_choice_win') return 'f'
  return Number.isInteger(session.attemptsCount) && session.attemptsCount >= 1 && session.attemptsCount <= 10
    ? session.attemptsCount : null
}

const sanitizedChallenge = (challenge: ChallengePayload) => parseChallengeUrl(buildChallengeUrl('https://shoditsa.ru', challenge))

const storedContexts = (storage: ChallengeStorage | null): ServerChallengeContext[] => {
  try {
    const entries: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(entries)) return []
    return entries.slice(-16).flatMap((entry) => {
      if (!entry || typeof entry.sessionId !== 'string' || typeof entry.joinedWhilePlaying !== 'boolean' || !entry.challenge) return []
      try {
        const challenge = sanitizedChallenge(entry.challenge as ChallengePayload)
        return challenge ? [{ sessionId: entry.sessionId, challenge, joinedWhilePlaying: entry.joinedWhilePlaying }] : []
      } catch { return [] }
    })
  } catch { return [] }
}

export const readServerChallenge = (session: ChallengeSession, storage: ChallengeStorage | null = sessionStorageIfAvailable()): ServerChallengeContext | null => {
  const context = memoryContexts.get(session.id) ?? storedContexts(storage).find((entry) => entry.sessionId === session.id)
  return context && isMatchingChallengeSession(context.challenge, session) ? context : null
}

/**
 * Functional, tab-scoped game state: restore the invited puzzle/result comparison
 * after reload. No sender ID, acquisition ID, analytics visit ID or tracking marker
 * is stored here. The recipient's server session ID is needed to avoid comparing
 * a different game. Storage failure must never prevent the game from working.
 */
export const rememberServerChallenge = (challenge: ChallengePayload, session: ChallengeSession, storage: ChallengeStorage | null = sessionStorageIfAvailable()): ServerChallengeContext | null => {
  const clean = sanitizedChallenge(challenge)
  if (!clean || !isMatchingChallengeSession(clean, session)) return null
  const previous = readServerChallenge(session, storage)
  const context: ServerChallengeContext = {
    sessionId: session.id,
    challenge: clean,
    joinedWhilePlaying: previous?.joinedWhilePlaying || session.status === 'playing' || session.status === 'final_choice',
  }
  memoryContexts.set(session.id, context)
  if (memoryContexts.size > 16) memoryContexts.delete(memoryContexts.keys().next().value!)
  try {
    const other = storedContexts(storage).filter((entry) => entry.sessionId !== session.id)
    storage?.setItem(STORAGE_KEY, JSON.stringify([...other, context].slice(-16)))
  } catch { /* retain the comparison in memory for this game */ }
  return context
}

export const serverChallengeComparison = (session: ChallengeSession, context: ServerChallengeContext | null) => {
  if (!context || context.sessionId !== session.id || !isMatchingChallengeSession(context.challenge, session)) return null
  const result = serverChallengeResult(session)
  return result === null ? null : {
    challengeOutcome: challengeOutcome(result, context.challenge.opponentAttempts),
    opponentAttempts: context.challenge.opponentAttempts,
    playerAttempts: result,
    previouslyCompleted: !context.joinedWhilePlaying,
  }
}
