import { describe, expect, it } from 'vitest'
import type { TitleItem } from '../types'
import { resultCardMeta, resultCardTags } from './result-presentation'

const item = (overrides: Partial<TitleItem>): TitleItem => ({
  id: 'test',
  mode: 'movie',
  titleRu: 'Название',
  titleOriginal: '',
  alternativeTitles: [],
  popularityScore: 1,
  ...overrides,
})

describe('result presentation', () => {
  it('uses the music activity contract and canonical genre spelling', () => {
    const artist = item({
      mode: 'music',
      activityStartYear: 2010,
      year: 1985,
      musicType: 'Solo',
      countries: ['AZ'],
      genres: ['hip hop'],
    })

    expect(resultCardMeta(artist)).toContain('с 2010')
    expect(resultCardMeta(artist)).toContain('Азербайджан')
    expect(resultCardMeta(artist)).not.toContain('1985')
    expect(resultCardTags(artist)).toEqual(['hip-hop'])
  })

  it('shows the platform identity for title-level games', () => {
    const game = item({
      mode: 'game',
      year: 1987,
      releaseScope: 'title',
      platforms: ['Arcade', 'NES'],
      genres: ['Action'],
    })

    expect(resultCardMeta(game)).toBe('1987 · Arcade · NES')
    expect(resultCardTags(game)).toEqual(['Action', 'Arcade', 'NES'])
  })
})
