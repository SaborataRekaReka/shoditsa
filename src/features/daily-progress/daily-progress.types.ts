import type { SavedGame, TitleMode } from '../../types'

export type DailyMilestone = 3 | 6

export type DailyMilestoneClaims = {
  date: string
  claimed: DailyMilestone[]
}

export type DailyRewardState = {
  fullHouse: boolean
  remaining: number
  reward: 10 | 25
  milestone: DailyMilestone
}

export type DailyHubState = {
  completedModes: TitleMode[]
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
