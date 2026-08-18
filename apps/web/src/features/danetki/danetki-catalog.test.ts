import { describe, expect, it } from 'vitest'
import { DANETKI_CATALOG_ITEMS, danetkiCatalogItemBySlug, danetkiCatalogPlayState, danetkiSlug, danetkiStoryPath } from './danetki-catalog'
import { DANETKI_COLLECTION_DEFINITIONS, danetkiCollectionItems } from './danetki-collections'

describe('danetki catalog', () => {
  it('builds stable human-readable slugs', () => {
    expect(danetkiSlug('Личная благодарность')).toBe('lichnaya-blagodarnost')
    expect(danetkiSlug('Верёвка')).toBe('verevka')
  })

  it('derives routes from the shared content library', () => {
    expect(DANETKI_CATALOG_ITEMS).toHaveLength(30)
    const item = DANETKI_CATALOG_ITEMS[0]
    expect(danetkiCatalogItemBySlug(item.slug)).toEqual(item)
    expect(danetkiStoryPath(item)).toMatch(/^\/danetki\/[a-z0-9-]+$/)
    expect(DANETKI_CATALOG_ITEMS.filter((candidate) => candidate.audience === 'family').length).toBeGreaterThanOrEqual(12)
  })

  it('builds editorial collections from explicit catalog fields', () => {
    const children = danetkiCollectionItems('dlya-detey')
    const hard = danetkiCollectionItems('slozhnye')
    const easy = danetkiCollectionItems('legkie')
    const newest = danetkiCollectionItems('novye')

    expect(DANETKI_COLLECTION_DEFINITIONS).toHaveLength(4)
    expect(children).toHaveLength(8)
    expect(children.every((item) => item.genres.includes('детская'))).toBe(true)
    expect(hard).toHaveLength(8)
    expect(hard.every((item) => item.difficulty === 'hard')).toBe(true)
    expect(easy).toHaveLength(8)
    expect(easy.every((item) => item.difficulty === 'easy')).toBe(true)
    expect(newest).toHaveLength(12)
    expect(newest.map((item) => item.publishedAt)).toEqual([...newest.map((item) => item.publishedAt)].sort().reverse())
  })

  it('uses the daily game before charging tickets for a selected story', () => {
    expect(danetkiCatalogPlayState({ dailyRoomsStarted: 0, nextSoloCost: 90 }, 0)).toEqual({
      dailyAvailable: true,
      cost: 0,
      shortage: 0,
      allowed: true,
    })
    expect(danetkiCatalogPlayState({ dailyRoomsStarted: 1, nextSoloCost: 90 }, 240)).toEqual({
      dailyAvailable: false,
      cost: 90,
      shortage: 0,
      allowed: true,
    })
    expect(danetkiCatalogPlayState({ dailyRoomsStarted: 1, nextSoloCost: 90 }, 40)).toEqual({
      dailyAvailable: false,
      cost: 90,
      shortage: 50,
      allowed: false,
    })
  })
})
