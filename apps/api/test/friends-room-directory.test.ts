import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '@shoditsa/database'
import { listFriendsRooms } from '../src/modules/friends-room/service.js'

const dialect = new PgDialect()
const at = new Date('2026-10-22T12:00:00Z')
const roomRow = (id: string, gameType = 'quiz') => ({
  id, code: 'AB234', gameType, mode: 'movie', packs: [{ mode: 'movie', variant: 'all' }], phase: 'lobby',
  currentRound: 0, roundsTotal: 5, closedAt: null, updatedAt: at,
})
function database(entries: unknown[], counts: unknown[] = []) {
  const membership = {
    from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(entries),
  }
  const participants = {
    from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockResolvedValue(counts),
  }
  const select = vi.fn().mockReturnValueOnce(membership).mockReturnValueOnce(participants)
  return { db: { select } as unknown as Database, membership, participants, select }
}

describe('personal room directory query', () => {
  it('preserves the current-room contract for existing consumers', async () => {
    const { db, membership } = database([])
    expect(await listFriendsRooms(db, 'viewer')).toEqual([])
    const filter = dialect.sqlToQuery(membership.where.mock.calls[0][0])
    expect(filter.params).toEqual(['viewer'])
    expect(filter.sql).toContain('"user_id" = $1')
    expect(filter.sql).toContain('"left_at" is null')
    expect(filter.sql).toContain('"closed_at" is null')
    expect(membership.limit).toHaveBeenCalledWith(1)
  })
  it('includes departed and closed rooms only for the authenticated member, with a bounded history', async () => {
    const { db, membership, select } = database([])
    await listFriendsRooms(db, 'viewer', 'recent')
    const filter = dialect.sqlToQuery(membership.where.mock.calls[0][0])
    expect(filter.params).toEqual(['viewer'])
    expect(filter.sql).not.toContain('left_at')
    expect(filter.sql).not.toContain('closed_at')
    expect(membership.limit).toHaveBeenCalledWith(30)
    expect(dialect.sqlToQuery(membership.orderBy.mock.calls[0][0]).sql).toContain('"left_at" is null and "friends_rooms"."closed_at" is null')
    expect(select).toHaveBeenCalledTimes(1)
  })
  it('returns roles, closure and departure separately and counts mixed room types per room', async () => {
    const { db, select, participants } = database([
      { room: roomRow('quiz'), role: 'owner', joinedAt: at, leftAt: null },
      { room: { ...roomRow('duel', 'territory'), phase: 'finished', closedAt: at }, role: 'player', joinedAt: at, leftAt: at },
    ], [{ roomId: 'quiz', participants: 4, players: 1 }, { roomId: 'duel', participants: 2, players: 0 }])
    const result = await listFriendsRooms(db, 'viewer', 'recent')
    expect(result[0]).toMatchObject({ id: 'quiz', isHost: true, players: 1, participantCount: 4, leftAt: null, closedAt: null })
    expect(result[1]).toMatchObject({ id: 'duel', isHost: false, capacity: 2, participantCount: 2, leftAt: at.toISOString(), closedAt: at.toISOString() })
    const counters = select.mock.calls[1][0]
    const liveCount = dialect.sqlToQuery(counters.players).sql
    expect(liveCount).toContain('"game_type" = \'territory\' or')
    expect(liveCount).toContain('"last_seen_at"')
    expect(dialect.sqlToQuery(participants.where.mock.calls[0][0]).params).toEqual(['quiz', 'duel'])
  })
})
