import { describe, expect, it } from 'vitest'
import { pathnameForPlayerRoute, playerRouteFromLocation, playerRouteFromPathname } from './routes'

describe('typed player routes', () => {
  it('round-trips every canonical mode through title and local-play routes', async () => {
    const { PLAYABLE_MODE_IDS } = await import('@shoditsa/contracts')
    for (const mode of PLAYABLE_MODE_IDS) {
      const titlePath = pathnameForPlayerRoute({ screen: 'title', mode })
      const gamePath = pathnameForPlayerRoute({ screen: 'game', mode })
      if (mode === 'danetki') {
        expect(titlePath).toBe('/games/danetki')
        expect(gamePath).toBe('/games/danetki')
        expect(playerRouteFromPathname(titlePath)).toEqual({ screen: 'danetki' })
        continue
      }
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
    expect(playerRouteFromPathname('/specials/dtf-game-comments-25-v1')).toEqual({ screen: 'special', packId: 'dtf-game-comments-25-v1' })
    expect(pathnameForPlayerRoute({ screen: 'special', packId: 'pack one' })).toBe('/specials/pack%20one')
    expect(playerRouteFromPathname('/partners')).toEqual({ screen: 'create-game' })
    expect(pathnameForPlayerRoute({ screen: 'create-game' })).toBe('/partners')
    expect(playerRouteFromPathname('/create-a-game')).toEqual({ screen: 'create-game' })
    expect(playerRouteFromPathname('/purchase/return')).toEqual({ screen: 'purchase-return' })
    expect(playerRouteFromPathname('/legal/privacy')).toEqual({ screen: 'legal', legalDocument: 'privacy' })
    expect(pathnameForPlayerRoute({ screen: 'legal', legalDocument: 'tariffs' })).toBe('/legal/tariffs')
    expect(playerRouteFromPathname('/legal/not-a-document')).toEqual({ screen: 'hub' })
    expect(playerRouteFromPathname('/games/danetki')).toEqual({ screen: 'danetki' })
    expect(playerRouteFromPathname('/danetki')).toEqual({ screen: 'danetki-catalog' })
    expect(playerRouteFromPathname('/danetki/dlya-detey')).toEqual({ screen: 'danetki-catalog', danetkiCollection: 'dlya-detey' })
    expect(playerRouteFromPathname('/danetki/slozhnye')).toEqual({ screen: 'danetki-catalog', danetkiCollection: 'slozhnye' })
    expect(playerRouteFromPathname('/danetki/legkie')).toEqual({ screen: 'danetki-catalog', danetkiCollection: 'legkie' })
    expect(playerRouteFromPathname('/danetki/novye')).toEqual({ screen: 'danetki-catalog', danetkiCollection: 'novye' })
    expect(playerRouteFromPathname('/danetki/verevka')).toEqual({ screen: 'danetki-story', danetkiSlug: 'verevka' })
    expect(pathnameForPlayerRoute({ screen: 'danetki-catalog' })).toBe('/danetki')
    expect(pathnameForPlayerRoute({ screen: 'danetki-catalog', danetkiCollection: 'dlya-detey' })).toBe('/danetki/dlya-detey')
    expect(pathnameForPlayerRoute({ screen: 'danetki-catalog', danetkiCollection: 'slozhnye' })).toBe('/danetki/slozhnye')
    expect(pathnameForPlayerRoute({ screen: 'danetki-story', danetkiSlug: 'verevka' })).toBe('/danetki/verevka')
    expect(playerRouteFromPathname('/games/together')).toEqual({ screen: 'friends-intro' })
    expect(playerRouteFromLocation('/games/together', '?new=1')).toEqual({ screen: 'friends-room' })
    expect(playerRouteFromLocation('/games/together', '?room=AB234')).toEqual({ screen: 'friends-room' })
    expect(playerRouteFromLocation('/games/together', '?mode=danetki')).toEqual({ screen: 'friends-room' })
    expect(playerRouteFromLocation('/games/together', '?mode=territory')).toEqual({ screen: 'friends-room' })
    expect(pathnameForPlayerRoute({ screen: 'friends-room' })).toBe('/games/together')
    expect(pathnameForPlayerRoute({ screen: 'friends-intro' })).toBe('/games/together')
    expect(playerRouteFromPathname('/play/danetki')).toEqual({ screen: 'hub' })
    expect(playerRouteFromPathname('/danetki/join/abc-123')).toEqual({ screen: 'danetki-join', inviteToken: 'abc-123' })
    expect(playerRouteFromPathname('/games/not-a-mode')).toEqual({ screen: 'hub' })
  })
})
