import { describe, expect, it } from 'vitest'
import type { AttendanceStats } from '../../types'
import { advanceAttendanceStreak, crossedDailyMilestones, shouldRecordCompletion } from './completion'

const stats = (overrides: Partial<AttendanceStats> = {}): AttendanceStats => ({
  currentDailyStreak: 0, bestDailyStreak: 0, lastCompletedDate: null, gracePasses: 0, totalActiveDays: 0, fullHouseDays: 0, ...overrides,
})

describe('completion idempotence and progression', () => {
  it('does not complete or reward the same session twice', () => {
    const key = 'movie|all|2026-07-12'
    expect(shouldRecordCompletion([], key)).toBe(true)
    expect(shouldRecordCompletion([key], key)).toBe(false)
  })

  it('recognizes 1/6, 3/6 and 6/6 without reclaiming milestones', () => {
    expect(crossedDailyMilestones(0, 1, [])).toEqual([])
    expect(crossedDailyMilestones(2, 3, [])).toEqual([3])
    expect(crossedDailyMilestones(5, 6, [])).toEqual([6])
    expect(crossedDailyMilestones(2, 6, [])).toEqual([3, 6])
    expect(crossedDailyMilestones(2, 3, [3])).toEqual([])
  })

  it('advances streak once per day and consumes a grace pass for one missed day', () => {
    const first = advanceAttendanceStreak(stats(), '2026-07-10')
    expect(first.currentDailyStreak).toBe(1)
    const sameDay = advanceAttendanceStreak(first, '2026-07-10')
    expect(sameDay.currentDailyStreak).toBe(1)
    const grace = advanceAttendanceStreak(stats({ currentDailyStreak: 5, bestDailyStreak: 5, lastCompletedDate: '2026-07-10', gracePasses: 1 }), '2026-07-12')
    expect(grace.currentDailyStreak).toBe(6)
    expect(grace.gracePasses).toBe(0)
  })
})
