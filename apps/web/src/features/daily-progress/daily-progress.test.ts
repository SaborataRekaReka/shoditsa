import { describe, expect, it } from 'vitest'
import type { DailyAttendance, SavedGame } from '../../types'
import { KPOP_ARTISTS_PACK_ID } from '@shoditsa/contracts'
import { buildDailyHubState, isMainRouteGame } from './daily-progress'

const attendance: DailyAttendance = {
  date: '2026-07-12', completedModes: [], wonModes: [], completedSessions: [], firstCompletedAt: 0, fullHouse: false,
}

const game = (overrides: Partial<SavedGame>): SavedGame => ({
  key: 'movie|all|2026-07-12', mode: 'movie', period: 'all', date: '2026-07-12', answerId: 'answer', attempts: [], status: 'playing', updatedAt: 1, ...overrides,
})

describe('daily hub ticket states', () => {
  it('uses the freshest daily active session and ignores free-play sessions', () => {
    const state = buildDailyHubState(attendance, [
      game({ attempts: [{ titleId: 'a', hints: [] }], updatedAt: 2 }),
      game({ key: 'movie|all|2026-07-12|salt:1', attempts: [{ titleId: 'free', hints: [] }], updatedAt: 99 }),
    ], 'movie')
    expect(state.activeGamesByMode.movie?.attempts[0]?.titleId).toBe('a')
  })

  it('exposes a completed daily result for the ticket', () => {
    const state = buildDailyHubState({ ...attendance, completedModes: ['movie'] }, [
      game({ status: 'won', attempts: [{ titleId: 'a', hints: [] }, { titleId: 'answer', hints: [] }], updatedAt: 3 }),
    ], 'series')
    expect(state.finishedGamesByMode.movie?.status).toBe('won')
    expect(state.completedCount).toBe(1)
  })

  it('keeps the configured salted daily session and excludes a free-play salt', () => {
    const state = buildDailyHubState({ ...attendance, completedModes: ['movie'] }, [
      game({ key: 'movie|all|2026-07-12|salt:3', status: 'won', attempts: [{ titleId: 'answer', hints: [] }], updatedAt: 3 }),
      game({ key: 'movie|all|2026-07-12|salt:4', status: 'won', attempts: [{ titleId: 'free', hints: [] }], updatedAt: 4 }),
    ], 'series', 3)
    expect(state.finishedGamesByMode.movie?.attempts[0]?.titleId).toBe('answer')
  })

  it('keeps the K-pop special separate from the main music route', () => {
    const kpop = game({
      key: 'server:kpop-session',
      mode: 'music',
      variantKey: KPOP_ARTISTS_PACK_ID,
      status: 'won',
      attempts: [{ titleId: 'kpop-answer', hints: [] }],
      updatedAt: 10,
    })
    const state = buildDailyHubState(attendance, [kpop], 'music')

    expect(isMainRouteGame(kpop)).toBe(false)
    expect(state.finishedGamesByMode.music).toBeUndefined()
    expect(state.recommendedMode).toBe('music')
  })

  it('does not offer an active K-pop special as the main music session', () => {
    const state = buildDailyHubState(attendance, [
      game({
        key: 'server:kpop-session',
        mode: 'music',
        variantKey: KPOP_ARTISTS_PACK_ID,
        attempts: [{ titleId: 'kpop-guess', hints: [] }],
      }),
    ], 'music')

    expect(state.activeGame).toBeNull()
    expect(state.activeGamesByMode.music).toBeUndefined()
  })

  it('keeps Connections outside the seven-game main route', () => {
    const state = buildDailyHubState(attendance, [], 'movie')

    expect(state.dailyModes).toHaveLength(7)
    expect(state.dailyModes).not.toContain('connections')
    expect(state.completedModes).not.toContain('connections')
    expect(state.completedCount).toBe(0)
  })
})
