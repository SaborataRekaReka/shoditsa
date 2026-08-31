import { describe, expect, it } from 'vitest'
import { nextDailyMode, nextResultMode, resultRecommendedModes } from './daily-route'

describe('daily route', () => {
  it('selects the first unfinished mode after the last selected mode', () => {
    expect(nextDailyMode('movie', ['movie', 'anime'])).toBe('series')
    expect(nextDailyMode('music', ['movie', 'series', 'anime', 'game', 'music'])).toBe('diagnosis')
  })

  it('wraps around and stops after every manifest mode is complete', () => {
    expect(nextDailyMode('diagnosis', ['diagnosis'])).toBe('animal')
    expect(nextDailyMode('animal', ['animal'])).toBe('book')
    expect(nextDailyMode('book', ['book'])).toBe('character')
    expect(nextDailyMode('character', ['character'])).toBe('movie')
    expect(nextDailyMode('movie', ['movie', 'series', 'anime', 'game', 'city', 'music', 'diagnosis', 'animal', 'book', 'character'])).toBeNull()
  })

  it('prioritizes the three diagnosis follow-up games without hiding the alternatives', () => {
    expect(nextResultMode('diagnosis', ['diagnosis'])).toBe('animal')
    expect(nextResultMode('diagnosis', ['diagnosis', 'animal'])).toBe('character')
    expect(resultRecommendedModes('diagnosis', 'character')).toEqual(['animal', 'book'])
    expect(resultRecommendedModes('movie', 'series')).toEqual([])
  })
})
