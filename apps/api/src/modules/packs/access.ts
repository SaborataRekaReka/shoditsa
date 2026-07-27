import { eq } from 'drizzle-orm'
import { contentPacks, type Database } from '@shoditsa/database'
import type { ApiRole } from '@shoditsa/contracts'
import { hasEntitlement } from '../commerce/entitlements.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReadDatabase = Database | Transaction

export type PackAccessSource = 'admin' | 'personal' | 'club' | 'locked'

// Visibility is deliberately separate from launch access: every published
// special is a public storefront card, while drafts and archives stay admin-only.
export const canViewPack = async (
  _db: ReadDatabase,
  _userId: string | null,
  _packId: string,
  role: ApiRole = 'player',
  status = 'published',
) => role === 'admin' || status === 'published'

export const canAccessPack = async (
  db: ReadDatabase,
  userId: string | null,
  packId: string,
  _position: number,
  role: ApiRole = 'player',
  now = new Date(),
): Promise<{ allowed: boolean; source: PackAccessSource }> => {
  const pack = (await db.select({ status: contentPacks.status }).from(contentPacks).where(eq(contentPacks.id, packId)).limit(1))[0]
  if (!pack) return { allowed: false, source: 'locked' }
  if (role === 'admin') return { allowed: true, source: 'admin' }
  if (pack.status !== 'published' || !userId) return { allowed: false, source: 'locked' }
  if (await hasEntitlement(db, userId, 'pack', packId, now)) return { allowed: true, source: 'personal' }
  if (await hasEntitlement(db, userId, 'club', undefined, now)) return { allowed: true, source: 'club' }
  return { allowed: false, source: 'locked' }
}
