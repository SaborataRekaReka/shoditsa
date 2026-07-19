import { describe, expect, it } from 'vitest'
import { DAILY_MODE_IDS, PLAYABLE_MODE_IDS } from '@shoditsa/contracts'
import { GAME_SEO, HOME_SEO, INDEXABLE_PATHS } from './seo-content'
import { normalizeSeoPathname, seoRouteFromPathname, structuredDataForSeoRoute } from './seo'

describe('search index contract', () => {
  it('publishes one unique, indexable landing page for every canonical game mode', () => {
    const titles = new Set<string>()
    const descriptions = new Set<string>()
    const paths = new Set<string>()

    for (const mode of PLAYABLE_MODE_IDS) {
      const content = GAME_SEO[mode]
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
      expect(content.features.length).toBeGreaterThanOrEqual(4)
      expect(content.steps.length).toBeGreaterThanOrEqual(3)
      expect(content.faq.length).toBeGreaterThanOrEqual(2)
      titles.add(content.title)
      descriptions.add(content.description)
      paths.add(content.canonicalPath)
    }

    expect(titles.size).toBe(PLAYABLE_MODE_IDS.length)
    expect(descriptions.size).toBe(PLAYABLE_MODE_IDS.length)
    expect(paths.size).toBe(PLAYABLE_MODE_IDS.length)
    expect(INDEXABLE_PATHS).toEqual([HOME_SEO.canonicalPath, ...DAILY_MODE_IDS.map((mode) => `/games/${mode}`)])
  })

  it('keeps personal and transactional routes out of the index', () => {
    for (const pathname of ['/login', '/register', '/archive', '/profile', '/play/movie', '/sessions/id-1', '/review/music', '/admin', '/missing']) {
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
})
