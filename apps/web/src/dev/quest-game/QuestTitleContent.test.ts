import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DANETKI_RULES, GAME_GUIDE_PRESENTATION, GAME_RULES, GAME_SEO, INDEXABLE_GAME_SEO, type GameSeoContent } from '../../app/seo-content'
import { DANETKI_DISCOVERY_LINKS } from '../../app/danetki-discovery-links'
import { GameArtifactSeoDetails } from '../../components/seo-content/SeoContent'
import { QuestTitleContent } from './QuestTitleContent'

// The design server normally selects the reference content and rewrites links.
// The title study must retain the production content even in that environment.
vi.mock('../../app/local-presentation', () => ({
  LOCAL_PRESENTATION: true,
  REFERENCE_PRESENTATION: true,
  localPresentationLink: (href: string) => `/preview-only#${href}`,
}))
vi.mock('./ShoditsaPresentation', () => ({ StudyGlyph: () => null }))

describe.each([
  { name: 'live component', markup: renderToStaticMarkup(createElement(GameArtifactSeoDetails, { mode: 'anime', variant: 'live' })) },
  { name: 'illustrated title composition', markup: renderToStaticMarkup(createElement(QuestTitleContent)) },
])('title study preserves live page content: $name', ({ name, markup }) => {
  const content = GAME_SEO.anime
  const escaped = (text: string) => renderToStaticMarkup(createElement('span', null, text)).slice(6, -7)

  it('keeps the shared description, collection, rules, features, steps and FAQ', () => {
    const text = [content.heading, content.lead, content.collectionMethod.text,
      ...content.searchSummary!.paragraphs, ...content.paragraphs, ...content.features, ...content.steps,
      ...content.faq.flatMap(entry => [entry.question, entry.answer]), ...Object.values(GAME_RULES.anime)]
    for (const value of text) expect(markup).toContain(escaped(value))
    expect(markup.match(/<h[1-6][^>]*>[^<]*<\/h[1-6]>/g)?.sort()).toEqual([
      `<h2 id="search-summary-anime">${content.searchSummary!.heading}</h2>`,
      `<h3 id="about-anime">${content.heading}</h3>`,
      '<h4 id="artifact-collection-anime">Как собран набор</h4>',
      '<h4 id="artifact-rules-anime">Как играть</h4>',
      `<h4 id="artifact-features-anime">${GAME_GUIDE_PRESENTATION.anime.evidenceTitle}</h4>`,
      `<h4 id="artifact-steps-anime">${GAME_GUIDE_PRESENTATION.anime.routeTitle}</h4>`,
      `<h4 id="artifact-faq-anime">${name === 'illustrated title composition' ? 'Вопросы об игре' : GAME_GUIDE_PRESENTATION.anime.faqTitle}</h4>`,
      ...(name === 'illustrated title composition' ? ['<h3>Другие игры</h3>', '<h3>Данетки с ответами</h3>'] : []),
    ].sort())
  })

  it('retains all original destinations, including Connections and Danetki', () => {
    for (const game of INDEXABLE_GAME_SEO.filter(game => game.mode !== 'anime')) {
      expect(markup).toContain(`href="${game.canonicalPath}"`)
    }
    for (const link of DANETKI_DISCOVERY_LINKS) expect(markup).toContain(`href="${link.href}"`)
    for (const source of content.collectionMethod.sources) expect(markup).toContain(`href="${escaped(source.url)}"`)
    expect(markup).not.toContain('/preview-only')
  })

  it('matches live metadata while keeping the standalone study out of the index', () => {
    const html = readFileSync(new URL('../../../shoditsa-title.html', import.meta.url), 'utf8')
    expect(html).toContain(`<title>${content.title}</title>`)
    expect(html).toContain(`<meta name="description" content="${content.description}"`)
    expect(html).toContain('<meta name="robots" content="noindex,nofollow"')
  })
})

describe.each(INDEXABLE_GAME_SEO as readonly GameSeoContent[])('shared title content for $mode', content => {
  const markup = renderToStaticMarkup(createElement(QuestTitleContent, { mode: content.mode }))
  const escaped = (text: string) => renderToStaticMarkup(createElement('span', null, text)).slice(6, -7)
  it('retains every source paragraph, feature, step, answer and mode-specific rule in HTML', () => {
    const rules = content.mode === 'danetki' ? DANETKI_RULES : GAME_RULES[content.mode]
    for (const text of [content.heading, content.lead, content.collectionMethod.text,
      ...content.searchSummary?.paragraphs ?? [], ...content.paragraphs, ...content.features, ...content.steps,
      ...content.faq.flatMap(entry => [entry.question, entry.answer]), ...Object.values(rules)]) {
      expect(markup).toContain(escaped(text))
    }
    expect(markup).toContain(`<h3 id="about-${content.mode}">${escaped(content.heading)}</h3>`)
    for (const section of ['collection', 'rules', 'features', 'steps', 'faq']) expect(markup).toContain(`<h4 id="artifact-${section}-${content.mode}">`)
    if (content.searchSummary) expect(markup).toContain(`<h2 id="search-summary-${content.mode}">${escaped(content.searchSummary.heading)}</h2>`)
    expect(markup).not.toContain('/preview-only')
  })
  it('keeps live destinations and omits irrelevant comparison mechanics', () => {
    for (const game of INDEXABLE_GAME_SEO.filter(game => game.mode !== content.mode)) expect(markup).toContain(`href="${game.canonicalPath}"`)
    for (const source of content.collectionMethod.sources) expect(markup).toContain(`href="${escaped(source.url)}"`)
    if (content.mode === 'danetki' || content.mode === 'connections') {
      expect(markup).not.toContain('qt-legend')
      expect(markup).not.toContain('Перед пятой и восьмой попытками')
    }
  })
})
