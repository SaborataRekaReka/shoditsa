import { describe, expect, it } from 'vitest'
import { nextDailyMode } from './daily-route'

describe('daily route', () => {
  it('selects the first unfinished mode after the last selected mode', () => {
    expect(nextDailyMode('movie', ['movie', 'anime'])).toBe('series')
    expect(nextDailyMode('music', ['movie', 'series', 'anime', 'game', 'music'])).toBe('diagnosis')
  })

  it('wraps around and stops after every manifest mode is complete', () => {
    expect(nextDailyMode('diagnosis', ['diagnosis'])).toBe('movie')
    expect(nextDailyMode('movie', ['movie', 'series', 'anime', 'game', 'city', 'music', 'diagnosis'])).toBeNull()
  })
})
