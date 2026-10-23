import { createHash } from 'node:crypto'
import {
  LEADERBOARD_REFRESH_INTERVAL_MS, RATING_RULES,
  type LeaderboardEntry, type LeaderboardQuery, type LeaderboardResponse,
} from '@shoditsa/contracts'
import type { RatingActivity } from './activity.js'

const DAY = 86_400_000
const MOSCOW_OFFSET = 3 * 3_600_000

export function ratingWeek(now: Date) {
  const local = new Date(now.getTime() + MOSCOW_OFFSET)
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  const monday = midnight - ((local.getUTCDay() + 6) % 7) * DAY
  return {
    key: new Date(monday).toISOString().slice(0, 10),
    startsAt: new Date(monday - MOSCOW_OFFSET).toISOString(),
    endsAt: new Date(monday + 7 * DAY - MOSCOW_OFFSET).toISOString(),
    timezone: 'Europe/Moscow' as const,
  }
}

export const ratingSnapshotExpired = (at: Date, now = new Date()) => (
  now.getTime() - at.getTime() >= LEADERBOARD_REFRESH_INTERVAL_MS
  || ratingWeek(at).key !== ratingWeek(now).key
)

type Weekly = RatingActivity['weeks'][number]
type Participant = { player: RatingActivity; activity: Weekly }
const chronological = (a: string, b: string) => Date.parse(a) - Date.parse(b)
const compare = (a: Participant, b: Participant) => b.activity.score - a.activity.score
  || b.activity.wins - a.activity.wins
  || chronological(a.activity.lastAt, b.activity.lastAt)
  || a.player.user_id.localeCompare(b.player.user_id)

/** Weekly and lifetime tables use the same server-owned daily results. */
export function buildLeaderboard(
  players: RatingActivity[], query: LeaderboardQuery = {}, viewerId: string | null = null,
  now = new Date(), updatedAt = now,
): LeaderboardResponse {
  const week = ratingWeek(now)
  const period = query.period ?? 'week'
  const active: Participant[] = []
  const all = players.flatMap(player => {
    const history = player.weeks.filter(activity => activity.week <= week.key && activity.score > 0)
      .sort((a, b) => a.week.localeCompare(b.week))
    if (!history.length) return []
    const current = history.find(activity => activity.week === week.key)
    if (current) active.push({ player, activity: current })
    return [{ player, activity: {
      week: 'all', score: history.reduce((sum, entry) => sum + entry.score, 0),
      games: history.reduce((sum, entry) => sum + entry.games, 0),
      wins: history.reduce((sum, entry) => sum + entry.wins, 0),
      firstAt: history[0].firstAt, lastAt: history.at(-1)!.lastAt,
    } }]
  }).sort(compare)
  const totalById = new Map(all.map(entry => [entry.player.user_id, entry.activity.score]))
  const weeklyById = new Map(active.map(entry => [entry.player.user_id, entry.activity.score]))
  const candidates = period === 'all' ? all : active.sort(compare)
  const entries: LeaderboardEntry[] = candidates.map((entry, index) => ({
    playerKey: createHash('sha256').update(`shoditsa-rating:${entry.player.user_id}`).digest('hex').slice(0, 20),
    rank: index + 1,
    // A legacy account name may be an email. Public ratings never expose it.
    displayName: entry.player.display_name.includes('@') ? 'Игрок' : entry.player.display_name,
    avatarUrl: entry.player.avatar_url && /^(https:\/\/|\/media\/)/i.test(entry.player.avatar_url) ? entry.player.avatar_url : null,
    isClubMember: entry.player.is_club_member,
    isCurrentUser: entry.player.user_id === viewerId,
    score: entry.activity.score,
    totalRating: totalById.get(entry.player.user_id) ?? 0,
    weeklyRating: weeklyById.get(entry.player.user_id) ?? 0,
    games: entry.activity.games, wins: entry.activity.wins,
  }))
  const viewerIndex = candidates.findIndex(entry => entry.player.user_id === viewerId)
  const offset = query.offset ?? 0
  const limit = query.limit ?? 50
  return {
    period, rulesVersion: RATING_RULES.version, serverTime: now.toISOString(), updatedAt: updatedAt.toISOString(),
    week: { startsAt: week.startsAt, endsAt: week.endsAt, timezone: week.timezone },
    participantCount: candidates.length,
    entries: entries.slice(offset, offset + limit),
    viewerEntry: viewerIndex >= 0 ? entries[viewerIndex] : null,
    viewerState: !viewerId ? 'guest' : viewerIndex >= 0 ? 'ranked' : 'unranked',
    pointsToNextRank: viewerIndex > 0 ? candidates[viewerIndex - 1].activity.score - candidates[viewerIndex].activity.score + 1 : null,
    nextOffset: offset + limit < entries.length ? offset + limit : null,
  }
}
