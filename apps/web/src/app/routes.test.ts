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
    expect(playerRouteFromPathname('/club')).toEqual({ screen: 'club' })
    expect(pathnameForPlayerRoute({ screen: 'club' })).toBe('/club')
    expect(playerRouteFromPathname('/specials')).toEqual({ screen: 'specials' })
    expect(playerRouteFromPathname('/specials/dtf-games-promo-30-v1')).toEqual({ screen: 'special', packId: 'dtf-games-promo-30-v1' })
    expect(pathnameForPlayerRoute({ screen: 'special', packId: 'pack one' })).toBe('/specials/pack%20one')
    expect(playerRouteFromPathname('/create-a-game')).toEqual({ screen: 'create-game' })
    expect(playerRouteFromPathname('/purchase/return')).toEqual({ screen: 'purchase-return' })
    expect(playerRouteFromPathname('/games/danetki')).toEqual({ screen: 'hub' })
    expect(playerRouteFromPathname('/play/danetki')).toEqual({ screen: 'hub' })
    expect(playerRouteFromPathname('/games/not-a-mode')).toEqual({ screen: 'hub' })
  })
})
