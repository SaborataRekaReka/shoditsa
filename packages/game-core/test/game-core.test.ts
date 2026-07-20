import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { GAME_MODE_MANIFEST, PLAYABLE_MODE_IDS, type TitleItem, type TitleMode } from '@shoditsa/contracts'
import { calculateCompletionReward, compareTitles, dailyTitle, isAllowedInRegularGame, normalize, poolFor, searchTitles } from '../src/index.js'

const libraryDirs = Object.fromEntries(PLAYABLE_MODE_IDS.map((mode) => [mode, GAME_MODE_MANIFEST[mode].dataDir])) as Record<TitleMode, string>
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/compare-golden.json', import.meta.url), 'utf8')) as Partial<Record<TitleMode, { answerId: string; cases: Array<{ guessId: string; digest: string }> }>>

describe('game-core characterization', () => {
  for (const mode of Object.keys(fixtures) as TitleMode[]) it(`${mode}: preserves 20 golden comparisons`, () => {
    const items = JSON.parse(readFileSync(new URL(`../../../public/data/libraries/${libraryDirs[mode]}/items.json`, import.meta.url), 'utf8')) as TitleItem[]
    const byId = new Map(items.map((item) => [item.id, item]))
    const fixture = fixtures[mode]!
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
  it('applies city variants and city comparison through the shared mode registry', () => {
    const capital = { id: 'city:capital', mode: 'city', titleRu: 'Столица', titleOriginal: 'Capital', alternativeTitles: [], popularityScore: 2, capital: true, popular: true, country: 'A', continent: 'Европа', languages: ['a'], population: 100, timezone: 'GMT+1', ranks: { economy: 1, humanCapital: 2, qualityOfLife: 3, ecology: 4, governance: 5 } }
    const popular = { ...capital, id: 'city:popular', titleRu: 'Популярный', capital: false, country: 'B' }
    const other = { ...capital, id: 'city:other', titleRu: 'Другой', capital: false, popular: false, country: 'C' }
    const items = [capital, popular, other] as TitleItem[]

    expect(poolFor(items, 'city', 'all', 'capitals').map((item) => item.id)).toEqual(['city:capital'])
    expect(poolFor(items, 'city', 'all', 'capitals-popular').map((item) => item.id)).toEqual(['city:capital', 'city:popular'])
    expect(compareTitles(capital, capital).every((hint) => hint.status === 'match')).toBe(true)
  })
  it('never includes promo cards in the regular games pool', () => {
    const regular = { id: 'tgdb_1', mode: 'game', titleRu: 'Regular', titleOriginal: '', alternativeTitles: [], popularityScore: 1 }
    const promoById = { ...regular, id: 'promo:dtf-test', titleRu: 'Promo by id' }
    const promoByStatus = { ...regular, id: 'game-promo-copy', titleRu: 'Promo by status', contentStatus: 'promo_pack' }
    const items = [regular, promoById, promoByStatus] as TitleItem[]

    expect(poolFor(items, 'game', 'all').map((item) => item.id)).toEqual(['tgdb_1'])
    expect(isAllowedInRegularGame(promoById as TitleItem)).toBe(false)
    expect(isAllowedInRegularGame(promoByStatus as TitleItem)).toBe(false)
  })
  it('deduplicates search results that share an external catalog id', () => {
    const base = {
      mode: 'game', titleRu: 'Divinity: Original Sin', titleOriginal: 'Divinity: Original Sin',
      alternativeTitles: [], year: 2014, popularityScore: 50, externalRanks: { thegamesdb: 10221 },
    }
    const items = [{ ...base, id: 'tgdb_10221' }, { ...base, id: 'tgdb_10221_1' }] as TitleItem[]

    expect(searchTitles(items, 'divinity', new Set()).map((item) => item.id)).toEqual(['tgdb_10221'])
  })
})

describe('economy', () => {
  it('uses the v2 reward formula without streak multipliers', () => expect(calculateCompletionReward({ won: true, attemptsCount: 3, firstCompletion: true, firstRoute3: false, firstFullHouse: false, dailyStreak: 7 })).toEqual({
    rulesVersion: 2,
    components: { completion: 5, win: 5, efficiency: 3, firstGame: 5, route3: 0, fullRoute: 0, streakMilestone: 7 },
    total: 25,
  }))
  it('awards completion on a loss', () => expect(calculateCompletionReward({ won: false, attemptsCount: 10, firstCompletion: false, firstFullHouse: false, dailyStreak: 1 }).total).toBe(5))
  it('lands on the v2 17 / 51 / 119 daily targets', () => {
    const reward = (position: number) => calculateCompletionReward({
      won: true,
      attemptsCount: 5,
      firstCompletion: position === 1,
      firstRoute3: position === 3,
      firstFullHouse: position === 7,
      dailyStreak: 1,
    }).total
    expect(reward(1)).toBe(17)
    expect([1, 2, 3].reduce((sum, position) => sum + reward(position), 0)).toBe(51)
    expect([1, 2, 3, 4, 5, 6, 7].reduce((sum, position) => sum + reward(position), 0)).toBe(119)
  })
  it('awards a streak milestone once without multiplying later games', () => {
    expect(calculateCompletionReward({ won: true, attemptsCount: 5, firstCompletion: true, firstFullHouse: false, dailyStreak: 30 }).total).toBe(37)
    expect(calculateCompletionReward({ won: true, attemptsCount: 5, firstCompletion: false, firstFullHouse: false, dailyStreak: 30 }).total).toBe(12)
  })
})
