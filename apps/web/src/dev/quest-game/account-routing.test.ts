import { describe, expect, it } from 'vitest'
import { studyAccountHref, studyAccountRequest, studyPasswordRecoveryHref, studyReturnUrl } from './account-routing'

describe('local study account navigation', () => {
  it('opens password recovery with a safe return to the settings screen', () => {
    const returnUrl = '/shoditsa-title.html?panel=settings#profile'
    const href = new URL(studyPasswordRecoveryHref(returnUrl), 'http://localhost')
    expect(href.pathname).toBe('/login')
    expect(href.searchParams.get('flow')).toBe('forgot')
    expect(href.searchParams.get('returnUrl')).toBe(returnUrl)
    const request = new URL(studyAccountRequest(href.pathname + href.search)!, 'http://localhost')
    expect(request.searchParams.get('flow')).toBe('forgot')
    expect(request.searchParams.get('screen')).toBe('login')
    expect(request.searchParams.get('returnUrl')).toBe(returnUrl)
  })
  it('retains the game path, launch settings and hash after sign in', () => {
    const game = '/?studyMode=series&studyPeriod=all#/play/series?preview=reference'
    const href = new URL(studyAccountHref('login', game), 'http://localhost')
    expect(href.pathname).toBe('/login')
    expect(href.searchParams.get('returnUrl')).toBe(game)
    expect(studyReturnUrl(game)).toBe(game)
  })
  it.each(['https://example.org/private', '//example.org', 'javascript:alert(1)', 'data:text/html,hello', '/\\example.org'])('rejects an external return destination: %s', value => {
    expect(studyReturnUrl(value)).toBe('/')
  })
  it('opens an admin sign-in gate without claiming admin access', () => {
    const href = new URL(studyAccountHref('admin', '/games/series'), 'http://localhost')
    expect(href.pathname).toBe('/admin')
    expect(href.searchParams.get('from')).toBe('/games/series')
    expect(studyAccountRequest(href.pathname + href.search)).toBe('/shoditsa-auth.html?from=%2Fgames%2Fseries&screen=admin')
  })
  it('rewrites only account entry paths and preserves return parameters', () => {
    for (const screen of ['login', 'register']) {
      const request = new URL(studyAccountRequest(`/${screen}?returnUrl=%2Fgames%2Fanime`)!, 'http://localhost')
      expect(request.pathname).toBe('/shoditsa-auth.html')
      expect(request.searchParams.get('screen')).toBe(screen)
      expect(request.searchParams.get('returnUrl')).toBe('/games/anime')
    }
    for (const path of ['/api/auth/sign-in', '/admin/users', '/', '/games/anime', '/legal/privacy']) expect(studyAccountRequest(path)).toBeUndefined()
  })
})
