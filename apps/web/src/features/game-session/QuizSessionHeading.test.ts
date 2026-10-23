import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuizSessionHeading } from './QuizSessionHeading'

const renderHeading = (props: Partial<Parameters<typeof QuizSessionHeading>[0]> = {}) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  return renderToStaticMarkup(createElement(QuizSessionHeading, {
    mode: 'anime', title: 'Аниме дня', date: '2026-10-23', kind: 'daily', ...props,
  }))
}

afterEach(() => vi.useRealTimers())

describe('quiz session context', () => {
  it('distinguishes today from a resumed daily puzzle and includes the year for older archives', () => {
    const today = renderHeading()
    expect(today).toContain('<time dateTime="2026-10-23">23 октября</time>')
    expect(today).not.toContain('Архив')
    expect(renderHeading({ date: '2026-10-21' })).toContain('Архив за 21 октября')
    expect(renderHeading({ kind: 'archive', date: '2025-10-21' })).toContain('Архив за 21 октября 2025')
  })

  it('identifies free play and preserves the selected variant without a calendar date', () => {
    const html = renderHeading({ kind: 'free_play', title: 'Угадай аниме', variantLabel: 'С 2000 года' })
    expect(html).toContain('Свободная игра')
    expect(html).toContain('С 2000 года')
    expect(html).not.toContain('<time')
  })

  it('uses position in a pack, while daily specials keep their date', () => {
    const pack = renderHeading({ kind: 'pack', title: 'Игры по комментариям', specialLabel: 'Спецпоказ DTF', packPosition: 3, packTotal: 25 })
    expect(pack).toContain('Спецпоказ DTF')
    expect(pack).toContain('Игра 3 из 25')
    expect(pack).not.toContain('<time')
    const dailySpecial = renderHeading({ title: 'K-pop артист дня', specialLabel: 'Спецпоказ' })
    expect(dailySpecial).toContain('Спецпоказ')
    expect(dailySpecial).toContain('<time dateTime="2026-10-23">23 октября</time>')
  })
})
