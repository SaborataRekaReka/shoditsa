import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QuestTitleHero } from './QuestTitleHero'
import { TITLE_HERO_COPY } from './title-hero-presentation'

describe('public puzzle titles', () => {
  it.each([
    ['danetki', 'Данетки онлайн'],
    ['connections', 'Connections на русском — Связи'],
  ] as const)('keeps the subject explicit in the %s H1', (mode, heading) => {
    const html = renderToStaticMarkup(createElement(QuestTitleHero, {
      mode, ...TITLE_HERO_COPY[mode], kicker: 'Игра дня', children: createElement('button', null, 'Начать игру'),
    }))
    expect(html.match(/<h1>/g)).toHaveLength(1)
    expect(html).toContain(`<h1>${heading}</h1>`)
  })
})
