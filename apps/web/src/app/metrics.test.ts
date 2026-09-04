import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  analyticsEntryParams,
  captureAnalyticsEntry,
  consentedAnalyticsEntryParams,
  initMetrika,
  markAnalyticsOAuthReturnPending,
  trackMetrikaGoal,
  trackMetrikaScreen,
  trackConfirmedAuthOutcome,
} from './metrics'

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => { values.set(key, value) },
  } satisfies Storage
}

describe('analytics acquisition context', () => {
  beforeEach(() => {
    const localStorage = memoryStorage()
    const sessionStorage = memoryStorage()
    vi.stubGlobal('window', {
      localStorage,
      sessionStorage,
      location: {
        href: 'https://shoditsa.ru/games/character?utm_source=test',
        hostname: 'shoditsa.ru',
        pathname: '/games/character',
      },
    })
    vi.stubGlobal('document', { referrer: 'https://www.google.com/search?q=guess+character' })
  })

  it('uses the server auth outcome and deduplicates it, without inventing success for unknown outcomes', () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'accepted')
    window.ym = vi.fn()
    const event = { eventId: '10000000-0000-4000-8000-000000000005', action: 'sign_in' as const }
    expect(trackConfirmedAuthOutcome(event, { method: 'yandex' })).toBe('sign_in')
    expect(trackConfirmedAuthOutcome(event)).toBeNull()
    expect(trackConfirmedAuthOutcome(null)).toBeNull()
    expect(window.ym).toHaveBeenCalledTimes(2)
    expect(window.ym).toHaveBeenCalledWith(110517987, 'reachGoal', 'sign_in_success', expect.objectContaining({ action: 'sign_in', outcome_source: 'server_session' }))
    expect(window.ym).not.toHaveBeenCalledWith(110517987, 'reachGoal', 'sign_up_success', expect.anything())
  })

  it('keeps a stable opaque acquisition id and exposes it only after consent', () => {
    captureAnalyticsEntry()
    const captured = analyticsEntryParams()

    expect(captured).toMatchObject({
      entry_path: '/games/character',
      entry_source: 'organic_search',
      entry_search_engine: 'google',
    })
    expect(captured.acquisition_id).toEqual(expect.any(String))
    expect(consentedAnalyticsEntryParams()).toEqual({})
    expect(JSON.parse(window.sessionStorage.getItem('shoditsa:analytics-entry:v1') ?? '{}')).toMatchObject({
      url: 'https://shoditsa.ru/games/character',
      referrer: 'https://www.google.com',
    })

    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'accepted')
    expect(consentedAnalyticsEntryParams()).toEqual(captured)

    Object.defineProperty(document, 'referrer', { configurable: true, value: 'https://shoditsa.ru/' })
    captureAnalyticsEntry()
    expect(analyticsEntryParams().acquisition_id).toBe(captured.acquisition_id)
  })

  it('does not classify OAuth hosts as search or replace a preserved acquisition', () => {
    captureAnalyticsEntry()
    const acquisitionId = analyticsEntryParams().acquisition_id
    Object.defineProperty(document, 'referrer', { configurable: true, value: 'https://oauth.yandex.ru/authorize?client_id=secret' })

    captureAnalyticsEntry()

    expect(analyticsEntryParams()).toMatchObject({ acquisition_id: acquisitionId, entry_source: 'organic_search', entry_search_engine: 'google' })
  })

  it('preserves acquisition through an OAuth return even when referrer is empty', () => {
    captureAnalyticsEntry()
    const acquisitionId = analyticsEntryParams().acquisition_id
    markAnalyticsOAuthReturnPending()
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' })

    captureAnalyticsEntry()

    expect(analyticsEntryParams()).toMatchObject({ acquisition_id: acquisitionId, entry_source: 'organic_search' })
  })

  it('redacts private route identifiers and never sends goals after consent is rejected', () => {
    window.location.href = 'https://shoditsa.ru/sessions/27e0927b-9720-4e72-b831-15fa9c8f38eb?token=secret'
    window.location.pathname = '/sessions/27e0927b-9720-4e72-b831-15fa9c8f38eb'
    captureAnalyticsEntry()
    expect(analyticsEntryParams().entry_path).toBe('/sessions/:id')

    const ym = vi.fn()
    window.ym = ym
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'rejected')
    trackMetrikaGoal('game_session_start', { mode: 'character' })
    expect(ym).not.toHaveBeenCalled()
  })

  it('does not recreate acquisition storage after explicit rejection', () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'rejected')

    captureAnalyticsEntry()

    expect(analyticsEntryParams()).toEqual({})
    expect(window.sessionStorage.getItem('shoditsa:analytics-entry:v1')).toBeNull()
  })

  it('redacts private identifiers from virtual screen hits', () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'accepted')
    window.location.pathname = '/danetki/join/private-invite-token'
    const ym = vi.fn()
    window.ym = ym

    trackMetrikaScreen('game')

    expect(ym).toHaveBeenCalledWith(110517987, 'hit', '/danetki/join#game', expect.any(Object))
  })

  it('initializes the first visit from the preserved landing after consent', () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'accepted')
    captureAnalyticsEntry()
    const ym = vi.fn()
    window.ym = ym
    vi.stubGlobal('document', {
      referrer: 'https://www.google.com/search?q=guess+character',
      title: 'Игра «Угадай персонажа»',
      getElementById: () => ({ id: 'yandex-metrika-script' }),
    })

    initMetrika()

    expect(ym).toHaveBeenCalledTimes(1)
    expect(ym).toHaveBeenCalledWith(110517987, 'init', expect.objectContaining({
      ssr: true,
      url: 'https://shoditsa.ru/games/character',
      referrer: 'https://www.google.com',
      params: expect.objectContaining({
        analytics_consent: 'accepted',
        landing_hit: true,
        entry_path: '/games/character',
        entry_source: 'organic_search',
      }),
    }))
  })
})
