import { trackMetrikaGoal } from './metrics'

export const DIAGNOSIS_METRIKA_GOALS = {
  start: 'diagnosis_start',
  attempt: 'diagnosis_attempt',
  complete: 'diagnosis_complete',
  win: 'diagnosis_win',
  result: 'diagnosis_result',
  nextGame: 'diagnosis_next_game',
  save: 'diagnosis_save',
  archive: 'diagnosis_archive',
  share: 'diagnosis_share',
} as const

export type DiagnosisMetrikaGoal = keyof typeof DIAGNOSIS_METRIKA_GOALS

const trackedDiagnosisSessionStarts = new Set<string>()

export const trackDiagnosisGoal = (
  goal: DiagnosisMetrikaGoal,
  meta?: Record<string, unknown>,
) => {
  trackMetrikaGoal(DIAGNOSIS_METRIKA_GOALS[goal], {
    mode: 'diagnosis',
    ...(meta ?? {}),
  })
}

export const trackDiagnosisSessionStart = (
  sessionId: string,
  meta?: Record<string, unknown>,
) => {
  if (!sessionId || trackedDiagnosisSessionStarts.has(sessionId)) return
  trackedDiagnosisSessionStarts.add(sessionId)
  trackDiagnosisGoal('start', {
    sessionId,
    entry: 'session',
    ...(meta ?? {}),
  })
}
