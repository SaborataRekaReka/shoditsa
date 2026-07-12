import { describe, expect, it } from 'vitest'
import type { DailyAttendance, SavedGame } from '../../types'
import { buildDailyHubState } from './daily-progress'

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
})
