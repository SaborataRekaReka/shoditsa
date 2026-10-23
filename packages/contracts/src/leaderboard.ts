import { Type, type Static } from '@sinclair/typebox'

export const LEADERBOARD_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

export const RATING_RULES = {
  version: 1,
  completion: 10,
  victory: 20,
  unusedAttempt: 2,
  maxAttempts: 10,
} as const

export const LeaderboardQuerySchema = Type.Object({
  period: Type.Optional(Type.Union([Type.Literal('week'), Type.Literal('all')])),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
}, { additionalProperties: false })
export type LeaderboardQuery = Static<typeof LeaderboardQuerySchema>
export type LeaderboardPeriod = NonNullable<LeaderboardQuery['period']>

export type LeaderboardEntry = {
  playerKey: string
  rank: number
  displayName: string
  avatarUrl: string | null
  isClubMember: boolean
  isCurrentUser: boolean
  score: number
  totalRating: number
  weeklyRating: number
  games: number
  wins: number
}

export type LeaderboardResponse = {
  period: LeaderboardPeriod
  rulesVersion: number
  updatedAt: string
  serverTime: string
  week: { startsAt: string; endsAt: string; timezone: 'Europe/Moscow' }
  participantCount: number
  entries: LeaderboardEntry[]
  viewerEntry: LeaderboardEntry | null
  viewerState: 'guest' | 'unranked' | 'ranked'
  pointsToNextRank: number | null
  nextOffset: number | null
}
