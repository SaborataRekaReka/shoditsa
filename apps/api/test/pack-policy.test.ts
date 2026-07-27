import { describe, expect, it } from 'vitest'
import { KPOP_ARTISTS_PACK_ID } from '@shoditsa/contracts'
import { DTF_COMMENTS_PACK_ID, isAdminOnlyPack, requiredBadgeForPack } from '../src/modules/packs/policy.js'
import { canViewPack } from '../src/modules/packs/access.js'

describe('club-only pack visibility policy', () => {
  it('publishes K-pop and DTF storefront cards without legacy gates', () => {
    expect(isAdminOnlyPack(KPOP_ARTISTS_PACK_ID)).toBe(false)
    expect(isAdminOnlyPack(DTF_COMMENTS_PACK_ID)).toBe(false)
    expect(requiredBadgeForPack(DTF_COMMENTS_PACK_ID)).toBeNull()
  })

  it('shows every published special to guests and hides drafts from players', async () => {
    await expect(canViewPack({} as never, null, KPOP_ARTISTS_PACK_ID, 'player', 'published')).resolves.toBe(true)
    await expect(canViewPack({} as never, 'user-id', KPOP_ARTISTS_PACK_ID, 'player', 'draft')).resolves.toBe(false)
    await expect(canViewPack({} as never, null, KPOP_ARTISTS_PACK_ID, 'admin', 'draft')).resolves.toBe(true)
  })
})
