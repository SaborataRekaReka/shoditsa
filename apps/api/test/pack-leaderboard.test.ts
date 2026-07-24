import { describe, expect, it } from 'vitest'
import { rankPackLeaderboard } from '../src/modules/packs/leaderboard.js'

const candidate = (
  userId: string,
  completedItems: number,
  wins: number,
  totalAttempts: number,
) => ({
  userId,
  displayName: userId,
  avatarUrl: null,
  completedItems,
  wins,
  totalAttempts,
  completedAt: completedItems === 25 ? new Date('2026-07-24T10:00:00.000Z') : null,
  startedAt: new Date('2026-07-23T10:00:00.000Z'),
})

describe('pack leaderboard ranking', () => {
  it('prioritizes progress, wins and then fewer attempts', () => {
    const ranked = rankPackLeaderboard([
      candidate('fewer-games', 20, 20, 30),
      candidate('more-attempts', 25, 23, 70),
      candidate('fewer-attempts', 25, 23, 55),
      candidate('more-wins', 25, 24, 80),
    ], 25, 'fewer-attempts')

    expect(ranked.map((entry) => entry.userId)).toEqual([
      'more-wins',
      'fewer-attempts',
      'more-attempts',
      'fewer-games',
    ])
    expect(ranked[1]).toMatchObject({
      rank: 2,
      totalItems: 25,
      isCurrentUser: true,
    })
  })
})
