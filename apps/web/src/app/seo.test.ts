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
    for (const pathname of ['/login', '/register', '/archive', '/profile', '/play/movie', '/games/together', '/sessions/id-1', '/review/music', '/admin', '/ui-kit', '/missing']) {
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

  it('publishes canonical, indexable metadata for the club', () => {
    const route = seoRouteFromPathname('/club')
    expect(route.kind).toBe('utility')
    expect(route.indexable).toBe(true)
    expect(route.robots).toContain('index,follow')
    expect(route.canonicalPath).toBe('/club')
    expect(route.title).toContain('Клуб')
  })

  it('targets the diagnosis game intent without presenting medical advice', () => {
    expect(GAME_SEO.diagnosis.title).toContain('Игра «Угадай диагноз»')
    expect(GAME_SEO.diagnosis.description).toContain('Медицинский квиз онлайн')
    expect(GAME_SEO.diagnosis.description).toContain('угадайте болезнь')
    expect(GAME_SEO.diagnosis.description).toContain('игровой диагноз')
    expect(GAME_SEO.diagnosis.lead).toContain('Игра «Поставь диагноз»')
    expect(GAME_SEO.diagnosis.description).not.toContain('лечение')
  })

  it('publishes visible search-intent summaries for the three recovery pages', () => {
    expect(GAME_SEO.danetki.internalLinkLabel).toBe('Данетки онлайн')
    expect(GAME_SEO.danetki.searchSummary?.heading).toContain('Данетки онлайн')
    expect(GAME_SEO.danetki.searchSummary?.paragraphs.join(' ').length).toBeGreaterThanOrEqual(400)

    expect(GAME_SEO.music.internalLinkLabel).toBe('Угадай исполнителя')
    expect(GAME_SEO.music.searchSummary?.heading).toContain('по песне')
    expect(GAME_SEO.music.searchSummary?.paragraphs.join(' ').length).toBeGreaterThanOrEqual(400)

    expect(GAME_SEO.game.internalLinkLabel).toBe('Угадай видеоигру')
    expect(GAME_SEO.game.searchSummary?.heading).toContain('комментариям')
    expect(GAME_SEO.game.searchSummary?.action?.href).toBe('/games/game-comments')
    expect(GAME_SEO.game.searchSummary?.paragraphs.join(' ').length).toBeGreaterThanOrEqual(400)
  })

  it('publishes the comment-game landing as a canonical indexable application', () => {
    const route = seoRouteFromPathname('/games/game-comments')
    const data = structuredDataForSeoRoute(route) as { '@graph': Array<Record<string, unknown>> }

    expect(route.canonicalPath).toBe('/games/game-comments')
    expect(route.indexable).toBe(true)
    expect(data['@graph'].some((entry) => entry['@type'] === 'WebApplication')).toBe(true)
  })

  it('targets the book guessing intent with a dedicated social image', () => {
    const route = seoRouteFromPathname('/games/book')
    const data = structuredDataForSeoRoute(route) as { '@graph': Array<Record<string, unknown>> }

    expect(GAME_SEO.book.title).toContain('Угадай книгу по описанию')
    expect(GAME_SEO.book.title).toContain('литературная викторина')
    expect(GAME_SEO.book.paragraphs.join(' ')).toContain('Викторина по книгам')
    expect(route.imagePath).toBe('/images/social/book-game-og-v1.webp')
    expect(data['@graph'].some((entry) => entry.image === 'https://shoditsa.ru/images/social/book-game-og-v1.webp')).toBe(true)
  })
})
