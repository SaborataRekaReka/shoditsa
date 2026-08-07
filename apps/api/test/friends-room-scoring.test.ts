import { describe, expect, it } from 'vitest'
import type { PlayableCatalogGuessModeId, TitleItem } from '@shoditsa/contracts'
import { scoreFriendsRoomGuess } from '../src/modules/friends-room/scoring.js'

const sharedByMode: Record<PlayableCatalogGuessModeId, Partial<TitleItem>> = {
  movie: { year: 2014, countries: ['Россия'], genres: ['драма'], directors: [{ nameRu: 'Режиссёр', nameOriginal: '' }] },
  series: { year: 2014, countries: ['Россия'], genres: ['драма'], seasonsCount: 3, showrunners: [{ nameRu: 'Шоураннер', nameOriginal: '' }] },
  anime: { year: 2014, genres: ['драма'], studios: ['Studio A'], animeKind: 'TV', episodes: 24 },
  game: { year: 2014, genres: ['RPG'], developers: ['Studio A'], platforms: ['PC'] },
  city: { country: 'Россия', continent: 'Европа', languages: ['русский'], population: 1_000_000, timezone: 'UTC+3' },
  music: { activityStartYear: 2014, countries: ['RU'], genres: ['рок'], musicType: 'Group', musicIsActive: true },
  diagnosis: { bodySystems: ['Дыхательная система'], keySymptoms: ['Кашель'], icdGroup: 'J00–J99', diseaseTypes: ['Инфекционное'] },
  animal: { taxonomicClass: 'Млекопитающие', animalOrder: 'Хищные', animalFamily: 'Кошачьи', habitats: ['Саванна'], animalContinents: ['Африка'], bodyMassKg: 100 },
  book: { bookAuthors: ['Автор'], bookCountry: 'Россия', bookOriginalLanguage: 'русский', bookPublicationYear: 2014, bookGenres: ['роман'], isPartOfSeries: false, hasAdaptation: true, bookAdaptationCount: 1, hasAwards: false },
  character: { characterEra: 'XIX век', characterEraOrder: 6, characterSourceTypes: ['Роман'], characterOriginCultures: ['Русская литература'], characterNature: 'Человек', characterGender: 'Мужчина', characterAgeGroup: 'Взрослый', characterRoles: ['Главный герой'], characterArchetypes: ['Исследователь'], characterAbilities: ['Дедукция'], characterSettings: ['Город'] },
}

const title = (mode: PlayableCatalogGuessModeId, id: string): TitleItem => ({
  id,
  mode,
  titleRu: id,
  titleOriginal: '',
  popularityScore: 1,
  ...sharedByMode[mode],
} as TitleItem)

describe('friends room weighted scoring', () => {
  it('reserves most points for an exact answer and rewards speed', () => {
    const answer = title('movie', 'answer')
    expect(scoreFriendsRoomGuess({ answer, guess: answer, elapsedSeconds: 0, answerTimeSeconds: 30 }).points).toBe(1000)
    expect(scoreFriendsRoomGuess({ answer, guess: answer, elapsedSeconds: 30, answerTimeSeconds: 30 }).points).toBe(700)
  })

  it.each(Object.keys(sharedByMode) as PlayableCatalogGuessModeId[])('awards bounded partial points for matching %s attributes', (mode) => {
    const result = scoreFriendsRoomGuess({
      answer: title(mode, `${mode}-answer`),
      guess: title(mode, `${mode}-guess`),
      elapsedSeconds: 10,
      answerTimeSeconds: 30,
    })
    expect(result.correct).toBe(false)
    expect(result.points).toBeGreaterThan(0)
    expect(result.points).toBeLessThanOrEqual(650)
    expect(result.breakdown.reduce((sum, part) => sum + part.points, 0)).toBe(result.points)
  })

  it('gives a specific creator match more weight than a visible genre match', () => {
    const result = scoreFriendsRoomGuess({
      answer: title('movie', 'answer'),
      guess: title('movie', 'guess'),
      elapsedSeconds: 10,
      answerTimeSeconds: 30,
    })
    const creator = result.breakdown.find((part) => part.key === 'creator')
    const genres = result.breakdown.find((part) => part.key === 'genres')
    expect(creator?.points).toBeGreaterThan(genres?.points ?? 0)
  })

  it('does not award points for matching game-data availability gaps', () => {
    const unavailable = {
      source: ['test'],
      verified: true,
      missingFields: ['price', 'metacritic', 'ratings.steamPositivePercent', 'votes.steamReviews'],
      fieldAvailability: {
        price: 'not_available' as const,
        metacritic: 'not_rated' as const,
        steamRating: 'not_available' as const,
        steamReviews: 'not_available' as const,
      },
    }
    const result = scoreFriendsRoomGuess({
      answer: { ...title('game', 'answer'), dataQuality: unavailable },
      guess: { ...title('game', 'guess'), dataQuality: unavailable },
      elapsedSeconds: 10,
      answerTimeSeconds: 30,
    })

    expect(result.breakdown.map((part) => part.key)).not.toEqual(expect.arrayContaining([
      'price',
      'metacritic',
      'steam_positive',
      'reviews',
    ]))
  })
})
