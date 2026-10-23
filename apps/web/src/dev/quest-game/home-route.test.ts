import { describe, expect, it } from 'vitest'
import { studyHomeHref, isStudyRootHomeLocation } from './home-route'

const rootIsHome = (href: string) => isStudyRootHomeLocation(new URL(href, 'http://localhost'))

describe('default entry of the local study', () => {
  it.each(['/', '/index.html', '/#/', '/#'])('opens the current home from %s', href => {
    expect(rootIsHome(href)).toBe(true)
  })
  it('recognizes home variants and anchors without changing the requested URL', () => {
    expect(rootIsHome('/?preview=reference&variant=b#home-games')).toBe(true)
    expect(rootIsHome('/?variant=unknown#games')).toBe(true)
  })
  it.each(['home-main', 'home-games', 'home-guide', 'home-quiz', 'home-logic', 'home-company', 'home-specials', 'world-culture', 'world-discover', 'world-logic'])('keeps the current home when re-entering section #%s', section => {
    expect(rootIsHome(`/#${section}`)).toBe(true)
    expect(isStudyRootHomeLocation({ pathname: '/', search: '', hash: section })).toBe(true)
    expect(rootIsHome(`/?variant=c#${section}`)).toBe(true)
    expect(rootIsHome(`/?challenge=3#${section}`)).toBe(false)
  })
  it.each([
    '/?preview=reference&studyMode=anime&studyPeriod=all#/play/anime?preview=reference',
    '/#/games/movie', '/#/play/city', '/#/sessions/session-id', '/#/club?section=library',
    '/?play=movie&date=2026-10-21', '/?challenge=3', '/?token=recovery', '/?tab=profile',
    '/games/movie', '/login', '/shoditsa-home.html?variant=a',
  ])('preserves the existing game or account destination %s', href => {
    expect(rootIsHome(href)).toBe(false)
  })
})

describe('return from title/play to the selected local home', () => {
  it.each(['a', 'b', 'c'])('retains composition %s in both brand and Play destinations', variant => {
    const home = variant === 'a' ? '/' : `/?variant=${variant}`
    expect(studyHomeHref(variant)).toBe(home)
    expect(studyHomeHref(variant, true)).toBe(home)
  })
  it('leaves standalone studies alone when no known home is selected', () => {
    for (const value of [null, '', 'unknown', 'https://example.com']) expect(studyHomeHref(value)).toBeUndefined()
  })
})
