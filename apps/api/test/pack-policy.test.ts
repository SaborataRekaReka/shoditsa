import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KPOP_ARTISTS_PACK_ID } from '@shoditsa/contracts'
import { DTF_COMMENTS_PACK_ID, isAdminOnlyPack, requiredBadgeForPack } from '../src/modules/packs/policy.js'
import { hasEntitlement } from '../src/modules/commerce/entitlements.js'
import { canAccessPack, canViewPack } from '../src/modules/packs/access.js'

vi.mock('../src/modules/commerce/entitlements.js', () => ({
  hasEntitlement: vi.fn(),
}))

const publishedPackDb = () => {
  const query = {
    from: () => query,
    where: () => query,
    limit: async () => [{ status: 'published' }],
  }
  return { select: () => query } as never
}

describe('special pack visibility and access policy', () => {
  beforeEach(() => {
    vi.mocked(hasEntitlement).mockReset()
  })

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

  it('lets a non-club user launch a specifically granted special', async () => {
    vi.mocked(hasEntitlement).mockResolvedValueOnce(true)

    await expect(canAccessPack(publishedPackDb(), 'user-id', KPOP_ARTISTS_PACK_ID, 1)).resolves.toEqual({
      allowed: true,
      source: 'personal',
    })
    expect(hasEntitlement).toHaveBeenCalledWith(
      expect.anything(),
      'user-id',
      'pack',
      KPOP_ARTISTS_PACK_ID,
      expect.any(Date),
    )
    expect(hasEntitlement).toHaveBeenCalledTimes(1)
  })

  it('falls back to club access when there is no personal grant', async () => {
    vi.mocked(hasEntitlement).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(canAccessPack(publishedPackDb(), 'user-id', KPOP_ARTISTS_PACK_ID, 1)).resolves.toEqual({
      allowed: true,
      source: 'club',
    })
    expect(hasEntitlement).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'user-id',
      'club',
      undefined,
      expect.any(Date),
    )
  })
})
