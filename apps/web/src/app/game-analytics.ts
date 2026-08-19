import { deterministicClientEventId, trackClientEvent } from './client-events'
import { trackMetrikaGoal } from './metrics'
import { trackDiagnosisGoal } from './diagnosis-analytics'

const startedSessions = new Set<string>()
const completedSessions = new Set<string>()
const NEXT_GAME_TRANSITION_KEY = 'shoditsa:next-game-transition:v1'
const NEXT_GAME_TRANSITION_TTL_MS = 15 * 60_000

type Primitive = string | number | boolean | null
type PendingNextGameTransition = {
  id: string
  fromMode: string
  toMode: string
  clickedAt: number
  meta: Record<string, Primitive>
}

type GameLifecycleOptions = {
  serverSession?: boolean
  metrika?: boolean
}

const primitiveMeta = (meta?: Record<string, unknown>): Record<string, Primitive> => Object.fromEntries(
  Object.entries(meta ?? {}).filter((entry): entry is [string, Primitive] => {
    const value = entry[1]
    return value === null || ['string', 'number', 'boolean'].includes(typeof value)
  }),
)

const transitionStorage = () => {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage } catch { return null }
}

const rememberNextGameTransition = (transition: PendingNextGameTransition) => {
  try { transitionStorage()?.setItem(NEXT_GAME_TRANSITION_KEY, JSON.stringify(transition)) } catch { /* optional attribution only */ }
}

const consumeNextGameTransition = (toMode: string): PendingNextGameTransition | null => {
  const storage = transitionStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(NEXT_GAME_TRANSITION_KEY)
    if (!raw) return null
    storage.removeItem(NEXT_GAME_TRANSITION_KEY)
    const parsed = JSON.parse(raw) as Partial<PendingNextGameTransition>
    if (!parsed.id || !parsed.fromMode || !parsed.toMode || typeof parsed.clickedAt !== 'number') return null
    if (parsed.toMode !== toMode || Date.now() - parsed.clickedAt > NEXT_GAME_TRANSITION_TTL_MS) return null
    return {
      id: parsed.id,
      fromMode: parsed.fromMode,
      toMode: parsed.toMode,
      clickedAt: parsed.clickedAt,
      meta: primitiveMeta(parsed.meta),
    }
  } catch {
    storage.removeItem(NEXT_GAME_TRANSITION_KEY)
    return null
  }
}

export const trackServerGameCompleteObserved = (sessionKey: string, meta: Record<string, unknown>) => {
  trackClientEvent('game_session_complete', primitiveMeta(meta), {
    eventId: deterministicClientEventId(sessionKey, 'game_session_complete'),
    gameSessionId: sessionKey,
  })
}

export const trackGameStartOnce = (sessionKey: string, meta: Record<string, unknown>, options: GameLifecycleOptions = {}) => {
  if (startedSessions.has(sessionKey)) return
  startedSessions.add(sessionKey)
  if (options.metrika !== false) trackMetrikaGoal('game_session_start', meta)
  if (options.metrika !== false && meta.mode === 'diagnosis') {
    trackDiagnosisGoal('start', { ...meta, sessionId: sessionKey })
  }
  if (!options.serverSession) return

  trackClientEvent('game_session_start', primitiveMeta(meta), {
    eventId: deterministicClientEventId(sessionKey, 'game_session_start'),
    gameSessionId: sessionKey,
  })
  const mode = typeof meta.mode === 'string' ? meta.mode : ''
  const transition = consumeNextGameTransition(mode)
  if (!transition) return
  const payload = {
    ...transition.meta,
    from_mode: transition.fromMode,
    to_mode: transition.toMode,
    transition_id: transition.id,
    click_to_start_ms: Math.max(0, Date.now() - transition.clickedAt),
  }
  trackMetrikaGoal('game_next_start', payload)
  trackClientEvent('game_next_start', payload, {
    eventId: deterministicClientEventId(sessionKey, 'game_next_start'),
    gameSessionId: sessionKey,
  })
}

export const trackConfirmedServerStart = (sessionKey: string, meta: Record<string, unknown>) => (
  trackGameStartOnce(sessionKey, meta, { serverSession: true })
)

export const trackObservedServerStart = (sessionKey: string, meta: Record<string, unknown>) => (
  trackGameStartOnce(sessionKey, meta, { serverSession: true, metrika: false })
)

export const trackGameCompleteOnce = (sessionKey: string, meta: Record<string, unknown>, options: GameLifecycleOptions = {}) => {
  if (completedSessions.has(sessionKey)) return
  completedSessions.add(sessionKey)
  trackMetrikaGoal('game_session_complete', meta)
  if (meta.mode === 'diagnosis') {
    trackDiagnosisGoal('complete', { ...meta, sessionId: sessionKey })
  }
  if (options.serverSession) trackServerGameCompleteObserved(sessionKey, meta)
}

export const trackNextGameClick = (fromMode: string, toMode: string, meta?: Record<string, unknown>) => {
  const transition: PendingNextGameTransition = {
    id: crypto.randomUUID(),
    fromMode,
    toMode,
    clickedAt: Date.now(),
    meta: primitiveMeta(meta),
  }
  rememberNextGameTransition(transition)
  const payload = {
    ...transition.meta,
    from_mode: fromMode,
    to_mode: toMode,
    transition_id: transition.id,
  }
  trackMetrikaGoal('game_next_clicked', payload)
  trackClientEvent('game_next_clicked', payload, { eventId: transition.id })
  if (fromMode === 'diagnosis') trackDiagnosisGoal('nextGame', payload)
  return transition.id
}

/** @deprecated The action records a click; game_next_start is emitted after a matching server session exists. */
export const trackNextGameStart = trackNextGameClick
