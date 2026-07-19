import { describe, expect, it } from 'vitest'
import { pathnameForPlayerRoute, playerRouteFromPathname } from './routes'

describe('typed player routes', () => {
  it('round-trips every canonical mode through title and local-play routes', async () => {
    const { PLAYABLE_MODE_IDS } = await import('@shoditsa/contracts')
    for (const mode of PLAYABLE_MODE_IDS) {
      const titlePath = pathnameForPlayerRoute({ screen: 'title', mode })
      const gamePath = pathnameForPlayerRoute({ screen: 'game', mode })
      expect(playerRouteFromPathname(titlePath)).toEqual({ screen: 'title', mode })
      expect(playerRouteFromPathname(gamePath)).toEqual({ screen: 'game', mode })
    }
  })

  it('maps server sessions and stable utility screens', () => {
    expect(playerRouteFromPathname('/sessions/session-1')).toEqual({ screen: 'game', sessionId: 'session-1' })
    expect(pathnameForPlayerRoute({ screen: 'rewatch' })).toBe('/archive')
    expect(pathnameForPlayerRoute({ screen: 'profile' })).toBe('/profile')
    expect(playerRouteFromPathname('/games/not-a-mode')).toEqual({ screen: 'hub' })
  })
})
