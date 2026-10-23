import { describe, expect, it } from 'vitest'
import { applicationContinueHref } from './ApplicationContinueLink'
import type { ApplicationGame } from './useApplicationGames'
const game = (mode: ApplicationGame['mode'], status = 'playing'): ApplicationGame => ({ id: mode, mode, status, href: `/sessions/${mode}`, title: mode, date: '2026-10-23', attempts: 2 })
describe('quest continuation', () => {
  it('continues the anime quest session and otherwise the available unfinished game', () => {
    expect(applicationContinueHref([game('movie'), game('anime')])).toBe('/sessions/anime')
    expect(applicationContinueHref([game('movie'), game('anime', 'won')])).toBe('/sessions/movie')
  })
  it('starts today’s anime when there is no unfinished session', () => {
    expect(applicationContinueHref([])).toBe('/play/anime')
    expect(applicationContinueHref([game('anime', 'lost')])).toBe('/play/anime')
  })
})
