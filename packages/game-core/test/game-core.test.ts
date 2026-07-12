import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { TitleItem, TitleMode } from '@shoditsa/contracts'
import { calculateCompletionReward, compareTitles, dailyTitle, normalize, poolFor } from '../src/index.js'

const libraryDirs: Record<TitleMode, string> = { movie: 'movies', series: 'series', anime: 'animes', game: 'games', music: 'music', diagnosis: 'diagnoses' }
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/compare-golden.json', import.meta.url), 'utf8')) as Record<TitleMode, { answerId: string; cases: Array<{ guessId: string; digest: string }> }>

describe('game-core characterization', () => {
  for (const mode of Object.keys(libraryDirs) as TitleMode[]) it(`${mode}: preserves 20 golden comparisons`, () => {
    const items = JSON.parse(readFileSync(new URL(`../../../public/data/libraries/${libraryDirs[mode]}/items.json`, import.meta.url), 'utf8')) as TitleItem[]
    const byId = new Map(items.map((item) => [item.id, item]))
    const fixture = fixtures[mode]
    for (const entry of fixture.cases) {
      const actual = compareTitles(byId.get(entry.guessId)!, byId.get(fixture.answerId)!)
      expect(createHash('sha256').update(JSON.stringify(actual)).digest('hex')).toBe(entry.digest)
    }
  })
})

describe('deterministic rules', () => {
  it('normalizes Cyrillic, accents and punctuation', () => expect(normalize('  Ёж — Café! ')).toBe('еж cafe'))
  it('selects the same daily item for the same seed', () => {
    const pool = [{ id: '1', mode: 'movie', titleRu: 'A', titleOriginal: '', alternativeTitles: [], popularityScore: 1 }, { id: '2', mode: 'movie', titleRu: 'B', titleOriginal: '', alternativeTitles: [], popularityScore: 1 }] as TitleItem[]
    expect(dailyTitle(pool, 'movie', 'all', '2026-07-11', 0)?.id).toBe(dailyTitle(pool, 'movie', 'all', '2026-07-11', 0)?.id)
  })
  it('filters years for a period', () => {
    const items = [{ id: '1', mode: 'movie', titleRu: 'A', titleOriginal: '', alternativeTitles: [], popularityScore: 1, year: 1999 }, { id: '2', mode: 'movie', titleRu: 'B', titleOriginal: '', alternativeTitles: [], popularityScore: 1, year: 2021 }] as TitleItem[]
    expect(poolFor(items, 'movie', 'from_2020').map((item) => item.id)).toEqual(['2'])
  })
})

describe('economy', () => {
  it('uses the fixed reward formula', () => expect(calculateCompletionReward({ won: true, attemptsCount: 3, firstCompletion: true, firstFullHouse: false, dailyStreak: 7 })).toEqual({ components: { completion: 10, win: 10, speed: 7, firstCompletion: 5, fullHouse: 0 }, multiplier: 1.25, total: 40 }))
  it('awards completion on a loss', () => expect(calculateCompletionReward({ won: false, attemptsCount: 10, firstCompletion: false, firstFullHouse: false, dailyStreak: 1 }).total).toBe(10))
})
