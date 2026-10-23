import { afterEach, describe, expect, it, vi } from 'vitest'
import { applicationLink, installApplicationNavigator, navigateApplication } from './application-navigation'

afterEach(() => vi.unstubAllGlobals())

describe('navigation into games', () => {
  const origin = 'https://shoditsa.ru'
  it('keeps launch settings and saved-game identifiers intact', () => {
    for (const href of ['/games/movie', '/play/movie?period=from_2000', '/play/music?difficulty=hard', '/play/city?variant=world', '/play/series?game=series%7Call%7C2026-10-20%7Csalt%3A3', '/sessions/session-123']) {
      expect(applicationLink(href, origin)).toBe(href)
    }
  })
  it('shares section routes and the home games anchor', () => {
    for (const href of ['/', '/lobby', '/archive', '/profile', '/leaderboard?period=all', '/quests', '/settings', '/club/membership', '/#home-games']) expect(applicationLink(href, origin)).toBe(href)
  })
  it('opens the friends intro in the player router and preserves room creation settings', () => {
    for (const href of ['/games/together', '/games/together?new=1', '/games/together?new=1&mode=movie']) expect(applicationLink(href, origin)).toBe(href)
    expect(applicationLink('https://elsewhere.test/games/together', origin)).toBeUndefined()
  })
  it('opens support, the blog and individual posts in the player router', () => {
    for (const href of ['/support', '/blog', '/blog/support-and-blog', '/blog/support-and-blog?from=footer', '/blog/']) expect(applicationLink(href, origin)).toBe(href)
    for (const href of ['https://elsewhere.test/support', '/support/unknown', '/blog/post/unknown']) expect(applicationLink(href, origin)).toBeUndefined()
  })
  it('opens special shows in the same document while leaving external and nested URLs native', () => {
    for (const href of ['/specials', '/specials/dtf-game-comments-25-v1', '/specials/kpop-artists-admin-v1', '/specials/pack%20one?from=home']) expect(applicationLink(href, origin)).toBe(href)
    for (const href of ['https://elsewhere.test/specials/pack', '/specials/pack/unknown']) expect(applicationLink(href, origin)).toBeUndefined()
  })
  it('does not hijack auth, external URLs, unsupported games or document anchors', () => {
    for (const href of ['https://elsewhere.test/play/movie', '/login', '/register', '/api/games', '/games/nonexistent', '/games/movie#rules', '/?panel=settings', 'javascript:alert(1)']) expect(applicationLink(href, origin)).toBeUndefined()
  })
  it('uses the installed router and preserves replace navigation', async () => {
    const assign = vi.fn(), replace = vi.fn(), navigate = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { location: { origin, assign, replace } })
    const uninstall = installApplicationNavigator(navigate)
    try {
      await navigateApplication(`${origin}/play/movie?period=from_2000`, true)
      expect(navigate).toHaveBeenCalledWith('/play/movie?period=from_2000', true)
      expect(assign).not.toHaveBeenCalled()
      expect(replace).not.toHaveBeenCalled()
    } finally { uninstall() }
  })
  it('retains normal browser navigation outside the integrated router', async () => {
    const assign = vi.fn(), replace = vi.fn()
    vi.stubGlobal('window', { location: { origin, assign, replace } })
    await navigateApplication('/play/movie')
    await navigateApplication('/login', true)
    expect(assign).toHaveBeenCalledWith('/play/movie')
    expect(replace).toHaveBeenCalledWith('/login')
  })
})
