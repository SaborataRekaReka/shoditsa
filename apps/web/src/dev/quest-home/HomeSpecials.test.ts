import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentPack } from '@shoditsa/contracts'

const fixture = vi.hoisted(() => ({ items: [] as ContentPack[] }))
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({ data: { items: fixture.items }, isPending: false, isError: false }),
}))
vi.mock('../../hooks/use-server-runtime', () => ({ SERVER_RUNTIME: true }))

import { HomeSpecials } from './HomeSpecials'

const pack = (access: ContentPack['access']): ContentPack => ({
  id: 'dtf-game-comments-25-v1', slug: 'dtf', mode: 'game', title: 'Что за игра?',
  subtitle: null, description: 'Угадай игру по комментариям.', coverUrl: null,
  accessModel: 'club', includedInClub: true, previewItems: 0, totalItems: 20,
  productId: null, priceMinor: null, currency: null, access, owned: false, completedItems: 0,
})
beforeEach(() => { fixture.items = [] })

describe('home special card actions', () => {
  it.each(['club', 'personal', 'admin'] as const)('links %s access directly to the special', access => {
    fixture.items = [pack(access)]
    const html = renderToStaticMarkup(createElement(HomeSpecials))
    expect(html).toContain('href="/specials/dtf-game-comments-25-v1"')
    expect(html).toContain('Открыть спецпоказ')
    expect(html).not.toContain('target="_blank"')
    expect(html).not.toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('Подробнее')
  })
  it('links a locked card to the club offer, without a preview dialog or external link', () => {
    fixture.items = [pack('locked')]
    const html = renderToStaticMarkup(createElement(HomeSpecials))
    expect(html).toContain('href="/club/membership"')
    expect(html).toContain('Открыть с Клубом')
    expect(html).not.toContain('href="/specials/dtf-game-comments-25-v1"')
    expect(html).not.toContain('shoditsa.ru')
    expect(html).not.toContain('<button')
  })
})
