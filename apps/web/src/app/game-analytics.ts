import { trackMetrikaGoal } from './metrics'
import { trackDiagnosisGoal } from './diagnosis-analytics'

const startedSessions = new Set<string>()
const completedSessions = new Set<string>()

export const trackGameStartOnce = (sessionKey: string, meta: Record<string, unknown>) => {
  if (startedSessions.has(sessionKey)) return
  startedSessions.add(sessionKey)
  trackMetrikaGoal('game_session_start', meta)
  if (meta.mode === 'diagnosis') {
    trackDiagnosisGoal('start', { ...meta, sessionId: sessionKey })
  }
}

export const trackGameCompleteOnce = (sessionKey: string, meta: Record<string, unknown>) => {
  if (completedSessions.has(sessionKey)) return
  completedSessions.add(sessionKey)
  trackMetrikaGoal('game_session_complete', meta)
  if (meta.mode === 'diagnosis') {
    trackDiagnosisGoal('complete', { ...meta, sessionId: sessionKey })
  }
}

export const trackNextGameStart = (fromMode: string, toMode: string, meta?: Record<string, unknown>) => {
  const payload = { from_mode: fromMode, to_mode: toMode, ...(meta ?? {}) }
  trackMetrikaGoal('game_next_start', payload)
  if (fromMode === 'diagnosis') trackDiagnosisGoal('nextGame', payload)
}
