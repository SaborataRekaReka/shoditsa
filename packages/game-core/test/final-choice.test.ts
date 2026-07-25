import { describe, expect, it } from 'vitest'
import type { TitleItem } from '@shoditsa/contracts'
import { buildFinalChoice } from '../src/final-choice.js'

const movie = (overrides: Partial<TitleItem> & Pick<TitleItem, 'id' | 'titleRu'>): TitleItem => ({
  id: overrides.id,
  mode: 'movie',
  titleRu: overrides.titleRu,
  titleOriginal: overrides.titleRu,
  alternativeTitles: [],
  year: 2016,
  countries: ['США'],
  genres: ['фантастика', 'драма'],
  runtimeMinutes: 116,
  ratings: { kinopoisk: 7.6 },
  popularityScore: 80,
  recognitionLevel: 'mainstream',
  allowedInGame: true,
  ...overrides,
})

const answer = movie({ id: 'answer', titleRu: 'Ответ' })
const pool = [
  answer,
  movie({ id: 'categorical', titleRu: 'Категориальная ловушка', runtimeMinutes: 210, ratings: { kinopoisk: 5.1 } }),
  movie({ id: 'numeric', titleRu: 'Числовая ловушка', countries: ['Франция'], runtimeMinutes: 118, ratings: { kinopoisk: 7.5 } }),
  movie({ id: 'balanced', titleRu: 'Сбалансированная ловушка', genres: ['триллер'], runtimeMinutes: 117, ratings: { kinopoisk: 7.7 } }),
  ...Array.from({ length: 10 }, (_, index) => movie({
    id: `used-${index}`,
    titleRu: `Использован ${index}`,
    countries: ['Япония'],
    genres: ['комедия'],
    runtimeMinutes: 80 + index,
  })),
]

const build = (seed: string) => buildFinalChoice({
  answer,
  pool,
  excludedItemIds: Array.from({ length: 10 }, (_, index) => `used-${index}`),
  revealedHintKeys: ['year', 'country', 'genres', 'runtime', 'kp'],
  seed,
})

const game = (overrides: Partial<TitleItem> & Pick<TitleItem, 'id' | 'titleRu'>): TitleItem => ({
  id: overrides.id,
  mode: 'game',
  titleRu: overrides.titleRu,
  titleOriginal: overrides.titleRu,
  alternativeTitles: [],
  year: 2020,
  genres: ['Экшен'],
  platforms: ['PC'],
  developers: ['Студия A'],
  ratings: { steamPositivePercent: 90, metacritic: 80 },
  recognitionLevel: 'mainstream',
  allowedInGame: true,
  ...overrides,
})

const city = (overrides: Partial<TitleItem> & Pick<TitleItem, 'id' | 'titleRu'>): TitleItem => ({
  id: overrides.id,
  mode: 'city',
  titleRu: overrides.titleRu,
  titleOriginal: overrides.titleRu,
  alternativeTitles: [],
  country: 'Страна A',
  continent: 'Европа',
  languages: ['Язык A'],
  population: 1_000_000,
  timezone: 'UTC+03:00',
  ranks: { economy: 10, qualityOfLife: 20 },
  recognitionLevel: 'mainstream',
  allowedInGame: true,
  ...overrides,
})

