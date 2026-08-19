import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deterministicClientEventId, trackClientEvent, trackMetrikaGoal } = vi.hoisted(() => ({
  deterministicClientEventId: vi.fn((scope: string, eventName: string) => `${scope}:${eventName}`),
  trackClientEvent: vi.fn(),
  trackMetrikaGoal: vi.fn(),
}))

vi.mock('./client-events', () => ({ deterministicClientEventId, trackClientEvent }))
vi.mock('./metrics', () => ({ trackMetrikaGoal }))

import {
  trackConfirmedServerStart,
  trackGameCompleteOnce,
  trackGameStartOnce,
  trackNextGameClick,
  trackNextGameStart,
  trackObservedServerStart,
  trackServerGameCompleteObserved,
} from './game-analytics'

const stored = new Map<string, string>()

beforeEach(() => {
  stored.clear()
  trackClientEvent.mockClear()
  trackMetrikaGoal.mockClear()
  deterministicClientEventId.mockClear()
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  })
})

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
    expect(trackClientEvent).not.toHaveBeenCalled()
  })

  it('records a confirmed server start in first-party analytics with a stable identity', () => {
    trackGameStartOnce('server-start-test', { mode: 'animal', kind: 'daily', state: 'new' }, { serverSession: true })

    expect(trackClientEvent).toHaveBeenCalledWith('game_session_start', {
      mode: 'animal',
      kind: 'daily',
      state: 'new',
    }, {
      eventId: 'server-start-test:game_session_start',
      gameSessionId: 'server-start-test',
    })
  })

  it('retries a persisted server start without duplicating the Metrika session goal', () => {
    trackObservedServerStart('server-resume-test', { mode: 'danetki', kind: 'daily', state: 'resumed' })

    expect(trackMetrikaGoal).not.toHaveBeenCalledWith('game_session_start', expect.anything())
    expect(trackClientEvent).toHaveBeenCalledWith('game_session_start', expect.objectContaining({ state: 'resumed' }), {
      eventId: 'server-resume-test:game_session_start',
      gameSessionId: 'server-resume-test',
    })
  })

  it('records a newly confirmed server start in both Metrika and first-party analytics', () => {
    trackConfirmedServerStart('server-confirmed-helper-test', { mode: 'book', kind: 'free_play', state: 'new' })

    expect(trackMetrikaGoal).toHaveBeenCalledWith('game_session_start', expect.objectContaining({ mode: 'book' }))
    expect(trackClientEvent).toHaveBeenCalledWith('game_session_start', expect.objectContaining({ mode: 'book' }), {
      eventId: 'server-confirmed-helper-test:game_session_start',
      gameSessionId: 'server-confirmed-helper-test',
    })
  })

  it('tracks generic and diagnosis completions once and stores confirmed server completion', () => {
    trackGameCompleteOnce('diagnosis-complete-test', { mode: 'diagnosis', outcome: 'won' }, { serverSession: true })
    trackGameCompleteOnce('diagnosis-complete-test', { mode: 'diagnosis', outcome: 'won' }, { serverSession: true })

    expect(trackMetrikaGoal).toHaveBeenCalledTimes(2)
    expect(trackMetrikaGoal).toHaveBeenCalledWith('game_session_complete', expect.objectContaining({ mode: 'diagnosis' }))
    expect(trackMetrikaGoal).toHaveBeenCalledWith('diagnosis_complete', expect.objectContaining({
      mode: 'diagnosis',
      sessionId: 'diagnosis-complete-test',
    }))
    expect(trackClientEvent).toHaveBeenCalledTimes(1)
    expect(trackClientEvent).toHaveBeenCalledWith('game_session_complete', {
      mode: 'diagnosis',
      outcome: 'won',
    }, {
      eventId: 'diagnosis-complete-test:game_session_complete',
      gameSessionId: 'diagnosis-complete-test',
    })
  })

  it('uses the same deterministic identity when a terminal server state is observed again', () => {
    trackServerGameCompleteObserved('observed-complete-test', { mode: 'danetki', outcome: 'won' })
    trackServerGameCompleteObserved('observed-complete-test', { mode: 'danetki', outcome: 'won' })

    expect(trackClientEvent).toHaveBeenCalledTimes(2)
    expect(trackClientEvent.mock.calls[0]?.[2]).toEqual(trackClientEvent.mock.calls[1]?.[2])
  })

  it('separates the next-game click from the confirmed matching server start', () => {
    const transitionId = trackNextGameClick('diagnosis', 'danetki', { placement: 'result-related' })

    expect(trackMetrikaGoal).toHaveBeenCalledWith('game_next_clicked', expect.objectContaining({
      from_mode: 'diagnosis',
      to_mode: 'danetki',
      transition_id: transitionId,
    }))
    expect(trackMetrikaGoal).toHaveBeenCalledWith('diagnosis_next_game', expect.objectContaining({
      from_mode: 'diagnosis',
      to_mode: 'danetki',
      transition_id: transitionId,
    }))
    expect(trackMetrikaGoal).not.toHaveBeenCalledWith('game_next_start', expect.anything())
    expect(trackClientEvent).toHaveBeenCalledWith('game_next_clicked', expect.objectContaining({
      transition_id: transitionId,
    }), { eventId: transitionId })

    trackGameStartOnce('confirmed-next-start-test', { mode: 'danetki', kind: 'daily' }, { serverSession: true })

    expect(trackMetrikaGoal).toHaveBeenCalledWith('game_next_start', expect.objectContaining({
      from_mode: 'diagnosis',
      to_mode: 'danetki',
      transition_id: transitionId,
    }))
    expect(trackClientEvent).toHaveBeenCalledWith('game_next_start', expect.objectContaining({
      transition_id: transitionId,
    }), {
      eventId: 'confirmed-next-start-test:game_next_start',
      gameSessionId: 'confirmed-next-start-test',
    })
  })

  it('keeps the legacy helper as click tracking without claiming a start', () => {
    trackNextGameStart('movie', 'animal', { placement: 'result' })

    expect(trackMetrikaGoal).toHaveBeenCalledWith('game_next_clicked', expect.objectContaining({
      from_mode: 'movie',
      to_mode: 'animal',
    }))
    expect(trackMetrikaGoal).not.toHaveBeenCalledWith('game_next_start', expect.anything())
  })

  it('does not confirm a transition when the next server session is a different mode', () => {
    trackNextGameClick('movie', 'animal')
    trackGameStartOnce('mismatched-next-start-test', { mode: 'book', kind: 'daily' }, { serverSession: true })
    trackGameStartOnce('later-target-start-test', { mode: 'animal', kind: 'daily' }, { serverSession: true })

    expect(trackMetrikaGoal).not.toHaveBeenCalledWith('game_next_start', expect.anything())
    expect(trackClientEvent).not.toHaveBeenCalledWith('game_next_start', expect.anything(), expect.anything())
  })
})
