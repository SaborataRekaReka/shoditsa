import { describe, expect, it } from 'vitest'
import { KPOP_ARTISTS_PACK_ID } from '@shoditsa/contracts'
import {
  DTF_COMMENTS_PACK_ID,
  isAdminOnlyPack,
  requiredBadgeForPack,
} from '../src/modules/packs/policy.js'
import { canViewPack } from '../src/modules/packs/access.js'

const entitlementDatabase = (granted: boolean) => {
  const query = {
    from: () => query,
    where: () => query,
    limit: async () => granted ? [{ id: 'entitlement-id' }] : [],
  }
  return { select: () => query }
}

describe('pack visibility policy', () => {
  it('keeps the K-pop special outside public visibility', () => {
    expect(isAdminOnlyPack(KPOP_ARTISTS_PACK_ID)).toBe(true)
    expect(requiredBadgeForPack(KPOP_ARTISTS_PACK_ID)).toBeNull()
  })

  it('lets an explicit per-user grant reveal an unpublished special', async () => {
    await expect(canViewPack(
      entitlementDatabase(true) as never,
      'user-id',
      KPOP_ARTISTS_PACK_ID,
      'player',
      'draft',
    )).resolves.toBe(true)
    await expect(canViewPack(
      entitlementDatabase(false) as never,
      'user-id',
      KPOP_ARTISTS_PACK_ID,
      'player',
      'draft',
    )).resolves.toBe(false)
  })

  it('preserves the community badge policy for the DTF pack', () => {
    expect(isAdminOnlyPack(DTF_COMMENTS_PACK_ID)).toBe(false)
    expect(requiredBadgeForPack(DTF_COMMENTS_PACK_ID)).toBe('dtf')
  })
})
