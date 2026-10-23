import { describe, expect, it } from 'vitest'
import { buildLeaderboard, ratingSnapshotExpired, ratingWeek } from '../src/modules/leaderboard/ranking.js'
import type { RatingActivity } from '../src/modules/leaderboard/activity.js'

const now = new Date('2026-10-21T12:00:00Z')
function player(id: string, score = 40, week = '2026-10-19', extra: Partial<RatingActivity> = {}): RatingActivity {
  return { user_id: id, display_name: id, avatar_url: null, is_club_member: false, weeks: [
    { week, score, games: 1, wins: 1, firstAt: `${week}T10:00:00Z`, lastAt: `${week}T10:00:00Z` },
  ], ...extra }
}
const result = (players: RatingActivity[], period: 'all' | 'week' = 'week', viewer: string | null = null) => buildLeaderboard(players, { period }, viewer, now)

describe('weekly and lifetime rating', () => {
  it('keeps the rating snapshot for 24 hours and refreshes at a new week', () => {
    const generatedAt = new Date('2026-10-21T12:00:00Z')
    expect(ratingSnapshotExpired(generatedAt, new Date('2026-10-22T11:59:59Z'))).toBe(false)
    expect(ratingSnapshotExpired(generatedAt, new Date('2026-10-22T12:00:00Z'))).toBe(true)
    expect(ratingSnapshotExpired(new Date('2026-10-25T20:00:00Z'), new Date('2026-10-25T21:00:00Z'))).toBe(true)
  })
  it('uses exact Moscow Monday boundaries, including the Sunday UTC crossover', () => {
    expect(ratingWeek(new Date('2026-10-18T20:59:59Z'))).toMatchObject({ key: '2026-10-12', endsAt: '2026-10-18T21:00:00.000Z' })
    expect(ratingWeek(new Date('2026-10-18T21:00:00Z'))).toMatchObject({ key: '2026-10-19', startsAt: '2026-10-18T21:00:00.000Z', endsAt: '2026-10-25T21:00:00.000Z' })
  })

  it('ranks by score, then wins, then scoring time, with deterministic final ties', () => {
    const players = [player('d', 48), player('a', 48), player('c', 48), player('b', 50)]
    players[0].weeks[0].wins = 0
    players[1].weeks[0].lastAt = '2026-10-19T11:00:00Z'
    expect(result(players, 'week').entries.map(entry => entry.displayName)).toEqual(['b', 'c', 'a', 'd'])
    expect(result([player('b'), player('a')], 'week').entries.map(entry => entry.displayName)).toEqual(['a', 'b'])
  })

  it('has no subscription scoring boost and uses actual active membership only for decoration', () => {
    const data = result([player('free', 48), player('club', 30, undefined, { is_club_member: true })], 'all')
    expect(data.entries.map(entry => entry.score)).toEqual([48, 30])
    expect(data.entries[1].isClubMember).toBe(true)
  })

  it('includes all weekly participants in one table, including more than 30', () => {
    const players = Array.from({ length: 35 }, (_, index) => player(`p${index}`, 100 - index))
    const data = buildLeaderboard(players, {}, 'p34', now)
    expect(data.period).toBe('week')
    expect(data.participantCount).toBe(35)
    expect(data.entries).toHaveLength(35)
    expect(data.viewerEntry?.rank).toBe(35)
    expect(data).not.toHaveProperty('leagues')
    expect(data.entries[0]).not.toHaveProperty('league')
    expect(data.entries[0]).not.toHaveProperty('zone')
  })

  it('resets only weekly points at the boundary and keeps the lifetime sum', () => {
    const current = player('current', 10)
    current.weeks.unshift(player('past', 60, '2026-10-12').weeks[0])
    const previous = player('previous-only', 80, '2026-10-12')
    const weekly = result([current, previous])
    expect(weekly.entries.map(entry => entry.displayName)).toEqual(['current'])
    expect(weekly.entries[0]).toMatchObject({ score: 10, totalRating: 70, weeklyRating: 10 })
    expect(result([current, previous], 'all').entries.map(entry => entry.score)).toEqual([80, 70])
    const monday = new Date('2026-10-25T21:00:00Z')
    expect(buildLeaderboard([current, previous], {}, 'current', monday)).toMatchObject({
      period: 'week', entries: [], viewerState: 'unranked',
    })
    expect(buildLeaderboard([current, previous], { period: 'all' }, 'current', monday).viewerEntry?.totalRating).toBe(70)
  })

  it('returns the actual viewer outside a paginated top, without leaking user IDs or email names', () => {
    const data = buildLeaderboard([player('user-secret', 20, undefined, { display_name: 'private@example.com', avatar_url: 'javascript:alert(1)' }), player('top', 48)], { period: 'all', limit: 1 }, 'user-secret', now)
    expect(data.viewerEntry).toMatchObject({ rank: 2, displayName: 'Игрок', avatarUrl: null, isCurrentUser: true })
    expect(data.pointsToNextRank).toBe(29)
    expect(data.nextOffset).toBe(1)
    expect(JSON.stringify(data)).not.toContain('user-secret')
    expect(JSON.stringify(data)).not.toContain('private@example.com')
  })

  it('paginates in fives with absolute ranks and a shorter final page', () => {
    const players = Array.from({ length: 12 }, (_, index) => player(`p${index}`, 100 - index))
    const pages = [0, 5, 10].map(offset => buildLeaderboard(players, { period: 'all', offset, limit: 5 }, 'p11', now))
    expect(pages.map(page => page.entries.length)).toEqual([5, 5, 2])
    expect(pages.flatMap(page => page.entries.map(entry => entry.rank))).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(pages.map(page => page.nextOffset)).toEqual([5, 10, null])
    expect(pages.every(page => page.viewerEntry?.rank === 12 && page.participantCount === 12)).toBe(true)
  })

  it('distinguishes guests and users with no activity in the selected period', () => {
    expect(result([], 'week').viewerState).toBe('guest')
    expect(result([], 'week', 'new').viewerState).toBe('unranked')
    expect(result([player('old', 48, '2026-10-12')], 'week', 'old').viewerState).toBe('unranked')
    expect(result([player('old', 48, '2026-10-12')], 'all', 'old').viewerState).toBe('ranked')
  })
})
