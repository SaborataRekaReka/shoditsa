import { describe, expect, it } from 'vitest'
import type { TitleItem } from '../types'
import { searchEmptyMessage, searchMediaAlt, searchResultMeta } from './search-presentation'

const item = (overrides: Partial<TitleItem>): TitleItem => ({
  id: 'test',
  mode: 'movie',
  titleRu: 'Название',
  titleOriginal: '',
  alternativeTitles: [],
  popularityScore: 1,
  ...overrides,
})

describe('search presentation contract', () => {
  it('does not render poster or empty year vocabulary for cities and diagnoses', () => {
    const city = item({ mode: 'city', titleRu: 'Москва', titleOriginal: 'Moscow', country: 'Россия' })
    const diagnosis = item({ mode: 'diagnosis', titleRu: 'Импетиго', titleOriginal: 'Impetigo', icd10: ['L01'] })

    expect(searchMediaAlt(city)).toBe('Символ города «Москва»')
    expect(searchResultMeta(city)).toBe('Moscow · Россия')
    expect(searchResultMeta(diagnosis)).toBe('Impetigo · L01')
    expect(searchResultMeta(city)).not.toContain('—')
    expect(searchResultMeta(diagnosis)).not.toContain('—')
  })

  it('identifies a game version with platforms before an attempt is spent', () => {
    expect(searchResultMeta(item({
      mode: 'game',
      titleRu: 'Double Dragon',
      titleOriginal: 'Double Dragon',
      year: 1987,
      platforms: ['Arcade', 'NES'],
    }))).toBe('1987 · Arcade · NES')

    expect(searchResultMeta(item({
      mode: 'game',
      titleRu: 'Port',
      titleOriginal: '',
      year: 1991,
      releaseScope: 'release',
      releaseLabel: 'Commodore 64 port',
      platforms: ['Commodore 64'],
    }))).toBe('1991 · Commodore 64 port · Commodore 64')
  })

  it('explains that an empty result belongs to the current pool', () => {
    expect(searchEmptyMessage('series')).toContain('В текущем пуле сериал не найден')
  })
})
