import { describe, expect, it } from 'vitest'
import type { TitleItem } from '@shoditsa/contracts'
import { buildHintOptions, publicCard } from '../src/modules/games/service.js'

describe('public game card', () => {
  it('keeps genres required by attempt cards', () => {
    const item = {
      id: 'kp_301',
      mode: 'movie',
      titleRu: 'Матрица',
      genres: ['фантастика', 'боевик'],
    } as TitleItem

    expect(publicCard(item).genres).toEqual(['фантастика', 'боевик'])
  })

  it('keeps extended facts required by server runtime cards', () => {
    const item = {
      id: 'tgdb_10836',
      mode: 'game',
      titleRu: 'F-Zero X',
      titleOriginal: 'F-Zero X',
      alternativeTitles: [],
      popularityScore: 0,
      year: 1998,
      genres: ['Racing'],
      developers: ['Nintendo EAD'],
      publishers: ['Nintendo of America, Inc.'],
      platforms: ['Nintendo 64'],
      steamCategories: ['4 игроков', 'Мультиплеер'],
      topRank: 563,
      posterUrl: '/data/libraries/games/img/tgdb_10836/poster.webp',
      keySymptoms: ['Лихорадка'],
      diagnostics: ['ПЦР'],
      riskFactors: ['Контакт с носителем'],
      topTracks: [{ rank: 1, title: 'Mute City', listeners: 1000 }],
      topAlbums: [{ rank: 1, title: 'F-Zero X OST', listeners: 1000 }],
      similarArtists: [{ rank: 1, name: 'Nintendo Sound Team', match: 90 }],
    } as TitleItem

    const card = publicCard(item)
    expect(card.developers).toEqual(['Nintendo EAD'])
    expect(card.publishers).toEqual(['Nintendo of America, Inc.'])
    expect(card.platforms).toEqual(['Nintendo 64'])
    expect(card.steamCategories).toEqual(['4 игроков', 'Мультиплеер'])
    expect(card.topTracks?.[0]?.title).toBe('Mute City')
    expect(card.keySymptoms).toEqual(['Лихорадка'])
    expect(card.posterUrl).toBe('/media/content/game/tgdb_10836/poster.webp')
  })

  it('normalizes people photo urls to media path', () => {
    const item = {
      id: 'kp_251733',
      mode: 'movie',
      titleRu: 'Аватар',
      titleOriginal: 'Avatar',
      alternativeTitles: [],
      popularityScore: 0,
      cast: [
        {
          nameRu: 'Сэм Уортингтон',
          nameOriginal: 'Sam Worthington',
          photoUrl: './data/libraries/people/img/84/842c7705dac914e1a3765e58bb2ca6d50117a5eb20e833d38133af5ca19a9ab3.webp',
        },
      ],
    } as TitleItem

    const card = publicCard(item)
    expect(card.cast?.[0]?.photoUrl).toBe('/media/people/84/842c7705dac914e1a3765e58bb2ca6d50117a5eb20e833d38133af5ca19a9ab3.webp')
  })
})

describe('server hint options', () => {
  it('does not repeat matched facts and removes matched values from list facts', () => {
    const answer = {
      id: 'game_1',
      mode: 'game',
      titleRu: 'Example game',
      titleOriginal: 'Example game',
      alternativeTitles: [],
      popularityScore: 0,
      year: 1998,
      genres: ['Racing', 'Action'],
      platforms: ['Nintendo 64'],
      developers: ['Nintendo EAD'],
      facts: ['Released in 1998.', 'It introduced a new championship mode.'],
    } as TitleItem
    const attempts = [{
      hints: [
        { key: 'year', label: 'Year', value: '1998', status: 'match' as const, direction: null },
        { key: 'genres', label: 'Genres', value: 'Racing', status: 'close' as const, direction: null, matchedValues: ['Racing'] },
      ],
    }]

    const options = buildHintOptions(answer, [], attempts)

    expect(options.find((option) => option.key === 'info')?.value).toBe('Жанры: Action')
    expect(options.find((option) => option.key === 'fact')?.value).toBe('It introduced a new championship mode.')
  })

  it('does not expose anime model fields as interesting facts', () => {
    const answer = {
      id: 'anime_1',
      mode: 'anime',
      titleRu: 'Пример аниме',
      titleOriginal: 'Example Anime',
      alternativeTitles: [],
      popularityScore: 0,
      year: 2024,
      animeKind: 'TV сериал',
      animeStatus: 'Вышло',
      episodes: 13,
      animeEpisodesAired: 12,
      facts: [
        'Формат: TV сериал',
        'Статус: Вышло',
        'Эпизоды: 13',
        'Вышло эпизодов: 12',
        'Настоящий дополнительный факт.',
      ],
    } as TitleItem

    const options = buildHintOptions(answer, [])

    expect(options.find((option) => option.key === 'fact')?.value).toBe('Настоящий дополнительный факт.')
  })

  it('falls back to the plot hint when anime facts only mirror model fields', () => {
    const answer = {
      id: 'anime_2',
      mode: 'anime',
      titleRu: 'Пример аниме',
      titleOriginal: 'Example Anime',
      alternativeTitles: [],
      popularityScore: 0,
      animeKind: 'TV сериал',
      animeStatus: 'Вышло',
      episodes: 12,
      facts: ['Формат: TV сериал', 'Статус: Вышло', 'Эпизоды: 12'],
      plotHint: 'Безопасная сюжетная подсказка.',
    } as TitleItem

    const options = buildHintOptions(answer, [])

    expect(options.find((option) => option.key === 'fact')?.value).toBe('Безопасная сюжетная подсказка.')
  })
})
