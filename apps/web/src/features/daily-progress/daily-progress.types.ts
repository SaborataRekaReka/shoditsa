import type { SavedGame, TitleMode } from '../../types'
import type { FullHouseModeId } from '@shoditsa/contracts'

// Full-house size comes from the mode manifest and can grow with new modes.
export type DailyMilestone = number

export type DailyMilestoneClaims = {
  date: string
  claimed: DailyMilestone[]
}

export type DailyRewardState = {
  fullHouse: boolean
  remaining: number
  reward: number
  milestone: DailyMilestone
}

export type DailyHubState = {
  completedModes: FullHouseModeId[]
  dailyModes: FullHouseModeId[]
  completedCount: number
  activeGame: SavedGame | null
  activeGamesByMode: Partial<Record<TitleMode, SavedGame>>
  finishedGamesByMode: Partial<Record<TitleMode, SavedGame>>
  recommendedMode: TitleMode
  primaryLabel: string
  primaryMeta: string | null
  punchesCaption: string
  reward: DailyRewardState
}
