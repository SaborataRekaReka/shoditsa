import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backfillQueuedClientEventAttribution, clearQueuedClientEvents, deterministicClientEventId, flushClientEvents, purgeQueuedClientEventAttribution, trackClientEvent, trackConsentedLanding } from './client-events'

const values = new Map<string, string>()
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
}

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { onLine: false })
  vi.stubGlobal('window', {
    localStorage: storage,
    sessionStorage: storage,
    location: { origin: 'https://shoditsa.ru', pathname: '/sessions/example' },
  })
})

describe('first-party client event identities', () => {
  it('creates stable, distinct RFC-compatible UUIDs for lifecycle events', () => {
    const first = deterministicClientEventId('27e0927b-9720-4e72-b831-15fa9c8f38eb', 'game_session_complete')
    const replay = deterministicClientEventId('27e0927b-9720-4e72-b831-15fa9c8f38eb', 'game_session_complete')
    const start = deterministicClientEventId('27e0927b-9720-4e72-b831-15fa9c8f38eb', 'game_session_start')

    expect(first).toBe(replay)
    expect(first).not.toBe(start)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('keeps the original queued event when the same id is retried', () => {
    const eventId = deterministicClientEventId('27e0927b-9720-4e72-b831-15fa9c8f38eb', 'danetki_room_completed')
    const context = { eventId, gameSessionId: '27e0927b-9720-4e72-b831-15fa9c8f38eb' }

    trackClientEvent('danetki_room_completed', { outcome: 'won', questionCount: 5 }, context)
    trackClientEvent('danetki_room_completed', { outcome: 'won', questionCount: 6 }, context)

    const queue = JSON.parse(values.get('shoditsa:client-events:v1') ?? '[]') as Array<{ eventId: string; properties: { questionCount: number } }>
    expect(queue).toHaveLength(1)
    expect(queue[0]?.eventId).toBe(eventId)
    expect(queue[0]?.properties.questionCount).toBe(5)
  })

  it('adds consented acquisition context and does not allow callers to spoof it', () => {
    storage.setItem('shoditsa:analytics-consent:v1', 'accepted')
    storage.setItem('shoditsa:analytics-entry:v1', JSON.stringify({
      acquisitionId: '8c4f102e-317b-4a07-b8d6-80bdc99624ef',
      url: 'https://shoditsa.ru/games/character',
      path: '/games/character',
      referrer: 'https://www.google.com/',
      referrerHost: 'www.google.com',
      source: 'organic_search',
      searchEngine: 'google',
    }))

    trackClientEvent('game_session_start', {
      mode: 'character',
      entry_source: 'direct',
      acquisition_id: 'spoofed',
    })

    const queue = JSON.parse(values.get('shoditsa:client-events:v1') ?? '[]') as Array<{ properties: Record<string, unknown> }>
    expect(queue[0]?.properties).toMatchObject({
      mode: 'character',
      acquisition_id: '8c4f102e-317b-4a07-b8d6-80bdc99624ef',
      entry_path: '/games/character',
      entry_source: 'organic_search',
      entry_search_engine: 'google',
    })
  })

  it('removes queued acquisition context when analytics consent is withdrawn', () => {
    storage.setItem('shoditsa:analytics-consent:v1', 'accepted')
    storage.setItem('shoditsa:analytics-entry:v1', JSON.stringify({
      acquisitionId: '8c4f102e-317b-4a07-b8d6-80bdc99624ef',
      url: 'https://shoditsa.ru/games/character',
      path: '/games/character',
      referrer: 'https://www.google.com/',
      referrerHost: 'www.google.com',
      source: 'organic_search',
      searchEngine: 'google',
    }))
    trackClientEvent('game_session_start', { mode: 'character' })

    storage.setItem('shoditsa:analytics-consent:v1', 'rejected')
    purgeQueuedClientEventAttribution()

    const queue = JSON.parse(values.get('shoditsa:client-events:v1') ?? '[]') as Array<{ properties: Record<string, unknown> }>
    expect(queue[0]?.properties).toEqual({ mode: 'character' })
  })

  it('drops caller-supplied attribution when consent is absent', () => {
    trackClientEvent('game_session_start', {
      mode: 'character',
      acquisition_id: '8c4f102e-317b-4a07-b8d6-80bdc99624ef',
      entry_source: 'organic_search',
    })

    const queue = JSON.parse(values.get('shoditsa:client-events:v1') ?? '[]') as Array<{ properties: Record<string, unknown> }>
    expect(queue[0]?.properties).toEqual({ mode: 'character' })
  })

  it('keeps pre-consent lifecycle events local and attributes them after acceptance', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    trackClientEvent('game_session_start', { mode: 'character' })
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()

    storage.setItem('shoditsa:analytics-consent:v1', 'accepted')
    storage.setItem('shoditsa:analytics-entry:v1', JSON.stringify({
      acquisitionId: '8c4f102e-317b-4a07-b8d6-80bdc99624ef',
      url: 'https://shoditsa.ru/games/character',
      path: '/games/character',
      referrer: 'https://yandex.ru',
      referrerHost: 'yandex.ru',
      source: 'organic_search',
      searchEngine: 'yandex',
    }))
    backfillQueuedClientEventAttribution()
    await flushClientEvents()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { events: Array<{ properties: Record<string, unknown> }> }
    expect(sent.events[0]?.properties).toMatchObject({
      mode: 'character',
      acquisition_id: '8c4f102e-317b-4a07-b8d6-80bdc99624ef',
      entry_source: 'organic_search',
      entry_search_engine: 'yandex',
      entry_path: '/games/character',
    })
  })

  it('uploads pre-consent technical events without attribution after rejection', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    trackClientEvent('game_session_start', { mode: 'character' })
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()

    storage.setItem('shoditsa:analytics-consent:v1', 'rejected')
    await flushClientEvents()

    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { events: Array<{ properties: Record<string, unknown> }> }
    expect(sent.events[0]?.properties).toEqual({ mode: 'character' })
  })

  it('fails open when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      ...storage,
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') },
    })

    expect(() => trackClientEvent('game_next_clicked', { from_mode: 'danetki', to_mode: 'diagnosis' })).not.toThrow()
  })

  it('redacts dynamic routes and bounds property values before queueing', () => {
    window.location.pathname = '/danetki/join/private-invite-token'
    trackClientEvent('danetki_registration_offer_clicked', {
      returnUrl: '/sessions/27e0927b-9720-4e72-b831-15fa9c8f38eb?token=secret',
      note: 'x'.repeat(600),
      ['x'.repeat(81)]: 'discard me',
    })

    const queue = JSON.parse(values.get('shoditsa:client-events:v1') ?? '[]') as Array<{ route: string; properties: Record<string, string> }>
    expect(queue[0]?.route).toBe('/danetki/join')
    expect(queue[0]?.properties.returnUrl).toBe('/sessions/:id')
    expect(queue[0]?.properties.note).toHaveLength(500)
    expect(Object.keys(queue[0]?.properties ?? {})).not.toContain('x'.repeat(81))
  })

  it('records one attributed landing when consent is granted before a game starts', () => {
    storage.setItem('shoditsa:analytics-consent:v1', 'accepted')
    storage.setItem('shoditsa:analytics-entry:v1', JSON.stringify({
      acquisitionId: '8c4f102e-317b-4a07-b8d6-80bdc99624ef',
      url: 'https://shoditsa.ru/danetki',
      path: '/danetki',
      referrer: 'https://www.google.com',
      referrerHost: 'www.google.com',
      source: 'organic_search',
      searchEngine: 'google',
    }))

    trackConsentedLanding()
    trackConsentedLanding()

    const queue = JSON.parse(values.get('shoditsa:client-events:v1') ?? '[]') as Array<{ eventName: string; properties: Record<string, unknown> }>
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      eventName: 'page_view',
      properties: { consent_granted: true, entry_source: 'organic_search', entry_path: '/danetki' },
    })
  })

  it('drops a permanently invalid queued batch so newer telemetry is not blocked', async () => {
    storage.setItem('shoditsa:analytics-consent:v1', 'rejected')
    trackClientEvent('page_view')
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 }))

    await flushClientEvents()

    expect(JSON.parse(values.get('shoditsa:client-events:v1') ?? '[]')).toEqual([])
  })

  it('clears queued telemetry at an explicit account boundary', () => {
    trackClientEvent('page_view')
    expect(JSON.parse(values.get('shoditsa:client-events:v1') ?? '[]')).toHaveLength(1)

    clearQueuedClientEvents()

    expect(JSON.parse(values.get('shoditsa:client-events:v1') ?? '[]')).toEqual([])
  })
})