describe('final choice', () => {
  it('builds one answer and three distinct, plausible traps', () => {
    const result = build('session|3|1')
    expect(result).not.toBeNull()
    expect(result!.snapshot.candidates).toHaveLength(4)
    expect(result!.snapshot.displayKeys).toHaveLength(3)
    expect(result!.snapshot.candidates.filter((candidate) => candidate.item.id === answer.id)).toHaveLength(1)
    expect(result!.candidates.filter((candidate) => candidate.role !== 'answer')).toHaveLength(3)
    expect(new Set(result!.candidates.filter((candidate) => candidate.role !== 'answer').map((candidate) => candidate.mismatchKeys.join('|'))).size).toBe(3)
    expect(result!.snapshot.candidates.some((candidate) => candidate.item.id.startsWith('used-'))).toBe(false)
    expect(JSON.stringify(result!.snapshot)).not.toContain('isCorrect')
    expect(JSON.stringify(result!.snapshot)).not.toContain('role')
  })

  it('is stable for the same seed', () => {
    expect(build('same-seed')?.snapshot).toEqual(build('same-seed')?.snapshot)
  })

  it('changes card order for at least one different seed', () => {
    const baseline = build('seed-0')!.snapshot.candidates.map((candidate) => candidate.item.id).join(',')
    const variants = Array.from({ length: 12 }, (_, index) => build(`seed-${index + 1}`)!.snapshot.candidates.map((candidate) => candidate.item.id).join(','))
    expect(variants.some((variant) => variant !== baseline)).toBe(true)
  })

  it('falls back to plausible game candidates when no trap matches two displayed facts', () => {
    const gameAnswer = game({ id: 'game-answer', titleRu: 'Игровой ответ' })
    const result = buildFinalChoice({
      answer: gameAnswer,
      pool: [
        gameAnswer,
        game({
          id: 'game-genre',
          titleRu: 'Совпадает жанр',
          platforms: ['PlayStation'],
          developers: ['Студия B'],
          ratings: { steamPositivePercent: 20, metacritic: 30 },
        }),
        game({
          id: 'game-platform',
          titleRu: 'Совпадает платформа',
          genres: ['Стратегия'],
          developers: ['Студия C'],
          ratings: { steamPositivePercent: 25, metacritic: 35 },
        }),
        game({
          id: 'game-rating',
          titleRu: 'Совпадает рейтинг',
          genres: ['Головоломка'],
          platforms: ['Xbox'],
          developers: ['Студия D'],
        }),
      ],
      revealedHintKeys: ['genres', 'platforms', 'steam_positive', 'metacritic'],
      seed: 'game-fallback',
    })

    expect(result).not.toBeNull()
    expect(result!.snapshot.candidates).toHaveLength(4)
    expect(result!.algorithmVersion).toBe(2)
  })

  it('uses three categorical game facts when the answer has no numeric metadata', () => {
    const gameAnswer = game({
      id: 'game-categorical-answer',
      titleRu: 'Игра без рейтингов',
      ratings: undefined,
    })
    const result = buildFinalChoice({
      answer: gameAnswer,
      pool: [
        gameAnswer,
        game({ id: 'game-cat-1', titleRu: 'Категориальная игра 1', ratings: undefined, genres: ['Стратегия'], developers: ['Студия B'] }),
        game({ id: 'game-cat-2', titleRu: 'Категориальная игра 2', ratings: undefined, platforms: ['Xbox'], developers: ['Студия C'] }),
        game({ id: 'game-cat-3', titleRu: 'Категориальная игра 3', ratings: undefined, genres: ['Головоломка'], platforms: ['PlayStation'], developers: ['Студия D'] }),
      ],
      revealedHintKeys: ['genres', 'platforms', 'developer'],
      seed: 'game-categorical-fallback',
    })

    expect(result).not.toBeNull()
    expect(result!.snapshot.displayKeys).toEqual(['genres', 'platforms', 'developer'])
    expect(result!.snapshot.candidates).toHaveLength(4)
  })

  it('falls back to plausible city candidates when no trap matches two displayed facts', () => {
    const cityAnswer = city({ id: 'city-answer', titleRu: 'Город-ответ' })
    const result = buildFinalChoice({
      answer: cityAnswer,
      pool: [
        cityAnswer,
        city({
          id: 'city-geography',
          titleRu: 'Совпадает география',
          country: 'Страна B',
          population: 8_000_000,
          timezone: 'UTC-05:00',
          ranks: { economy: 150, qualityOfLife: 170 },
        }),
        city({
          id: 'city-population',
          titleRu: 'Совпадают население и пояс',
          country: 'Страна C',
          continent: 'Азия',
          languages: ['Язык B'],
          ranks: { economy: 160, qualityOfLife: 180 },
        }),
        city({
          id: 'city-ranking',
          titleRu: 'Совпадают рейтинги',
          country: 'Страна D',
          continent: 'Африка',
          languages: ['Язык C'],
          population: 12_000_000,
          timezone: 'UTC+09:00',
        }),
      ],
      revealedHintKeys: ['continent', 'languages', 'population', 'timezone', 'economy', 'qualityOfLife'],
      seed: 'city-fallback',
    })

    expect(result).not.toBeNull()
    expect(result!.snapshot.candidates).toHaveLength(4)
    expect(result!.algorithmVersion).toBe(2)
  })
})
