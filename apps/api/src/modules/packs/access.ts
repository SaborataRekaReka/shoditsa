import { eq } from 'drizzle-orm'
import { contentPacks, type Database } from '@shoditsa/database'
import type { ApiRole } from '@shoditsa/contracts'
import { hasEntitlement } from '../commerce/entitlements.js'
import { isAdminOnlyPack } from './policy.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReadDatabase = Database | Transaction

export type PackAccessSource = 'admin' | 'free' | 'preview' | 'club' | 'purchase' | 'locked'

export const canAccessPack = async (
  db: ReadDatabase,
  userId: string | null,
  packId: string,
  position: number,
  role: ApiRole = 'player',
  now = new Date(),
): Promise<{ allowed: boolean; source: PackAccessSource }> => {
  const rows = await db.select().from(contentPacks).where(eq(contentPacks.id, packId)).limit(1)
  const pack = rows[0]
  if (!pack) return { allowed: false, source: 'locked' }
  if (role === 'admin') return { allowed: true, source: 'admin' }
  if (isAdminOnlyPack(packId)) return { allowed: false, source: 'locked' }
  if (pack.status !== 'published') return { allowed: false, source: 'locked' }
  if (pack.accessModel === 'free') return { allowed: true, source: 'free' }
  if (position <= pack.previewItems) return { allowed: true, source: 'preview' }
  if (!userId) return { allowed: false, source: 'locked' }
  if (await hasEntitlement(db, userId, 'pack', packId, now)) return { allowed: true, source: 'purchase' }
  if (pack.includedInClub && await hasEntitlement(db, userId, 'club', undefined, now)) return { allowed: true, source: 'club' }
  return { allowed: false, source: 'locked' }
}

export const hasPermanentPackAccess = (db: ReadDatabase, userId: string, packId: string, now = new Date()) =>
  hasEntitlement(db, userId, 'pack', packId, now)
