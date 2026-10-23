import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KPOP_ARTISTS_PACK_ID } from '@shoditsa/contracts'
import { EmbeddedApplicationContext } from '../application/EmbeddedApplicationContext'
import { SpecialTitle } from './SpecialTitle'
import type { api } from '../../api/client'

const pack = { id: 'dtf-game-comments-25-v1', title: 'Игры по комментариям', description: 'Подборка игр.', totalItems: 25, completedItems: 4, wonItems: 3, lostItems: 1 } as Awaited<ReturnType<typeof api.pack>>['pack']
const render = (override = {}, canStart = true) => renderToStaticMarkup(createElement(EmbeddedApplicationContext.Provider, { value: true }, createElement(SpecialTitle, { pack: { ...pack, ...override }, starting: false, canStart, error: '', onStart() {}, onLeaderboard() {} })))

describe('specials share the public game title contract', () => {
  it('shows the shared hero, primary action and saved progress without the old ticket', () => {
    const html = render()
    expect(html).toContain('class="qt-hero"')
    expect(html).toContain('launch-start')
    expect(html).toContain('Продолжить')
    expect(html).toContain('value="4" max="25"')
    expect(html).not.toContain('special-detail-card')
    expect(html).not.toContain('title-game-mark')
  })
  it('does not offer another launch after the pack is completed', () => {
    const html = render({ completedItems: 25 }, false)
    expect(html).toContain('Подборка пройдена')
    expect(html).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*class="[^"]*launch-start)[^>]*>/)
    expect(html).toContain('Рейтинг игроков')
  })
  it('keeps the K-pop daily cadence and generation explanation', () => {
    const html = render({ id: KPOP_ARTISTS_PACK_ID, title: 'K-pop каждый день', totalItems: 120 })
    expect(html).toContain('Играть сегодня')
    expect(html).toContain('00:00 МСК')
    expect(html).toContain('Как считаются поколения')
    expect(html).not.toContain('Прогресс подборки')
  })
})
