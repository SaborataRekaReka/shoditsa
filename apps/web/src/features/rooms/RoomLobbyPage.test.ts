import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const access = vi.hoisted(() => ({ allowed: false, status: 'ready', retry: vi.fn() }))
vi.mock('./RoomCreationAccess', () => ({ useRoomCreationAccess: () => access }))
vi.mock('../svoyak/SvoyakHomeCard', () => ({ SVOYAK_ENABLED: true }))
vi.mock('../application/ApplicationFrame', () => ({ ApplicationFrame: ({ children, aside }: { children: ReactNode; aside: ReactNode }) => createElement('div', null, children, aside) }))
import RoomLobbyPage from './RoomLobbyPage'
import { ApiClientError, queryKeys } from '../../api/client'
import { svoyakDirectoryKey } from '../svoyak/room-directory-client'
beforeEach(() => { access.allowed = false; access.status = 'ready' })
const render = (rooms: object[] | ApiClientError | null = [], recent: object[] = [], svoyak: object[] = []) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  if (rooms instanceof ApiClientError) client.getQueryCache().build(client, { queryKey: queryKeys.friendsRooms }).setState({ status: 'error', error: rooms })
  else if (rooms) client.setQueryData(queryKeys.friendsRooms, { rooms })
  client.setQueryData(queryKeys.friendsRoomDirectory, { rooms: recent })
  client.setQueryData(svoyakDirectoryKey, svoyak)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(RoomLobbyPage)))
}

describe('room configuration workspace', () => {
  it('lets a guest configure before offering Club once, while joining stays free', () => {
    const html = render()
    expect(html).toContain('Своя игра')
    expect(html).toContain('Подборка: Кино')
    expect(html).toContain('Количество раундов')
    expect(html.match(/href="\/club\/membership"/g)).toHaveLength(1)
    expect(html).toContain('Код комнаты')
    expect(html).not.toContain('href="/svoyak/create"')
    expect(html).not.toContain('Создать комнату</button>')
  })
  it('creates from inline settings instead of three navigation cards', () => {
    access.allowed = true
    const html = render()
    expect(html).toContain('Создать комнату')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('href="/games/together?new=1"')
    expect(html).not.toContain('href="/club/membership"')
  })
  it.each(['loading', 'error'])('keeps creation gated while verification is %s', status => {
    access.status = status
    const html = render()
    expect(html).not.toContain('href="/club/membership"')
    expect(html).not.toContain('Создать комнату</button>')
    expect(html).toContain('disabled=""')
  })
  it('resumes an existing room instead of promising to create another one', () => {
    access.allowed = true
    const html = render([{ id: 'existing', code: 'AB234', gameType: 'quiz', mode: 'movie', packs: [{ mode: 'movie', variant: 'all' }], phase: 'lobby', players: 2, capacity: 8, isHost: true }])
    expect(html).toContain('room=AB234')
    expect(html).toContain('aria-label="Комнаты"')
    expect(html).toContain('Ты создатель')
    expect(html).toContain('Закрыть комнату')
    expect(html).toContain('Скопировать приглашение')
    expect(html).not.toContain('aria-label="Настройка игры"')
    expect(html).not.toContain('Создать комнату')
  })
  it('keeps closed rooms in history without an invitation or inaccessible results link', () => {
    const html = render([], [{ id: 'past', code: 'OLD23', gameType: 'territory', mode: 'movie', packs: [], phase: 'finished', players: 0, participantCount: 2, capacity: 2, isHost: false, joinedAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T11:00:00Z', leftAt: '2026-10-20T11:00:00Z', closedAt: '2026-10-20T11:00:00Z' }])
    expect(html).toContain('Недавние комнаты')
    expect(html).toContain('Ты игрок')
    expect(html).toContain('Новая комната')
    expect(html).toContain('Участников: 2')
    expect(html).not.toContain('href="/games/together?room=OLD23"')
    expect(html).not.toContain('Скопировать приглашение')
    expect(html).not.toContain('aria-label="Настройка игры"')
  })
  it('resumes Svoyak from the same directory and blocks creating another game', () => {
    access.allowed = true
    const html = render([], [], [{ id: 'svoyak:ABCDEF', code: 'ABCDEF', gameType: 'svoyak', mode: 'movie', packs: [], phase: 'lobby', players: 3, capacity: 13, isHost: true }])
    expect(html).toContain('href="/svoyak/rooms/ABCDEF"')
    expect(html).toContain('Своя игра')
    expect(html).toContain('Закрыть комнату')
    expect(html).not.toContain('aria-label="Настройка игры"')
    expect(html).not.toContain('Новая комната')
  })
  it('does not offer creation until the current membership is known', () => {
    access.allowed = true
    const html = render(null)
    expect(html).toContain('Проверяем текущую комнату')
    expect(html).not.toContain('Создать комнату')
  })
  it('offers sign-in for a real 401 instead of treating missing authentication as a broken room directory', () => {
    access.status = 'auth-required'
    const html = render(new ApiClientError(401, 'AUTH_REQUIRED', 'Sign in'))
    expect(html).toContain('Количество раундов')
    expect(html).toContain('href="/login?returnUrl=%2Flobby"')
    expect(html).not.toContain('Не удалось проверить текущую комнату')
    expect(html).not.toContain('Не удалось проверить клубный билет')
    expect(html).not.toContain('Создать комнату</button>')
  })
  it('keeps a real server failure distinct from an unauthenticated response', () => {
    const html = render(new ApiClientError(503, 'UNAVAILABLE', 'Unavailable'))
    expect(html).toContain('Не удалось проверить текущую комнату')
    expect(html).not.toContain('aria-label="Настройка игры"')
    expect(html).not.toContain('Создать комнату</button>')
  })
})
