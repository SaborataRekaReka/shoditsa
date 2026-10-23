export type ClubLibraryAccess = 'loading' | 'error' | 'guest' | 'non-member' | 'member'

export function resolveClubLibraryAccess(input: {
  connected: boolean
  loading: boolean
  error: boolean
  authenticated: boolean
  membership: 'guest' | 'active' | 'expired'
}): ClubLibraryAccess {
  if (input.connected && input.error) return 'error'
  if (input.connected && input.loading) return 'loading'
  if (input.membership === 'active') return 'member'
  return input.authenticated ? 'non-member' : 'guest'
}
