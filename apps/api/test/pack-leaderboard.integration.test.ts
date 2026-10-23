import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { contentItemVersions, contentPackEntries, contentPacks, createDatabase, gameSessions, playerProfiles, user, userPackProgress } from '@shoditsa/database'
import { getPackLeaderboard } from '../src/modules/packs/leaderboard.js'

describe('published pack leaderboard without legacy campaign badges', () => {
  const database = createDatabase(loadConfig())
  const packId = `ranking-${randomUUID()}`
  const draftId = `draft-${randomUUID()}`
  const otherId = `other-${randomUUID()}`
  const players = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]

  beforeAll(async () => {
    const [version] = await database.db.select().from(contentItemVersions).where(eq(contentItemVersions.mode, 'game')).limit(1)
    if (!version) throw new Error('Integration content import is required')
    await database.db.insert(contentPacks).values([packId, draftId, otherId].map(id => ({ id, slug: id, mode: 'game' as const, title: 'Ranking test', description: 'Synthetic integration fixture', status: id === draftId ? 'draft' : 'published' })))
    await database.db.insert(contentPackEntries).values({ packId, position: 1, answerItemId: version.itemId })
    await database.db.insert(user).values(players.map((id, index) => ({ id, name: `Player ${index}`, email: `${id}@example.test`, emailVerified: true, isAnonymous: index === 2 })))
    await database.db.insert(playerProfiles).values(players.map(userId => ({ userId })))
    await database.db.insert(userPackProgress).values(players.map((userId, index) => ({ userId, packId: index === 3 ? otherId : packId, completedPositions: index < 2 ? [1] : [] })))
    await database.db.insert(gameSessions).values(players.filter((_, index) => index !== 3).map((userId, index) => {
      const status = index === 3 ? 'playing' : index === 1 ? 'lost' : 'won'
      return { userId, kind: 'pack', mode: 'game' as const, period: 'all' as const, puzzleDate: '2026-10-23', revisionId: version.revisionId, answerItemVersionId: version.id, rulesVersion: 4,
        packId, packPosition: 1, status, attemptsCount: status === 'lost' ? 6 : 2,
        completionType: status === 'playing' ? null : status === 'won' ? 'direct_win' : 'attempts_exhausted', completedAt: status === 'playing' ? null : new Date() }
    }))
  })
  afterAll(async () => { await database.client.end() })

  it('ranks actual registered participants with no badge and preserves scoring', async () => {
    const board = await getPackLeaderboard(database.db, players[0], packId)
    expect(board.participantCount).toBe(3)
    expect(board.entries.map(entry => entry.displayName)).toEqual(['Player 0', 'Player 1', 'Player 4'])
    expect(board.entries[0]).toMatchObject({ score: 190, wins: 1, totalAttempts: 2, isCurrentUser: true, totalItems: 1 })
    expect(board.entries[1]).toMatchObject({ score: 100, wins: 0, totalAttempts: 6 })
    expect(board.entries[2]).toMatchObject({ score: 0, wins: 0, totalAttempts: 0 })
    expect(board.entries[0]).not.toHaveProperty('userId')
  })
  it('does not include guests or participants from another pack', async () => {
    const board = await getPackLeaderboard(database.db, players[3], packId)
    expect(board.entries.some(entry => ['Player 2', 'Player 3'].includes(entry.displayName))).toBe(false)
    expect(board.entries.every(entry => !entry.isCurrentUser)).toBe(true)
    expect(board.viewerEntry).toBeNull()
  })
  it('keeps drafts private and returns an empty ranking for a published pack', async () => {
    await expect(getPackLeaderboard(database.db, players[0], draftId)).rejects.toMatchObject({ code: 'PACK_NOT_FOUND' })
    const board = await getPackLeaderboard(database.db, players[0], `missing-${packId}`).catch(error => error)
    expect(board).toMatchObject({ code: 'PACK_NOT_FOUND' })
    await expect(getPackLeaderboard(database.db, players[0], draftId, 'admin')).resolves.toMatchObject({ participantCount: 0, entries: [] })
  })
})
