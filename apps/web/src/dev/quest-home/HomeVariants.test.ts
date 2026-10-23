import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HOME_HERO_COPY } from '../../app/home-copy'
import { HOME_SEO, SITE_ORIGIN } from '../../app/seo-content'
import { PUBLIC_GAME_LINKS } from '../../app/public-game-links'
import { DANETKI_DISCOVERY_LINKS } from '../../app/danetki-discovery-links'
import { HomeVariants, type HomeVariant } from './HomeVariants'

const text = (html: string) => html.replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'")
describe.each(['a', 'b', 'c'] as HomeVariant[])('home composition %s', variant => {
  const markup = renderToStaticMarkup(createElement(HomeVariants, { variant }))
  it('retains the one live runtime H1 and all original prose in the DOM', () => {
    expect(markup.match(/<h1[\s>]/g)).toHaveLength(1)
    for (const value of [HOME_HERO_COPY.heading, HOME_HERO_COPY.lead, HOME_SEO.heading, HOME_SEO.lead, ...HOME_SEO.paragraphs]) expect(text(markup)).toContain(value)
    expect(markup).toContain('<h2 id="home-about-title">')
    expect(markup).toContain('id="home-guide"')
  })
  it('renders every game once in the catalogue, plus all live guide destinations and labels', () => {
    for (const game of PUBLIC_GAME_LINKS) {
      expect(markup.match(new RegExp(`data-game="${game.mode}"`, 'g'))).toHaveLength(1)
      expect(markup).toContain(`href="${game.href}"`)
      expect(text(markup)).toContain(game.label)
    }
    for (const link of DANETKI_DISCOVERY_LINKS) {
      expect(markup).toContain(`href="${link.href}"`)
      expect(text(markup)).toContain(link.label)
    }
    expect(markup).not.toContain('href="javascript:')
  })
  it('retains the common application navigation and home context in every variant', () => {
    expect(markup.match(/aria-label="Основная навигация"/g)).toHaveLength(1)
    for (const label of ['Игры', 'Архив', 'Рейтинг', 'Задания', 'Профиль']) expect(markup).toContain(`aria-label="${label}"`)
    expect(markup).not.toContain('aria-label="Ещё"')
    expect(markup.match(/data-study-header=/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="Панель игрока"')
    expect(markup).toContain('aria-label="Меню аккаунта: Гость"')
    expect(markup).toContain('aria-label="Твои игры"')
    expect(text(markup)).toContain('Можно просто играть')
  })
})
it('preserves the source metadata and complete static fallback, while noindexing only the prototype', () => {
  const html = readFileSync(new URL('../../../shoditsa-home.html', import.meta.url), 'utf8')
  expect(text(html)).toContain(HOME_SEO.title)
  expect(html).toContain(HOME_SEO.description)
  expect(html).toContain(`href="${new URL(HOME_SEO.canonicalPath, SITE_ORIGIN).href}"`)
  expect(html).toContain('content="noindex,nofollow"')
  expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
  for (const value of [HOME_SEO.heading, HOME_SEO.lead, ...HOME_SEO.paragraphs]) expect(text(html)).toContain(value)
  for (const link of [...PUBLIC_GAME_LINKS, ...DANETKI_DISCOVERY_LINKS]) expect(html).toContain(`href="${link.href}"`)
})
