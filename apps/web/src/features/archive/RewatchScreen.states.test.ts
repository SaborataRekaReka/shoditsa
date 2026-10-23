import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ failed: true }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({
    data: state.failed ? undefined : { items: [{ date: '2026-10-16', access: 'free', session: null }, { date: '2026-10-01', access: 'locked', session: null }] },
    isError: state.failed, isLoading: false, error: new Error('Архив временно недоступен'), refetch: vi.fn(),
  }),
  useQueries: () => [],
}))
vi.mock('../../hooks/use-server-runtime', () => ({
  SERVER_RUNTIME: true,
  useServerRuntime: () => ({ me: {}, dashboard: null, meta: { features: { connectionsEnabled: true } } }),
}))
vi.mock('../../components/app-shell/AppShell', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../components/app-shell/AppShell')>(),
  AppHeader: () => null,
}))
import { RewatchScreen } from './RewatchScreen'

const renderArchive = () => renderToStaticMarkup(createElement(RewatchScreen, {
  mode: 'movie', setMode: vi.fn(), period: 'all', dates: ['2026-10-16', '2026-10-01'], games: [], titles: [],
  onOpen: vi.fn(), onOpenConnections: vi.fn(), onHome: vi.fn(), onStats: vi.fn(), onRules: vi.fn(), onReview: vi.fn(), onClub: vi.fn(),
}))
beforeEach(() => { state.failed = true })
describe('archive data states', () => {
  it('does not present a failed calendar as a club access restriction', () => {
    const html = renderArchive()
    expect(html).toContain('Архив временно недоступен')
    expect(html).toContain('Попробовать снова')
    expect(html).not.toContain('rewatch-grid')
    expect(html).not.toContain('Полный архив клуба')
  })
  it('preserves free and club dates when the calendar is available', () => {
    state.failed = false
    const html = renderArchive()
    expect(html).toContain('rewatch-grid')
    expect(html).toContain('Не сыгран')
    expect(html).toContain('Полный архив клуба')
    expect(html).not.toContain('Попробовать снова')
  })
})
