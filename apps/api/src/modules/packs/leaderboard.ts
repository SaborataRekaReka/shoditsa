import { and, eq, sql } from 'drizzle-orm'
import type { ApiRole, PackLeaderboardEntry, PackLeaderboardResponse } from '@shoditsa/contracts'
import {
  contentPackEntries,
  contentPacks,
  gameSessions,
  playerProfiles,
  user,
  userBadges,
  userPackProgress,
  type Database,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { canViewPack } from './access.js'
import { requiredBadgeForPack } from './policy.js'

type LeaderboardCandidate = {
  userId: string
  displayName: string
  avatarUrl: string | null
  completedItems: number
  wins: number
  totalAttempts: number
  completedAt: Date | null
  startedAt: Date | null
}

const timestamp = (value: Date | null) => value?.getTime() ?? Number.MAX_SAFE_INTEGER

export const rankPackLeaderboard = (
  candidates: LeaderboardCandidate[],
  totalItems: number,
  viewerId: string,
): Array<PackLeaderboardEntry & { userId: string }> => [...candidates]
  .sort((left, right) => (
    right.completedItems - left.completedItems
    || right.wins - left.wins
    || left.totalAttempts - right.totalAttempts
    || timestamp(left.completedAt) - timestamp(right.completedAt)
    || timestamp(left.startedAt) - timestamp(right.startedAt)
    || left.displayName.localeCompare(right.displayName, 'ru')
    || left.userId.localeCompare(right.userId)
  ))
  .map((entry, index) => ({
    rank: index + 1,
    userId: entry.userId,
    displayName: entry.displayName,
    avatarUrl: entry.avatarUrl,
    completedItems: entry.completedItems,
    totalItems,
    wins: entry.wins,
    totalAttempts: entry.totalAttempts,
    completedAt: entry.completedAt?.toISOString() ?? null,
    isCurrentUser: entry.userId === viewerId,
  }))

export const getPackLeaderboard = async (
  db: Database,
  viewerId: string,
  packId: string,
  role: ApiRole = 'player',
): Promise<PackLeaderboardResponse> => {
  const packRows = await db.select({ id: contentPacks.id, status: contentPacks.status })
    .from(contentPacks).where(eq(contentPacks.id, packId)).limit(1)
  const pack = packRows[0]
  if (!pack || (pack.status !== 'published' && role !== 'admin') || !await canViewPack(db, viewerId, packId, role)) {
    throw new ApiError(404, 'PACK_NOT_FOUND', 'Спецпоказ не найден')
  }

  const badgeKey = requiredBadgeForPack(packId)
  if (!badgeKey) throw new ApiError(404, 'PACK_LEADERBOARD_NOT_FOUND', 'Для этого спецпоказа рейтинг не предусмотрен')

  const [countRows, participantRows, sessionRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(contentPackEntries).where(and(
      eq(contentPackEntries.packId, packId),
      eq(contentPackEntries.enabled, true),
    )),
    db.select({
      userId: user.id,
      accountName: user.name,
      displayName: playerProfiles.displayName,
      avatarUrl: user.image,
      completedPositions: userPackProgress.completedPositions,
      completedAt: userPackProgress.completedAt,
      startedAt: userPackProgress.startedAt,
    }).from(userBadges)
      .innerJoin(user, eq(user.id, userBadges.userId))
      .leftJoin(playerProfiles, eq(playerProfiles.userId, userBadges.userId))
      .leftJoin(userPackProgress, and(
        eq(userPackProgress.userId, userBadges.userId),
        eq(userPackProgress.packId, packId),
      ))
      .where(eq(userBadges.badgeKey, badgeKey)),
    db.select({
      userId: gameSessions.userId,
      status: gameSessions.status,
      attemptsCount: gameSessions.attemptsCount,
    }).from(gameSessions)
      .innerJoin(userBadges, and(
        eq(userBadges.userId, gameSessions.userId),
        eq(userBadges.badgeKey, badgeKey),
      ))
      .where(eq(gameSessions.packId, packId)),
  ])

  const statsByUser = new Map<string, { wins: number; totalAttempts: number }>()
  for (const session of sessionRows) {
    const stats = statsByUser.get(session.userId) ?? { wins: 0, totalAttempts: 0 }
    if (session.status === 'won') stats.wins += 1
    stats.totalAttempts += session.attemptsCount
    statsByUser.set(session.userId, stats)
  }

  const totalItems = countRows[0]?.count ?? 0
  const ranked = rankPackLeaderboard(participantRows.map((participant) => {
    const stats = statsByUser.get(participant.userId) ?? { wins: 0, totalAttempts: 0 }
    return {
      userId: participant.userId,
      displayName: (participant.displayName?.trim() || participant.accountName.trim() || 'Игрок DTF').slice(0, 60),
      avatarUrl: participant.avatarUrl?.trim() || null,
      completedItems: participant.completedPositions?.length ?? 0,
      wins: stats.wins,
      totalAttempts: stats.totalAttempts,
      completedAt: participant.completedAt,
      startedAt: participant.startedAt,
    }
  }), totalItems, viewerId)
  const publicEntry = ({ userId: _userId, ...entry }: PackLeaderboardEntry & { userId: string }) => entry
  const viewer = ranked.find((entry) => entry.userId === viewerId) ?? null

  return {
    packId,
    participantCount: ranked.length,
    totalItems,
    updatedAt: new Date().toISOString(),
    entries: ranked.slice(0, 100).map(publicEntry),
    viewerEntry: viewer && viewer.rank > 100 ? publicEntry(viewer) : null,
  }
}
