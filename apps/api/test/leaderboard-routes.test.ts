import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@shoditsa/database'
import type { Auth } from '../src/modules/auth/auth.js'
import { registerLeaderboardRoutes } from '../src/modules/leaderboard/routes.js'
import { ratingWeek } from '../src/modules/leaderboard/ranking.js'

async function setup() {
  const week = ratingWeek(new Date())
  const execute = vi.fn().mockResolvedValue([{ players: ['a', 'b'].map((id, index) => ({
    user_id: id, display_name: `Player ${id}`, avatar_url: null, is_club_member: false,
    weeks: [{ week: week.key, score: 48 - index, games: 1, wins: 1, firstAt: week.startsAt, lastAt: week.startsAt }],
  })) }])
  const auth = { api: { getSession: vi.fn(async ({ headers }: { headers: Headers }) => {
    const id = headers.get('x-test-user')
    return id ? { user: { id } } : null
  }) } }
  const app = Fastify()
  registerLeaderboardRoutes(app, { execute } as unknown as Database, auth as unknown as Auth)
  return { app, execute }
}

describe('public leaderboard API', () => {
  it('is public, exposes no private identifiers, and rejects scoring writes', async () => {
    const { app } = await setup()
    try {
      const response = await app.inject('/api/v1/leaderboard?period=all')
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('private, no-store')
      expect(response.json()).toMatchObject({ viewerState: 'guest', participantCount: 2 })
      expect(response.json().entries[0]).not.toHaveProperty('user_id')
      expect((await app.inject({ method: 'POST', url: '/api/v1/leaderboard', payload: { score: 999999 } })).statusCode).toBe(404)
    } finally { await app.close() }
  })

  it('never caches one viewer identity for another viewer', async () => {
    const { app, execute } = await setup()
    try {
      const a = await app.inject({ url: '/api/v1/leaderboard?period=all', headers: { 'x-test-user': 'a' } })
      const b = await app.inject({ url: '/api/v1/leaderboard?period=all', headers: { 'x-test-user': 'b' } })
      expect(a.json().viewerEntry.rank).toBe(1)
      expect(b.json().viewerEntry.rank).toBe(2)
      expect(b.json().entries[0].isCurrentUser).toBe(false)
      expect(execute).toHaveBeenCalledTimes(1)
    } finally { await app.close() }
  })

  it('defaults to weekly results and validates periods and bounded pagination', async () => {
    const { app, execute } = await setup()
    try {
      for (const query of ['period=fake', 'period=league', 'limit=101', 'offset=-1']) {
        expect((await app.inject(`/api/v1/leaderboard?${query}`)).statusCode).toBe(400)
      }
      const response = await app.inject('/api/v1/leaderboard?period=all&limit=1&offset=1')
      expect(response.statusCode).toBe(200)
      expect(response.json().entries).toHaveLength(1)
      expect(response.json().entries[0].rank).toBe(2)
      const weekly = await app.inject('/api/v1/leaderboard')
      expect(weekly.json()).toMatchObject({ period: 'week', participantCount: 2 })
      expect(execute).toHaveBeenCalledTimes(1)
    } finally { await app.close() }
  })
})
