import { describe, expect, it } from 'vitest'
import { DANETKI_CATALOG_ITEMS, danetkiCatalogItemBySlug, danetkiSlug, danetkiStoryPath } from './danetki-catalog'

describe('danetki catalog', () => {
  it('builds stable human-readable slugs', () => {
    expect(danetkiSlug('Личная благодарность')).toBe('lichnaya-blagodarnost')
    expect(danetkiSlug('Верёвка')).toBe('verevka')
  })

  it('derives routes from the shared content library', () => {
    expect(DANETKI_CATALOG_ITEMS.length).toBeGreaterThan(0)
    const item = DANETKI_CATALOG_ITEMS[0]
    expect(danetkiCatalogItemBySlug(danetkiSlug(item.titleRu))).toEqual(item)
    expect(danetkiStoryPath(item)).toMatch(/^\/danetki\/[a-z0-9-]+$/)
  })
})
