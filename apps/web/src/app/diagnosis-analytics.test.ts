import { beforeEach, describe, expect, it, vi } from 'vitest'

const { trackMetrikaGoal } = vi.hoisted(() => ({ trackMetrikaGoal: vi.fn() }))

vi.mock('./metrics', () => ({ trackMetrikaGoal }))

import { DIAGNOSIS_METRIKA_GOALS, trackDiagnosisSessionStart } from './diagnosis-analytics'

beforeEach(() => trackMetrikaGoal.mockClear())

describe('diagnosis Metrika goals', () => {
  it('keeps every configured JavaScript goal unique and valid', () => {
    const goals = Object.values(DIAGNOSIS_METRIKA_GOALS)

    expect(new Set(goals).size).toBe(goals.length)
    for (const goal of goals) {
      expect(goal).toMatch(/^[a-z][a-z0-9_]+$/)
      expect(goal.length).toBeLessThanOrEqual(32)
    }
  })

  it('tracks one start per loaded server session', () => {
    trackDiagnosisSessionStart('diagnosis-session-test', { period: 'all' })
    trackDiagnosisSessionStart('diagnosis-session-test', { period: 'all' })

    expect(trackMetrikaGoal).toHaveBeenCalledTimes(1)
    expect(trackMetrikaGoal).toHaveBeenCalledWith('diagnosis_start', expect.objectContaining({
      mode: 'diagnosis',
      sessionId: 'diagnosis-session-test',
      entry: 'session',
    }))
  })
})
