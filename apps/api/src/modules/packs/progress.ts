import { and, eq, sql } from 'drizzle-orm'
import { contentPackEntries, userPackProgress, type Database } from '@shoditsa/database'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export const recordPackCompletion = async (tx: Transaction, userId: string, packId: string, position: number) => {
  const rows = await tx.select().from(userPackProgress).where(and(eq(userPackProgress.userId, userId), eq(userPackProgress.packId, packId))).for('update').limit(1)
  const current = rows[0]?.completedPositions ?? []
  const completedPositions = [...new Set([...current, position])].sort((a, b) => a - b)
  const counts = await tx.select({ count: sql<number>`count(*)::int` }).from(contentPackEntries).where(and(eq(contentPackEntries.packId, packId), eq(contentPackEntries.enabled, true)))
  const completedAt = completedPositions.length >= (counts[0]?.count ?? 0) ? new Date() : null
  await tx.insert(userPackProgress).values({ userId, packId, completedPositions, lastPosition: position, completedAt })
    .onConflictDoUpdate({
      target: [userPackProgress.userId, userPackProgress.packId],
      set: { completedPositions, lastPosition: position, completedAt, updatedAt: new Date() },
    })
}
