import { describe, expect, it } from 'vitest'
import type { Attempt } from '../types'
import { attemptProgressStats } from './attempt-progress'

describe('attempt progress', () => {
  it('separates exact field matches from partial overlap', () => {
    const hints = [
      { key: 'country', label: 'Страна', value: 'Россия, Азербайджан', status: 'partial', direction: null, matchedValues: ['Россия'] },
      { key: 'genres', label: 'Жанры', value: 'rap, hip-hop', status: 'partial', direction: null, matchedValues: ['rap', 'hip-hop'] },
      { key: 'similar_artists', label: 'Похожие артисты', value: 'A, B, C', status: 'match', direction: null, matchedValues: ['A', 'B', 'C'] },
      { key: 'music_type', label: 'Тип', value: 'Группа', status: 'miss', direction: null },
    ] as Attempt['hints']

    expect(attemptProgressStats(hints)).toEqual({
      matchedCount: 1,
      matchedFields: 1,
      partialFields: 2,
      totalFields: 4,
    })
  })

  it('reports a self-comparison as a complete card including similar artists', () => {
    const hints = [
      { key: 'country', label: 'Страна', value: 'Россия', status: 'match', direction: null },
      { key: 'genres', label: 'Жанры', value: 'rap', status: 'match', direction: null },
      { key: 'similar_artists', label: 'Похожие артисты', value: 'A', status: 'match', direction: null },
    ] as Attempt['hints']

    expect(attemptProgressStats(hints)).toEqual({
      matchedCount: 3,
      matchedFields: 3,
      partialFields: 0,
      totalFields: 3,
    })
  })

  it('keeps an unavailable guess neutral without counting it as a match', () => {
    const hints = [
      { key: 'price', label: 'Цена', value: 'Нет данных', status: 'unknown', direction: null },
      { key: 'genres', label: 'Жанры', value: 'RPG', status: 'match', direction: null },
    ] as Attempt['hints']

    expect(attemptProgressStats(hints)).toEqual({
      matchedCount: 1,
      matchedFields: 1,
      partialFields: 0,
      totalFields: 2,
    })
  })
})
