import { describe, expect, it } from 'vitest'
import type { TitleItem } from '@shoditsa/contracts'
import { publicCard } from '../src/modules/games/service.js'

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
})