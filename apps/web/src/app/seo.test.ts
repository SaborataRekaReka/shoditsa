import { describe, expect, it } from 'vitest'
import { GAME_SEO, HOME_SEO, INDEXABLE_GAME_SEO, INDEXABLE_PATHS } from './seo-content'
import { normalizeSeoPathname, seoRouteFromPathname, structuredDataForSeoRoute } from './seo'

describe('search index contract', () => {
  it('publishes one unique, indexable landing page for every canonical game mode', () => {
    const titles = new Set<string>()
    const descriptions = new Set<string>()
    const paths = new Set<string>()

    for (const content of INDEXABLE_GAME_SEO) {
      const mode = content.mode
      const route = seoRouteFromPathname(content.canonicalPath)
      expect(route.kind).toBe('game')
      expect(route.mode).toBe(mode)
      expect(route.indexable).toBe(true)
      expect(route.robots).toContain('index,follow')
      expect(route.canonicalPath).toBe(`/games/${mode}`)
      expect(content.title.length).toBeGreaterThanOrEqual(45)
      expect(content.title.length).toBeLessThanOrEqual(70)
      expect(content.description.length).toBeGreaterThanOrEqual(110)
      expect(content.description.length).toBeLessThanOrEqual(170)
      expect(content.paragraphs.length).toBeGreaterThanOrEqual(2)
      expect(content.collectionMethod.text.length).toBeGreaterThanOrEqual(120)
      expect(content.features.length).toBeGreaterThanOrEqual(4)
      expect(content.steps.length).toBeGreaterThanOrEqual(3)
      expect(content.faq.length).toBeGreaterThanOrEqual(2)
      titles.add(content.title)
      descriptions.add(content.description)
      paths.add(content.canonicalPath)
    }

    expect(titles.size).toBe(INDEXABLE_GAME_SEO.length)
    expect(descriptions.size).toBe(INDEXABLE_GAME_SEO.length)
    expect(paths.size).toBe(INDEXABLE_GAME_SEO.length)
    expect(INDEXABLE_PATHS).toEqual([HOME_SEO.canonicalPath, ...INDEXABLE_GAME_SEO.map((game) => game.canonicalPath)])
    expect(GAME_SEO.game.collectionMethod.sources[0]?.url).toContain('playthatgame.co.uk')
    expect(GAME_SEO.movie.collectionMethod.sources[0]?.url).toContain('kinopoisk.ru')
    expect(GAME_SEO.city.collectionMethod.sources[0]?.url).toContain('oxfordeconomics.com')
  })

  it('keeps personal and transactional routes out of the index', () => {
    for (const pathname of ['/login', '/register', '/archive', '/profile', '/play/movie', '/games/together', '/sessions/id-1', '/review/music', '/admin', '/missing']) {
      const route = seoRouteFromPathname(pathname)
      expect(route.indexable, pathname).toBe(false)
      expect(route.robots, pathname).toContain('noindex')
    }
  })

  it('normalizes trailing slashes and emits matching structured data', () => {
    expect(normalizeSeoPathname('//games/movie/?utm_source=test')).toBe('/games/movie')
    const route = seoRouteFromPathname('/games/movie/')
    const data = structuredDataForSeoRoute(route) as { '@graph': Array<Record<string, unknown>> }
    expect(route.canonicalPath).toBe('/games/movie')
    expect(data['@graph'].some((entry) => entry['@type'] === 'WebApplication')).toBe(true)
    expect(data['@graph'].some((entry) => entry['@type'] === 'BreadcrumbList')).toBe(true)
  })

  it('publishes canonical metadata for legal documents', () => {
    const route = seoRouteFromPathname('/legal/terms')
    expect(route.kind).toBe('utility')
    expect(route.indexable).toBe(true)
    expect(route.canonicalPath).toBe('/legal/terms')
    expect(route.title).toContain('Пользовательское соглашение')
  })

  it('uses the partners URL as the canonical corporate landing', () => {
    const route = seoRouteFromPathname('/partners')
    const legacyRoute = seoRouteFromPathname('/create-a-game')
    expect(route.indexable).toBe(true)
    expect(route.canonicalPath).toBe('/partners')
    expect(legacyRoute.canonicalPath).toBe('/partners')
  })
})
