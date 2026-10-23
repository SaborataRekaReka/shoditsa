import { describe, expect, it } from 'vitest'
import type { ActiveSessionSummary } from '@shoditsa/contracts'
import { serverTodayAvailability } from './today-availability'

const date = '2026-10-21'
const session = (override: Partial<ActiveSessionSummary> = {}): ActiveSessionSummary => ({
  id: 'test', mode: 'movie', kind: 'daily', status: 'playing', variantKey: null,
  period: 'all', difficulty: null, puzzleDate: date, attemptsCount: 1, updatedAt: `${date}T10:00:00Z`, ...override,
})

describe('shared calendar account progress', () => {
  it('does not invent statuses while account data is missing or belongs to yesterday', () => {
    expect(serverTodayAvailability(null, date)).toBeNull()
    expect(serverTodayAvailability({ today: { activityDate: '2026-10-20', completedModes: ['movie'], wonModes: ['movie'], fullHouse: false }, activeSessions: [] }, date)).toBeNull()
  })
  it('ignores free play, packs, archives and yesterday when marking today in progress', () => {
    const result = serverTodayAvailability({ today: null, activeSessions: [
      session(), session({ mode: 'series', kind: 'free_play' }), session({ mode: 'music', kind: 'pack' }),
      session({ mode: 'city', kind: 'archive' }), session({ mode: 'anime', puzzleDate: '2026-10-20' }),
    ] }, date)
    expect(result?.movie).toBe('in-progress')
    for (const mode of ['series', 'music', 'city', 'anime'] as const) expect(result?.[mode]).toBe('new')
  })
  it('keeps completed puzzles ahead of active sessions, including losses', () => {
    const result = serverTodayAvailability({ today: { activityDate: date, completedModes: ['movie', 'series'], wonModes: ['movie'], fullHouse: false }, activeSessions: [session()] }, date)
    expect(result?.movie).toBe('completed')
    expect(result?.series).toBe('completed')
  })
})
