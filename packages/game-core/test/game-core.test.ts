import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { GAME_MODE_MANIFEST, PLAYABLE_MODE_IDS, type LibrarySearchIndex, type TitleItem, type TitleMode } from '@shoditsa/contracts'
import {
  calculateCompletionReward,
  compareTitles,
  dailyTitle,
  isAllowedInRegularGame,
  isPlayableGamePlotHint,
  isExactTitleSearchMatch,
  musicDifficultyPool,
  normalize,
  poolFor,
  searchTitles,
  titleSearchNames,
} from '../src/index.js'

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
  it('requires an explicit opt-in before including promo cards in the regular games pool', () => {
    const regular = {
      id: 'tgdb_1',
      mode: 'game',
      titleRu: 'Regular',
      titleOriginal: '',
      alternativeTitles: [],
      popularityScore: 1,
      plotHint: 'Игрок исследует мир, сражается с противниками и развивает героя.',
    }
    const promoById = { ...regular, id: 'promo:dtf-test', titleRu: 'Promo by id' }
    const promoByStatus = { ...regular, id: 'game-promo-copy', titleRu: 'Promo by status', contentStatus: 'promo_pack' }
    const promotedById = { ...promoById, allowedInGame: true }
    const promotedByStatus = { ...promoByStatus, allowedInGame: true }
    const explicitlyHidden = { ...promotedById, id: 'promo:dtf-hidden', allowedInGame: false }
    const items = [regular, promoById, promoByStatus, promotedById, promotedByStatus, explicitlyHidden] as TitleItem[]

    expect(poolFor(items, 'game', 'all').map((item) => item.id)).toEqual(['tgdb_1', 'promo:dtf-test', 'game-promo-copy'])
    expect(isAllowedInRegularGame(promoById as TitleItem)).toBe(false)
    expect(isAllowedInRegularGame(promoByStatus as TitleItem)).toBe(false)
    expect(isAllowedInRegularGame(promotedById as TitleItem)).toBe(true)
    expect(isAllowedInRegularGame(promotedByStatus as TitleItem)).toBe(true)
    expect(isAllowedInRegularGame(explicitlyHidden as TitleItem)).toBe(false)
  })
  it('keeps game availability independent from optional plot copy', () => {
    const base = {
      id: 'game:hint',
      mode: 'game',
      titleRu: 'Секретная игра',
      titleOriginal: 'Secret Game',
      alternativeTitles: [],
      popularityScore: 1,
    } as TitleItem
    const good = { ...base, plotHint: 'Герой исследует опасный мир, собирает ресурсы и принимает трудные решения.' }

    expect(isPlayableGamePlotHint(good)).toBe(true)
    expect(isPlayableGamePlotHint({ ...base, plotHint: '[REDACTED] ведёт героя через опасный мир.' })).toBe(false)
    expect(isPlayableGamePlotHint({ ...base, plotHint: 'Герой исследует опасный мир и сражается...' })).toBe(false)
    expect(isPlayableGamePlotHint({ ...base, plotHint: 'В Secret Game герой исследует опасный мир и сражается.' })).toBe(false)
    expect(poolFor([good, { ...base, id: 'game:bad', plotHint: '[REDACTED] ведёт героя через опасный мир.' }], 'game', 'all')
      .map((item) => item.id)).toEqual(['game:hint', 'game:bad'])
  })
  it('deduplicates search results that share an external catalog id', () => {
    const base = {
      mode: 'game', titleRu: 'Divinity: Original Sin', titleOriginal: 'Divinity: Original Sin',
      alternativeTitles: [], year: 2014, popularityScore: 50, externalRanks: { thegamesdb: 10221 },
    }
    const items = [{ ...base, id: 'tgdb_10221' }, { ...base, id: 'tgdb_10221_1' }] as TitleItem[]

    expect(searchTitles(items, 'divinity', new Set()).map((item) => item.id)).toEqual(['tgdb_10221'])
  })

  it('uses the same searchable title fields in every catalog game', () => {
    for (const mode of PLAYABLE_MODE_IDS) {
      const item = {
        id: `${mode}:search-contract`,
        mode,
        titleRu: 'Основное название',
        titleOriginal: 'English Original',
        alternativeTitles: ['Альтернативное название'],
        aliases: ['Legacy Alias'],
        popularityScore: 1,
      } as TitleItem

      for (const query of ['основное', 'english original', 'альтернативное', 'legacy alias']) {
        expect(searchTitles([item], query, new Set()).map((entry) => entry.id), `${mode}: ${query}`)
          .toEqual([item.id])
      }
    }
  })

  it('finds the reported music title with or without punctuation and by Latin alias', () => {
    const items = JSON.parse(readFileSync(new URL('../../../public/data/libraries/music/items.json', import.meta.url), 'utf8')) as TitleItem[]
    const pool = musicDifficultyPool(items, 'medium')
    const item = pool.find((entry) => entry.id === 'music:236_даите-танк')
    expect(item).toBeDefined()

    for (const query of ['Дайте танк (!)', 'Дайте танк(!)', 'дайте танк', 'Daite Tank (!)', 'ДТ!']) {
      expect(searchTitles(pool, query, new Set()).map((entry) => entry.id)).toContain(item!.id)
      expect(isExactTitleSearchMatch(query, item!)).toBe(true)
    }
  })

  it('does not let an incomplete or stale index hide a valid alias', () => {
    const target = {
      id: 'movie:target',
      mode: 'movie',
      titleRu: 'Целевой фильм',
      titleOriginal: 'Target Movie',
      alternativeTitles: ['Общее слово'],
      aliases: ['Hidden Alias'],
      popularityScore: 1,
    } as TitleItem
    const unrelated = {
      id: 'movie:unrelated',
      mode: 'movie',
      titleRu: 'Hidden Fortress',
      titleOriginal: 'Hidden Fortress',
      alternativeTitles: [],
      popularityScore: 1,
    } as TitleItem
    const staleIndex = {
      version: 1,
      library: 'movies',
      generatedAt: new Date(0).toISOString(),
      totalItems: 2,
      tokensCount: 1,
      docs: [],
      tokenToIds: { hidden: [unrelated.id] },
    } satisfies LibrarySearchIndex

    expect(searchTitles([target, unrelated], 'Hidden Alias', new Set(), staleIndex).map((item) => item.id))
      .toEqual([target.id])
  })

  it('deduplicates all accepted names through the centralized title contract', () => {
    const item = {
      titleRu: 'Ёлки',
      titleOriginal: 'Six Degrees of Celebration',
      alternativeTitles: ['Елки'],
      aliases: ['  ЁЛКИ  ', 'New Year Trees'],
    }

    expect(titleSearchNames(item)).toEqual(['Ёлки', 'Six Degrees of Celebration', 'New Year Trees'])
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
