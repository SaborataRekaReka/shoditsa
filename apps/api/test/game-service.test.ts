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
})