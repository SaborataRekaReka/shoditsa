import { describe, expect, it } from 'vitest'
import { resolveClubLibraryAccess } from './club-library-access'

const base = { connected: true, loading: false, error: false, authenticated: false, membership: 'guest' as const }

describe('club library access', () => {
  it('shows an error before loading while connected instead of classifying the visitor as a guest', () => {
    expect(resolveClubLibraryAccess({ ...base, loading: true, error: true })).toBe('error')
  })

  it('waits for the connected membership check instead of classifying the visitor as a guest', () => {
    expect(resolveClubLibraryAccess({ ...base, loading: true })).toBe('loading')
  })

  it('ignores unavailable connection status in an autonomous preview', () => {
    expect(resolveClubLibraryAccess({ ...base, connected: false, loading: true, error: true })).toBe('guest')
  })

  it('opens the library for an active member after the check completes', () => {
    expect(resolveClubLibraryAccess({ ...base, authenticated: true, membership: 'active' })).toBe('member')
  })

  it('keeps a signed-out visitor in the guest state', () => {
    expect(resolveClubLibraryAccess(base)).toBe('guest')
  })

  it('keeps a signed-in account without a club ticket in the non-member state', () => {
    expect(resolveClubLibraryAccess({ ...base, authenticated: true })).toBe('non-member')
  })

  it('keeps an expired ticket closed for a signed-in account', () => {
    expect(resolveClubLibraryAccess({ ...base, authenticated: true, membership: 'expired' })).toBe('non-member')
  })
})
