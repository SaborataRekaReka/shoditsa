import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DashboardResponse } from '@shoditsa/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const queryState = vi.hoisted(() => ({
  archive: { data: { items: [] }, isLoading: false, isError: false, error: null as Error | null },
  commerce: { data: { subscriptions: [], entitlements: [] }, isLoading: false, isError: false, error: null as Error | null },
  dashboard: null as DashboardResponse | null,
  runtimeLoading: false,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => queryKey[0] === 'archive' ? queryState.archive : queryState.commerce,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}))
vi.mock('../../hooks/use-server-runtime', () => ({
  SERVER_RUNTIME: true,
  useServerRuntime: () => ({
    me: { user: { isAnonymous: true }, profile: {}, badges: [] },
    dashboard: queryState.dashboard,
    loading: queryState.runtimeLoading,
    meta: { features: { connectionsEnabled: true }, moscowDate: '2026-10-16', auth: {} },
  }),
}))
vi.mock('../auth/use-auth-session', () => ({
  useAuthSession: () => ({ session: { isAnonymous: true }, loading: false, refresh: vi.fn() }),
}))
vi.mock('../../components/app-shell/AppShell', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../components/app-shell/AppShell')>(),
  AppHeader: () => null,
}))

import { ProfileScreen } from './ProfileScreen'

const renderProfile = () => renderToStaticMarkup(createElement(ProfileScreen, {
  onHome: vi.fn(), onArchive: vi.fn(), onStats: vi.fn(), onRules: vi.fn(),
  onReview: vi.fn(), onSelectMode: vi.fn(), onClub: vi.fn(),
}))

beforeEach(() => {
  queryState.archive = { data: { items: [] }, isLoading: false, isError: false, error: null }
  queryState.commerce = { data: { subscriptions: [], entitlements: [] }, isLoading: false, isError: false, error: null }
  queryState.dashboard = null
  queryState.runtimeLoading = false
  vi.stubGlobal('window', { location: { search: '', pathname: '/profile', hash: '', href: 'http://localhost/profile' } })
})
afterEach(() => vi.unstubAllGlobals())

describe('profile data states', () => {
  it('does not turn an unavailable dashboard into zero progress', () => {
    const html = renderProfile()
    expect(html).toContain('Статистика временно недоступна')
    expect(html).toContain('Обновить статистику')
    expect(html).toMatch(/<span>Сыграно<\/span><strong>—<\/strong>/)
    expect(html).toMatch(/<span>Билеты<\/span><strong>—<\/strong>/)
    expect(html).not.toContain('Сыграйте сегодня, чтобы начать серию')
    expect(html).not.toContain('Не сыграно')
  })

  it('keeps a loading dashboard separate from a failed one', () => {
    queryState.runtimeLoading = true
    const html = renderProfile()
    expect(html).toContain('role="status">Загружаем статистику…')
    expect(html).not.toContain('Статистика временно недоступна')
  })

  it('shows genuine zero values after a successful dashboard response', () => {
    queryState.dashboard = {
      wallet: { balance: 0, lifetimeEarned: 0 }, attendance: {},
      today: { completedModes: [], wonModes: [], fullHouse: false },
      activeSessions: [], stats: [], membership: { active: false },
    } as unknown as DashboardResponse
    const html = renderProfile()
    expect(html).not.toContain('Статистика временно недоступна')
    expect(html).toMatch(/<span>Сыграно<\/span><strong>0<\/strong>/)
    expect(html).toMatch(/<span>Билеты<\/span><strong>0<\/strong>/)
  })

  it('distinguishes a loading history from an empty history', () => {
    queryState.archive.isLoading = true
    const html = renderProfile()
    expect(html).toContain('role="status">Загружаем последние сеансы…')
    expect(html).not.toContain('Здесь появятся завершённые игры.')
  })

  it('shows a failed history request instead of claiming there are no completed games', () => {
    queryState.archive.isError = true
    queryState.archive.error = new Error('История временно недоступна')
    const html = renderProfile()
    expect(html).toContain('role="alert"')
    expect(html).toContain('История временно недоступна')
    expect(html).not.toContain('Здесь появятся завершённые игры.')
  })

  it('keeps the genuine empty history and native guest account links', () => {
    const html = renderProfile()
    expect(html).toContain('Здесь появятся завершённые игры.')
    expect(html).toMatch(/<a[^>]+href="\/register"[^>]*>Создать аккаунт<\/a>/)
    expect(html).toMatch(/<a[^>]+href="\/login"[^>]*>Уже есть аккаунт<\/a>/)
  })

  it('does not report that auto-renewal is absent when subscription settings failed to load', () => {
    vi.stubGlobal('window', { location: { search: '?tab=settings', pathname: '/profile', hash: '', href: 'http://localhost/profile?tab=settings' } })
    queryState.commerce.isError = true
    queryState.commerce.error = new Error('Настройки платежей временно недоступны')
    const html = renderProfile()
    expect(html).toContain('Настройки платежей временно недоступны')
    expect(html).not.toContain('Автопродление не подключено.')
  })
})
