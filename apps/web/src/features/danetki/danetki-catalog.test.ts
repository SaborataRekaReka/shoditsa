import { describe, expect, it } from 'vitest'
import { DANETKI_CATALOG_ITEMS, danetkiCatalogItemBySlug, danetkiSlug, danetkiStoryPath } from './danetki-catalog'

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
})
