import { describe, expect, it } from 'vitest'
import { canUseFriendsRoom, friendsRoomRegistrationHref } from './friends-room-access'

describe('friends room access', () => {
  it('allows permanent accounts in production and keeps anonymous preview opt-ins', () => {
    expect(canUseFriendsRoom({ isAnonymous: false }, { dev: false, preview: false })).toBe(true)
    expect(canUseFriendsRoom({ isAnonymous: true }, { dev: false, preview: false })).toBe(false)
    expect(canUseFriendsRoom({ isAnonymous: true }, { dev: true, preview: false })).toBe(true)
    expect(canUseFriendsRoom({ isAnonymous: true }, { dev: false, preview: true })).toBe(true)
  })

  it('preserves the invited room in the registration return URL', () => {
    expect(friendsRoomRegistrationHref('/games/together?room=AB234')).toBe(
      '/register?returnUrl=%2Fgames%2Ftogether%3Froom%3DAB234',
    )
  })
})
