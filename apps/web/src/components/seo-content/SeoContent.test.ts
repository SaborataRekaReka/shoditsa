import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INDEXABLE_GAME_SEO, type GameSeoContent } from '../../app/seo-content'

const presentation = vi.hoisted(() => ({ reference: true, local: false }))
vi.mock('../../app/local-presentation', () => ({
  get REFERENCE_PRESENTATION() { return presentation.reference },
  get LOCAL_PRESENTATION() { return presentation.local },
  localPresentationLink: (href: string) => href,
}))
import { GameArtifactSeoDetails } from './SeoContent'

const plainText = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const render = (content: GameSeoContent) => renderToStaticMarkup(createElement(GameArtifactSeoDetails, { mode: content.mode }))

beforeEach(() => { presentation.reference = true; presentation.local = false })

describe('open reference game landing content', () => {
  it.each(INDEXABLE_GAME_SEO)('preserves the existing $mode copy, source links and FAQ', (content: GameSeoContent) => {
    const html = render(content)
    const text = plainText(html)
    for (const required of [content.heading, content.lead, ...content.paragraphs, ...content.features, ...content.steps, content.collectionMethod.text, ...content.faq.flatMap((entry) => [entry.question, entry.answer])]) expect(text).toContain(required)
    for (const source of content.collectionMethod.sources) {
      expect(html).toContain(`href="${source.url.replace(/&/g, '&amp;')}"`)
      expect(text).toContain(source.label)
    }
    if (content.searchSummary) {
      expect(text).toContain(content.searchSummary.heading)
      for (const paragraph of content.searchSummary.paragraphs) expect(text).toContain(paragraph)
    }
    expect(html).toContain(`id="about-${content.mode}"`)
    expect(html).not.toContain('class="ticket-dossier__summary"')
    expect(html).not.toContain('class="ticket-dossier__more"')
    if (content.mode === 'connections' || content.mode === 'danetki') {
      expect(html).not.toContain('Значения цветов подсказок')
      expect(text).not.toContain('Перед пятой и восьмой попытками')
    }
  })

  it('keeps the legacy dossier and its disclosure outside the reference theme', () => {
    presentation.reference = false
    const html = render(INDEXABLE_GAME_SEO[0])
    expect(html).toContain('class="ticket-dossier__summary"')
    expect(html).toContain('class="ticket-dossier__more"')
    expect(html).not.toContain('class="game-landing ')
  })
})
