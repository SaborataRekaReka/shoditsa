import { sql } from 'drizzle-orm'
import type { Database } from '@shoditsa/database'
import type { LeaderboardQuery } from '@shoditsa/contracts'
import { RATING_ACTIVITY_SQL, type RatingActivity } from './activity.js'
import { buildLeaderboard, ratingSnapshotExpired } from './ranking.js'

type Snapshot = { players: RatingActivity[]; at: Date }
const cache = new WeakMap<Database, Promise<Snapshot>>()

export async function getLeaderboard(db: Database, query: LeaderboardQuery, viewerId: string | null) {
  let pending = cache.get(db)
  if (pending && ratingSnapshotExpired((await pending).at)) pending = undefined
  if (!pending) {
    pending = (async () => {
      const rows = await db.execute(sql.raw(RATING_ACTIVITY_SQL))
      return { players: (rows[0] as unknown as { players: RatingActivity[] }).players, at: new Date() }
    })()
    cache.set(db, pending)
    pending.catch(() => { if (cache.get(db) === pending) cache.delete(db) })
  }
  const snapshot = await pending
  return buildLeaderboard(snapshot.players, query, viewerId, new Date(), snapshot.at)
}
