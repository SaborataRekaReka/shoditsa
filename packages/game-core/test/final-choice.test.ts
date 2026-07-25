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
})
