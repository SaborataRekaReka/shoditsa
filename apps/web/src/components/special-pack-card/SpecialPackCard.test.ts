import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SpecialPackCard } from './SpecialPackCard'
import type { ClubLibraryItem } from '../../dev/quest-game/club-library-model'

const pack: ClubLibraryItem = { id: 'dtf-game-comments-25-v1', mode: 'game', title: 'Что за игра?', subtitle: '', description: '', coverUrl: null, totalItems: 20, completedItems: 7, access: 'club', cadence: 'collection' }
const render = (value: ClubLibraryItem) => renderToStaticMarkup(createElement(SpecialPackCard, { pack: value, headingLevel: 2 }))
describe('shared special pack card', () => {
  it('uses the Club cover and real progress, with a continuation link for started shows', () => {
    const html = render(pack)
    expect(html).toContain('dtf-comments-scene-v6.webp')
    expect(html).toContain('7 из 20')
    expect(html).toContain('Продолжить')
    expect(html).toContain('href="/specials/dtf-game-comments-25-v1"')
  })
  it('keeps locked progress private and sends the offer to the Club', () => {
    const html = render({ ...pack, access: 'locked' })
    expect(html).not.toContain('7 из 20')
    expect(html).toContain('Открыть с Клубом')
    expect(html).toContain('href="/club/membership"')
  })
  it('shows a daily cadence instead of treating the answer pool as a progress goal', () => {
    const html = render({ ...pack, id: 'kpop-artists-admin-v1', mode: 'music', cadence: 'daily', totalItems: 340 })
    expect(html).toContain('kpop-stage-scene-v2.webp')
    expect(html).toContain('Новая загадка каждый день')
    expect(html).not.toContain('из 340')
  })
})
