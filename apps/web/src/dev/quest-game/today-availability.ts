import type { DashboardResponse } from '@shoditsa/contracts'
import { readGameAvailability, supportsClubFreePlay } from '../quest-home/game-availability'
import type { SeoGameMode } from '../../app/seo-content'

type TodayProgress = Pick<DashboardResponse, 'today' | 'activeSessions'>

/** Server screens use account progress; a missing/stale response is not a fresh set of puzzles. */
export function serverTodayAvailability(dashboard: TodayProgress | null, date: string) {
  if (!dashboard || (dashboard.today && dashboard.today.activityDate !== date)) return null
  const availability = readGameAvailability(null, date)
  for (const session of dashboard.activeSessions) {
    const mode = session.mode as SeoGameMode
    if (session.kind === 'daily' && session.puzzleDate === date && supportsClubFreePlay(mode) && session.attemptsCount > 0) {
      availability[mode] = 'in-progress'
    }
  }
  for (const mode of dashboard.today?.completedModes ?? []) {
    if (supportsClubFreePlay(mode as SeoGameMode)) availability[mode as SeoGameMode] = 'completed'
  }
  return availability
}
