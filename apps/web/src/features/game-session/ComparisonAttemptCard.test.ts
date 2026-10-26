import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Attempt, TitleItem } from '../../types'
import { AttemptMatchSummary, ComparisonAttemptCard, ATTEMPT_PRESENTATION } from './ComparisonAttemptCard'

const item: TitleItem = { id: 'dx_vulvovaginal_candidiasis', mode: 'diagnosis', titleRu: 'Вульвовагинальный кандидоз', titleOriginal: '', alternativeTitles: [], popularityScore: 1 }
const hints: Attempt['hints'] = [
  { key: 'a', label: 'A', value: 'A', status: 'match', direction: null },
  { key: 'b', label: 'B', value: 'B', status: 'partial', direction: null },
  { key: 'c', label: 'C', value: 'C', status: 'miss', matchedValues: ['C'], direction: null },
  { key: 'd', label: 'D', value: 'Нет данных', status: 'unknown', direction: null },
]

describe('shared comparison attempts', () => {
  it.each(['compact', 'labels', 'bar'] as const)('preserves exact, overlap and unknown semantics in %s presentation', variant => {
    const html = renderToStaticMarkup(h(AttemptMatchSummary, { hints, variant }))
    expect(html).toContain('aria-label="Точных совпадений: 1 из 4; частичных: 2"')
    expect(html.match(/class="exact"/g)).toHaveLength(1)
    expect(html.match(/class="partial"/g)).toHaveLength(2)
    expect(html.match(/<i /g)).toHaveLength(4)
  })
  it('handles zero comparisons without inventing a match', () => {
    const html = renderToStaticMarkup(h(AttemptMatchSummary, { hints: [] }))
    expect(html).toContain('Точных совпадений: 0 из 0; частичных: 0')
    expect(html).not.toContain('<i ')
  })
  it('uses the submitted diagnosis artwork, keeps the attempt label and renders game-specific content', () => {
    const html = renderToStaticMarkup(h(ComparisonAttemptCard, { item, attempt: { titleId: item.id, hints }, index: 2, isCorrectAttempt: false, metadata: h('span', null, 'МКБ B37.3'), children: h('section', null, 'Симптомы') }))
    expect(html).toContain('/dx_vulvovaginal_candidiasis.')
    expect(html).toContain('Попытка 3')
    expect(html).toContain('МКБ B37.3')
    expect(html).toContain('<section>Симптомы</section>')
    expect(html).not.toContain('Угадано')
  })
  it.each(Object.keys(ATTEMPT_PRESENTATION) as Array<keyof typeof ATTEMPT_PRESENTATION>)('renders the shared summary and a media fallback for %s', mode => {
    const guess = { ...item, id: `missing-${mode}`, mode }
    const html = renderToStaticMarkup(h(ComparisonAttemptCard, { item: guess, attempt: { titleId: guess.id, hints }, index: 0, isCorrectAttempt: false, children: null }))
    expect(html).toContain('poster-fallback')
    expect(html).toContain('attempt-match--compact')
    expect(html).toContain(`comparison-attempt--${ATTEMPT_PRESENTATION[mode].media}`)
  })
  it('identifies answer reveals separately from numbered guesses', () => {
    const html = renderToStaticMarkup(h(ComparisonAttemptCard, { item, attempt: { titleId: item.id, hints }, index: 0, isCorrectAttempt: true, isAnswerReveal: true, children: null }))
    expect(html).toContain('Правильный ответ')
    expect(html).not.toContain('Попытка 1')
  })
})
