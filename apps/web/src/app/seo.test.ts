import { describe, expect, it } from 'vitest'
import { GAME_SEO, HOME_SEO, INDEXABLE_GAME_SEO, INDEXABLE_PATHS } from './seo-content'
import { normalizeSeoPathname, seoRouteForRuntime, seoRouteFromPathname, structuredDataForSeoRoute } from './seo'
import { DANETKI_COLLECTION_DEFINITIONS, danetkiCollectionItems } from '../features/danetki/danetki-collections'
import { DANETKI_CATALOG_ITEMS } from '../features/danetki/danetki-catalog'
import { PUBLIC_GAME_LINKS } from './public-game-links'
import { STATIC_INDEXABLE_PATHS, renderSitemap } from './static-index'

describe('search index contract', () => {
  it('keeps public navigation aligned with every indexable game mode', () => {
    expect(PUBLIC_GAME_LINKS).toHaveLength(INDEXABLE_GAME_SEO.length)
    expect(PUBLIC_GAME_LINKS.map((game) => game.mode)).toEqual(INDEXABLE_GAME_SEO.map((game) => game.mode))
    expect(PUBLIC_GAME_LINKS.map((game) => game.href)).toEqual(INDEXABLE_GAME_SEO.map((game) => game.canonicalPath))
    expect(PUBLIC_GAME_LINKS).toContainEqual(expect.objectContaining({
      mode: 'character',
      href: '/games/character',
      label: expect.stringContaining('персонажа'),
    }))
  })

  it('generates a complete sitemap without synthetic deployment dates', () => {
    const sitemap = renderSitemap()
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

    expect(new Set(STATIC_INDEXABLE_PATHS).size).toBe(STATIC_INDEXABLE_PATHS.length)
    expect(locations).toHaveLength(STATIC_INDEXABLE_PATHS.length)
    expect(locations).toContain('https://shoditsa.ru/games/character')
    expect(locations).toContain('https://shoditsa.ru/danetki')
    expect(sitemap).not.toContain('<lastmod>')
  })

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
    expect(GAME_SEO.diagnosis.searchSummary?.heading).toContain('по симптомам')
    expect(GAME_SEO.diagnosis.searchSummary?.paragraphs.join(' ')).toContain('медицинский квиз')
    expect(GAME_SEO.diagnosis.searchSummary?.paragraphs.join(' ')).toContain('Поставь диагноз')
    expect(GAME_SEO.diagnosis.description).not.toContain('лечение')
    expect(GAME_SEO.diagnosis.relatedModes).toContain('danetki')
  })

  it('publishes a separate Danetki catalog and story pages without cannibalizing the game landing', () => {
    const catalog = seoRouteFromPathname('/danetki')
    const story = seoRouteFromPathname('/danetki/verevka')
    const game = seoRouteFromPathname('/games/danetki')
    expect(catalog.kind).toBe('danetki-catalog')
    expect(catalog.indexable).toBe(true)
    expect(catalog.title).toContain('Данетки с ответами')
    const collectionPaths = DANETKI_COLLECTION_DEFINITIONS.map((definition) => {
      const route = seoRouteFromPathname(definition.canonicalPath)
      const data = structuredDataForSeoRoute(route) as { '@graph': Array<Record<string, unknown>> }
      const page = data['@graph'].find((entry) => entry['@type'] === 'CollectionPage') as { mainEntity?: { numberOfItems?: number } }
      const breadcrumbs = data['@graph'].find((entry) => entry['@type'] === 'BreadcrumbList') as { itemListElement?: unknown[] }
      expect(route.kind).toBe('danetki-catalog')
      expect(route.indexable).toBe(true)
      expect(route.canonicalPath).toBe(definition.canonicalPath)
      expect(route.title).toBe(definition.title)
      expect(route.paragraphs.join(' ').length).toBeGreaterThanOrEqual(300)
      expect(page.mainEntity?.numberOfItems).toBe(danetkiCollectionItems(definition.slug).length)
      expect(breadcrumbs.itemListElement).toHaveLength(3)
      return route.canonicalPath
    })
    expect(story.kind).toBe('danetki-story')
    expect(story.indexable).toBe(true)
    expect(story.title).toContain('Верёвка')
    expect(game.title).toContain('Данетки онлайн')
    expect(new Set([catalog.canonicalPath, ...collectionPaths, story.canonicalPath, game.canonicalPath]).size).toBe(7)
    expect(seoRouteFromPathname('/danetki/interesnye').indexable).toBe(false)
  })

  it('covers the established Albatross query on its canonical story page', () => {
    const route = seoRouteFromPathname('/danetki/albatros')
    expect(route.title).toContain('Данетка про альбатроса')
    expect(route.title).toContain('Мясо альбатроса')
    expect(route.description).toContain('Данетка про мясо альбатроса')
  })

  it('locks the established Danetki search cluster against accidental metadata drift', () => {
    const protectedRoutes = [
      ['/games/danetki', 'Данетки онлайн — играть бесплатно с ИИ-ведущим | Сходится!', 'Играйте в данетки онлайн бесплатно: раскройте необычную историю вопросами с ответами «да» и «нет». ИИ-ведущий, одиночная и совместная игра.'],
      ['/danetki', 'Данетки с ответами — истории, загадки и игра онлайн | Сходится!', `Данетки с ответами: ${DANETKI_CATALOG_ITEMS.length} отобранных историй на логику. Читайте условие, проверьте разгадку или сыграйте с ИИ-ведущим онлайн.`],
      ['/danetki/albatros', 'Данетка про альбатроса с ответом — «Мясо альбатроса» | Сходится!', 'Данетка про мясо альбатроса с полным ответом. Разгадайте классическую историю самостоятельно или сыграйте с ИИ-ведущим без спойлеров.'],
    ] as const

    for (const [pathname, title, description] of protectedRoutes) {
      const route = seoRouteFromPathname(pathname)
      expect(route).toMatchObject({ canonicalPath: pathname, title, description, indexable: true })
    }

    expect(DANETKI_COLLECTION_DEFINITIONS.map(({ canonicalPath, title }) => ({ canonicalPath, title }))).toEqual([
      { canonicalPath: '/danetki/dlya-detey', title: 'Данетки для детей с ответами — логические загадки | Сходится!' },
      { canonicalPath: '/danetki/slozhnye', title: 'Сложные данетки с ответами — трудные загадки | Сходится!' },
      { canonicalPath: '/danetki/legkie', title: 'Лёгкие данетки с ответами — простые загадки | Сходится!' },
      { canonicalPath: '/danetki/novye', title: 'Новые данетки с ответами — свежие истории | Сходится!' },
    ])
  })

  it('points a loaded session at its public game while keeping it out of the index', () => {
    const route = seoRouteForRuntime('/sessions/id-1', '/games/diagnosis')

    expect(route.canonicalPath).toBe('/games/diagnosis')
    expect(route.indexable).toBe(false)
    expect(route.robots).toContain('noindex')
  })

  it('publishes visible search-intent summaries for the three recovery pages', () => {
    expect(GAME_SEO.danetki.internalLinkLabel).toBe('Данетки онлайн')
    expect(GAME_SEO.danetki.searchSummary?.heading).toContain('Данетки онлайн')
    expect(GAME_SEO.danetki.searchSummary?.paragraphs.join(' ').length).toBeGreaterThanOrEqual(400)

    expect(GAME_SEO.music.internalLinkLabel).toBe('Угадай исполнителя')
    expect(GAME_SEO.music.searchSummary?.heading).toContain('по песне')
    expect(GAME_SEO.music.searchSummary?.paragraphs.join(' ').length).toBeGreaterThanOrEqual(400)

    expect(GAME_SEO.game.internalLinkLabel).toBe('Угадай видеоигру')
    expect(GAME_SEO.game.searchSummary?.heading).toContain('по признакам')
    expect(GAME_SEO.game.searchSummary?.paragraphs.join(' ').length).toBeGreaterThanOrEqual(400)
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
