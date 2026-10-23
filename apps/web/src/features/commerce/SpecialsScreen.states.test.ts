import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ContentPack } from '@shoditsa/contracts'

const fixture = vi.hoisted(() => ({ access: 'club' as ContentPack['access'], available: true }))
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({
    data: fixture.available ? { pack: {
      id: 'dtf-game-comments-25-v1', mode: 'game', title: 'Что за игра?',
      description: 'Угадай игру по комментариям.', access: fixture.access,
      totalItems: 20, completedItems: 0, entries: [{ position: 1, accessible: true, completed: false }],
    } } : undefined,
    isLoading: !fixture.available, isError: false,
  }),
}))
vi.mock('../../hooks/use-server-runtime', () => ({ SERVER_RUNTIME: true }))
vi.mock('../../components/app-shell/AppShell', async importOriginal => ({
  ...await importOriginal<typeof import('../../components/app-shell/AppShell')>(),
  AppHeader: () => null,
}))

import { SpecialDetailScreen } from './SpecialsScreen'

const render = () => renderToStaticMarkup(createElement(SpecialDetailScreen, {
  packId: 'dtf-game-comments-25-v1', onHome: vi.fn(), onArchive: vi.fn(),
  onStats: vi.fn(), onRules: vi.fn(), onReview: vi.fn(), onSession: vi.fn(),
}))

describe('special detail access', () => {
  it.each(['club', 'personal', 'admin'] as const)('renders the playable special for %s access', access => {
    fixture.access = access; fixture.available = true
    const html = render()
    expect(html).toContain('Что за игра?')
    expect(html).toContain('Начать игру')
    expect(html).not.toContain('Открыть на shoditsa.ru')
  })
  it('waits for the offer redirect without exposing the play screen when access is locked', () => {
    fixture.access = 'locked'; fixture.available = true
    const html = render()
    expect(html).not.toContain('Начать игру')
    expect(html).not.toContain('special-title-screen')
  })
  it('does not expose a launch before the server has returned the pack', () => {
    fixture.available = false
    expect(render()).not.toContain('Начать игру')
  })
})
