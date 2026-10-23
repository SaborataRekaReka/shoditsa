import { describe, expect, it } from 'vitest'
import { applicationSection, canonicalApplicationHref, isApplicationShellPage } from './routes'

const location = (href: string) => new URL(href, 'http://localhost')
describe('application route migration', () => {
  it.each(['/', '/archive', '/profile', '/club', '/club/membership', '/leaderboard', '/quests', '/settings'])('loads the same new shell directly at %s in both runtimes', path => {
    expect(applicationSection(path)).toBeTruthy()
    expect(isApplicationShellPage(location(path), false)).toBe(true)
    expect(isApplicationShellPage(location(path), true)).toBe(true)
    expect(canonicalApplicationHref(location(path))).toBeUndefined()
  })
  it.each([
    ['/shoditsa-home.html?variant=a', '/?variant=a'],
    ['/shoditsa-title.html#archive', '/archive'],
    ['/shoditsa-title.html#play', '/'],
    ['/shoditsa-title.html?mode=movie', '/games/movie'],
    ['/shoditsa-play.html#play', '/play/anime'],
    ['/?preview=reference#/club?preview=reference&section=library', '/club'],
    ['/?preview=reference#/club?section=offers', '/club/membership'],
    ['/?preview=reference&studyMode=city&studyVariant=all#/play/city?preview=reference', '/play/city?variant=all'],
    ['/archive?preview=reference&mode=music', '/archive?mode=music'],
    ['/#/sessions/actual-session?preview=reference', '/sessions/actual-session'],
  ])('replaces legacy entry %s without an HTML redirect', (before, after) => {
    expect(canonicalApplicationHref(location(before))).toBe(after)
    expect(canonicalApplicationHref(location(after))).toBeUndefined()
  })
  it('leaves real session, invitation, account and challenge controllers in charge', () => {
    for (const path of ['/play/movie', '/sessions/session-id', '/games/together', '/login', '/?challenge=3', '/?token=recovery']) {
      expect(isApplicationShellPage(location(path), true)).toBe(false)
      expect(canonicalApplicationHref(location(path))).toBeUndefined()
    }
  })
  it('preserves business parameters and saved-game keys', () => {
    const url = location('/play/city?game=city%7Call%7C2026-10-20&variant=all&preview=reference')
    expect(canonicalApplicationHref(url)).toBe('/play/city?game=city%7Call%7C2026-10-20&variant=all')
  })
})
