import { beforeEach, describe, expect, it, vi } from 'vitest'

const { trackMetrikaGoal } = vi.hoisted(() => ({ trackMetrikaGoal: vi.fn() }))

vi.mock('./metrics', () => ({ trackMetrikaGoal }))

import { trackGameCompleteOnce, trackGameStartOnce, trackNextGameStart } from './game-analytics'

beforeEach(() => trackMetrikaGoal.mockClear())

describe('unified game analytics', () => {
  it('tracks generic and diagnosis starts once with the same session', () => {
    trackGameStartOnce('diagnosis-start-test', { mode: 'diagnosis', kind: 'daily' })
    trackGameStartOnce('diagnosis-start-test', { mode: 'diagnosis', kind: 'daily' })

    expect(trackMetrikaGoal).toHaveBeenCalledTimes(2)
    expect(trackMetrikaGoal).toHaveBeenCalledWith('game_session_start', expect.objectContaining({ mode: 'diagnosis' }))
    expect(trackMetrikaGoal).toHaveBeenCalledWith('diagnosis_start', expect.objectContaining({
      mode: 'diagnosis',
      sessionId: 'diagnosis-start-test',
    }))
  })

  it('tracks generic and diagnosis completions once with the same session', () => {
    trackGameCompleteOnce('diagnosis-complete-test', { mode: 'diagnosis', outcome: 'won' })
    trackGameCompleteOnce('diagnosis-complete-test', { mode: 'diagnosis', outcome: 'won' })

    expect(trackMetrikaGoal).toHaveBeenCalledTimes(2)
    expect(trackMetrikaGoal).toHaveBeenCalledWith('game_session_complete', expect.objectContaining({ mode: 'diagnosis' }))
    expect(trackMetrikaGoal).toHaveBeenCalledWith('diagnosis_complete', expect.objectContaining({
      mode: 'diagnosis',
      sessionId: 'diagnosis-complete-test',
    }))
  })

  it('tracks generic and diagnosis next-game clicks from one action', () => {
    trackNextGameStart('diagnosis', 'danetki', { placement: 'result-related' })

    expect(trackMetrikaGoal).toHaveBeenCalledTimes(2)
    expect(trackMetrikaGoal).toHaveBeenCalledWith('game_next_start', expect.objectContaining({
      from_mode: 'diagnosis',
      to_mode: 'danetki',
    }))
    expect(trackMetrikaGoal).toHaveBeenCalledWith('diagnosis_next_game', expect.objectContaining({
      from_mode: 'diagnosis',
      to_mode: 'danetki',
    }))
  })
})
