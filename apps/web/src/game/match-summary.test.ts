import { describe, expect, it } from 'vitest'
import type { Attempt } from '../types'
import { collectMatchSummaryTags } from './match-summary'

describe('match summary', () => {
  it('gives every match the same label/value shape and removes duplicate values', () => {
    const attempts = [{
      titleId: 'game:guess',
      hints: [
        { key: 'price', label: 'Цена', value: 'Платно', status: 'match', direction: null },
        { key: 'players', label: 'Игроки', value: '1 игрок', status: 'match', direction: null },
        { key: 'genres', label: 'Жанры', value: 'Action', status: 'partial', direction: null, matchedValues: ['Action'] },
        { key: 'steam_categories', label: 'Категории', value: '1 игрок, Одиночная игра', status: 'partial', direction: null, matchedValues: ['1 игрок', 'Одиночная игра'] },
      ],
    }] as Attempt[]

    expect(collectMatchSummaryTags(attempts).map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Цена', value: 'Платно' },
      { label: 'Игроки', value: '1 игрок' },
      { label: 'Жанры', value: 'Action' },
      { label: 'Категории', value: 'Одиночная игра' },
    ])
  })
})
