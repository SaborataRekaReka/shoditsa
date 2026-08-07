import { trackMetrikaGoal } from './metrics'

const startedSessions = new Set<string>()
const completedSessions = new Set<string>()

export const trackGameStartOnce = (sessionKey: string, meta: Record<string, unknown>) => {
  if (startedSessions.has(sessionKey)) return
  startedSessions.add(sessionKey)
  trackMetrikaGoal('game_session_start', meta)
}

export const trackGameCompleteOnce = (sessionKey: string, meta: Record<string, unknown>) => {
  if (completedSessions.has(sessionKey)) return
  completedSessions.add(sessionKey)
  trackMetrikaGoal('game_session_complete', meta)
}

export const trackNextGameStart = (fromMode: string, toMode: string, meta?: Record<string, unknown>) => {
  trackMetrikaGoal('game_next_start', { from_mode: fromMode, to_mode: toMode, ...(meta ?? {}) })
}
