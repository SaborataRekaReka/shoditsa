import { describe, expect, it } from 'vitest'
import { parseMovieList } from './pipeline-manual-input'

describe('manual movie input', () => {
  it('accepts movie names one per line like the music pipeline', () => {
    expect(parseMovieList([
      'В поисках Немо (Finding Nemo, 2003)',
      'Чёрная Пантера (Black Panther, 2018)',
      'Бэтмен (The Batman, 2022)',
    ].join('\n'))).toEqual([
      { query: 'В поисках Немо', year: 2003 },
      { query: 'Чёрная Пантера', year: 2018 },
      { query: 'Бэтмен', year: 2022 },
    ])
  })

  it('keeps support for Kinopoisk IDs and links', () => {
    expect(parseMovieList('326\nhttps://www.kinopoisk.ru/film/435/\nkp535341')).toEqual([
      { kinopoiskId: 326 },
      { kinopoiskId: 435 },
      { kinopoiskId: 535341 },
    ])
  })

  it('does not mistake a release year for a Kinopoisk ID', () => {
    expect(parseMovieList('Грешники (Sinners, 2025)')).toEqual([{ query: 'Грешники', year: 2025 }])
  })

  it('supports a plain title and title-comma-year format', () => {
    expect(parseMovieList('Интерстеллар\nМатрица, 1999')).toEqual([
      { query: 'Интерстеллар' },
      { query: 'Матрица', year: 1999 },
    ])
  })
})
