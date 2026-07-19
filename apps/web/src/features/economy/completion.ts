import type { AttendanceStats } from '../../types'
import { FULL_HOUSE_MODE_IDS } from '@shoditsa/contracts'

const dateIndex = (date: string) => Math.floor(new Date(`${date}T12:00:00+03:00`).getTime() / 86_400_000)

export const shouldRecordCompletion = (completedSessions: readonly string[], sessionKey: string) => !completedSessions.includes(sessionKey)

export const crossedDailyMilestones = (previousCount: number, nextCount: number, claimed: readonly number[]) => {
  const result: number[] = []
  const fullHouseTarget = FULL_HOUSE_MODE_IDS.length
  if (previousCount < 3 && nextCount >= 3 && !claimed.includes(3)) result.push(3)
  if (previousCount < fullHouseTarget && nextCount >= fullHouseTarget && !claimed.includes(fullHouseTarget)) result.push(fullHouseTarget)
  return result
}

export const advanceAttendanceStreak = (stats: AttendanceStats, date: string): AttendanceStats => {
  const distance = stats.lastCompletedDate ? dateIndex(date) - dateIndex(stats.lastCompletedDate) : 0
  const nextStreak = stats.lastCompletedDate
    ? distance === 1 || (distance === 2 && stats.gracePasses > 0)
      ? stats.currentDailyStreak + 1
      : distance <= 0 ? stats.currentDailyStreak : 1
    : 1
  const usedGrace = Boolean(stats.lastCompletedDate && distance === 2 && stats.gracePasses > 0)
  const earnedGrace = nextStreak > stats.currentDailyStreak && nextStreak % 7 === 0 ? 1 : 0
  return {
    ...stats,
    currentDailyStreak: nextStreak,
    bestDailyStreak: Math.max(stats.bestDailyStreak, nextStreak),
    lastCompletedDate: date,
    gracePasses: Math.min(2, Math.max(0, stats.gracePasses - (usedGrace ? 1 : 0)) + earnedGrace),
    totalActiveDays: stats.lastCompletedDate === date ? stats.totalActiveDays : stats.totalActiveDays + 1,
  }
}
