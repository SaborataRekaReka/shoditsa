import { describe, expect, it } from 'vitest'
import { PLAYABLE_CATALOG_GUESS_MODE_IDS } from '@shoditsa/contracts'
import { isStudySessionPresentation, localStudyLaunchHref, localStudyLaunchOptions, localStudyLaunchDate } from './local-study-launch'
import { playerRouteFromLocation } from './routes'

describe('home title to real local game', () => {
  it.each(PLAYABLE_CATALOG_GUESS_MODE_IDS)('launches the current %s controller instead of a demo fixture', mode => {
    const target = new URL(localStudyLaunchHref(mode, { period: 'from_2000', difficulty: 'expert', variant: 'all' }), 'http://localhost')
    expect(target.pathname).toBe(`/play/${mode}`)
    expect(target.hash).toBe('')
    expect(target.searchParams.has('preview')).toBe(false)
    expect(playerRouteFromLocation(target.pathname, target.search)).toEqual({ screen: 'game', mode })
    expect(localStudyLaunchOptions(target.search, mode)).toEqual({
      period: ['movie', 'series', 'anime'].includes(mode) ? 'from_2000' : 'all',
      difficulty: mode === 'music' ? 'expert' : 'medium',
      variant: mode === 'city' ? 'all' : null,
    })
  })
})

describe('local study launch options', () => {
  it('preserves a valid archive date and rejects invalid or future dates', () => {
    expect(localStudyLaunchDate('?date=2026-10-20', '2026-10-21')).toBe('2026-10-20')
    for (const search of ['', '?date=2026-10-22', '?date=2026-02-30', '?date=invalid']) expect(localStudyLaunchDate(search, '2026-10-21')).toBe('2026-10-21')
  })
  it('only reads options for the matching comparable mode', () => {
    expect(localStudyLaunchOptions('?studyMode=anime', 'movie')).toBeUndefined()
    expect(localStudyLaunchOptions('?studyMode=connections', 'connections')).toBeUndefined()
    expect(localStudyLaunchOptions('?studyMode=movie')).toBeUndefined()
  })
  it('keeps period, music difficulty and city set separate', () => {
    expect(localStudyLaunchOptions('?studyMode=movie&studyPeriod=from_2000&studyDifficulty=expert', 'movie')).toEqual({ period: 'from_2000', difficulty: 'medium', variant: null })
    expect(localStudyLaunchOptions('?studyMode=music&studyPeriod=from_2000&studyDifficulty=expert', 'music')).toEqual({ period: 'all', difficulty: 'expert', variant: null })
    expect(localStudyLaunchOptions('?studyMode=city&studyVariant=all', 'city')).toEqual({ period: 'all', difficulty: 'medium', variant: 'all' })
  })
  it('rejects invalid choices instead of passing them to a game', () => {
    expect(localStudyLaunchOptions('?studyMode=movie&studyPeriod=bogus', 'movie')?.period).toBe('all')
    expect(localStudyLaunchOptions('?studyMode=music&studyDifficulty=bogus', 'music')?.difficulty).toBe('medium')
    expect(localStudyLaunchOptions('?studyMode=city&studyVariant=bogus', 'city')?.variant).toBeNull()
  })
})

describe('local session presentation boundary', () => {
  const input = { dev: true, local: true, study: true, source: 'local' as const, search: '?preview=reference&studyMode=series' }
  it('activates only for an explicit comparable-game launch in the local study profile', () => {
    expect(isStudySessionPresentation(input)).toBe(true)
    for (const patch of [{ dev: false }, { local: false }, { study: false }, { source: 'server' as const }, { search: '?preview=reference' }, { search: '?studyMode=danetki' }, { search: '?studyMode=unknown' }]) {
      expect(isStudySessionPresentation({ ...input, ...patch })).toBe(false)
    }
  })
})
