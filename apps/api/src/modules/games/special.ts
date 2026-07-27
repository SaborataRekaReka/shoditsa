import { eq } from 'drizzle-orm'
import { KPOP_ARTISTS_PACK_ID } from '@shoditsa/contracts'
import { contentPacks, dailyChallenges, type Database, type gameSessions } from '@shoditsa/database'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type SessionRow = typeof gameSessions.$inferSelect
type ReadDatabase = Pick<Database, 'select'> | Pick<Transaction, 'select'>

export const isSpecialSession = async (db: ReadDatabase, session: Pick<SessionRow, 'kind' | 'packId' | 'challengeId'>) => {
  if (session.kind === 'pack' || session.packId) return true
  if (!session.challengeId) return false
  const challenge = await db.select({ variantKey: dailyChallenges.variantKey })
    .from(dailyChallenges)
    .where(eq(dailyChallenges.id, session.challengeId))
    .limit(1)
  const variantKey = challenge[0]?.variantKey
  if (!variantKey || variantKey === '-') return false
  if (variantKey === KPOP_ARTISTS_PACK_ID) return true
  const linkedPack = await db.select({ id: contentPacks.id })
    .from(contentPacks)
    .where(eq(contentPacks.id, variantKey))
    .limit(1)
  return Boolean(linkedPack[0])
}
