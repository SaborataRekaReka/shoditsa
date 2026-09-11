import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  analyticsAcquisitionHeaders,
  analyticsEntryParams,
  captureAnalyticsEntry,
  consentedAnalyticsEntryParams,
  initMetrika,
  markAnalyticsOAuthReturnPending,
  setAnalyticsConsent,
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
      dispatchEvent: vi.fn(),
      location: {
        href: 'https://shoditsa.ru/games/character',
        hostname: 'shoditsa.ru',
        pathname: '/games/character',
      },
    })
    vi.stubGlobal('document', {
      referrer: 'https://www.google.com/search?q=guess+character',
      getElementById: () => ({ id: 'yandex-metrika-script', remove: vi.fn() }),
      cookie: '',
    })
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

  it('keeps campaign only in memory before consent and sends three safe UTM keys after acceptance', () => {
    window.location.href = 'https://shoditsa.ru/games/diagnosis?utm_source=tg_med_students&utm_medium=paid_social&utm_campaign=diagnosis_pilot_202609&utm_content=discard_me&email=private%40example.test&token=secret'
    window.location.pathname = '/games/diagnosis'
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' })
    const ym = vi.fn()
    window.ym = ym
    captureAnalyticsEntry()

    const beforeConsent = window.sessionStorage.getItem('shoditsa:analytics-entry:v1')!
    expect(beforeConsent).not.toContain('utm')
    expect(beforeConsent).not.toContain('tg_med_students')
    expect(beforeConsent).not.toContain('private')
    expect(beforeConsent).not.toContain('secret')
    expect(consentedAnalyticsEntryParams()).toEqual({})
    expect(analyticsAcquisitionHeaders()).toEqual({})
    initMetrika()
    expect(ym).not.toHaveBeenCalled()

    // The visitor can navigate before responding to the consent banner.
    window.location.href = 'https://shoditsa.ru/sessions/private-session'
    window.location.pathname = '/sessions/private-session'
    setAnalyticsConsent('accepted')

    expect(consentedAnalyticsEntryParams()).toMatchObject({
      entry_path: '/games/diagnosis', entry_source: 'direct',
      utm_source: 'tg_med_students', utm_medium: 'paid_social', utm_campaign: 'diagnosis_pilot_202609',
    })
    expect(JSON.parse(analyticsAcquisitionHeaders()['X-Shoditsa-Acquisition'])).toMatchObject({
      utm_source: 'tg_med_students', utm_medium: 'paid_social', utm_campaign: 'diagnosis_pilot_202609',
    })
    expect(ym).toHaveBeenCalledWith(110517987, 'init', expect.objectContaining({
      url: 'https://shoditsa.ru/games/diagnosis?utm_source=tg_med_students&utm_medium=paid_social&utm_campaign=diagnosis_pilot_202609',
    }))
    expect(JSON.parse(window.sessionStorage.getItem('shoditsa:analytics-entry:v1')!)).toMatchObject({
      url: 'https://shoditsa.ru/games/diagnosis', path: '/games/diagnosis',
    })
    expect(JSON.stringify(ym.mock.calls)).not.toContain('private')
    expect(JSON.stringify(ym.mock.calls)).not.toContain('discard_me')
  })

  it('validates every campaign slug and ignores ambiguous duplicates or unrelated query data', () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'accepted')
    window.location.href = `https://shoditsa.ru/games/character?utm_source=one&utm_source=two&utm_medium=person%40example.test&utm_campaign=${'x'.repeat(81)}&name=private`
    captureAnalyticsEntry()
    expect(analyticsEntryParams()).not.toHaveProperty('utm_source')
    expect(analyticsEntryParams()).not.toHaveProperty('utm_medium')
    expect(analyticsEntryParams()).not.toHaveProperty('utm_campaign')

    window.location.href = 'https://shoditsa.ru/games/character?utm_source=tg-Med_2026&utm_medium=paid_social&utm_campaign=pilot_01'
    captureAnalyticsEntry()
    expect(analyticsEntryParams()).toMatchObject({ utm_source: 'tg-Med_2026', utm_medium: 'paid_social', utm_campaign: 'pilot_01' })
    // UTM is a separate campaign dimension; existing source classification is preserved.
    expect(analyticsEntryParams().entry_source).toBe('organic_search')
  })

  it('retains consented campaign through OAuth and does not replace it with callback query parameters', () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'accepted')
    window.location.href = 'https://shoditsa.ru/games/character?utm_source=tg_med&utm_medium=paid_social&utm_campaign=pilot'
    captureAnalyticsEntry()
    const acquisition = analyticsEntryParams().acquisition_id
    markAnalyticsOAuthReturnPending()
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' })
    window.location.href = 'https://shoditsa.ru/login?code=private&utm_campaign=replacement'
    window.location.pathname = '/login'
    captureAnalyticsEntry()

    expect(analyticsEntryParams()).toMatchObject({ acquisition_id: acquisition, utm_campaign: 'pilot', entry_path: '/games/character' })
    expect(window.sessionStorage.getItem('shoditsa:analytics-entry:v1')).not.toContain('private')
    expect(window.sessionStorage.getItem('shoditsa:analytics-entry:v1')).not.toContain('replacement')
  })

  it.each(['', 'https://t.me/medical_channel'])('keeps accepted campaign on a SPA reload with referrer %s', (referrer) => {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'accepted')
    Object.defineProperty(document, 'referrer', { configurable: true, value: referrer })
    window.location.href = 'https://shoditsa.ru/games/diagnosis?utm_source=tg_med&utm_medium=paid_social&utm_campaign=diagnosis_pilot_reload'
    window.location.pathname = '/games/diagnosis'
    captureAnalyticsEntry()
    const acquisition = analyticsEntryParams().acquisition_id
    window.location.href = 'https://shoditsa.ru/sessions/27e0927b-9720-4e72-b831-15fa9c8f38eb'
    window.location.pathname = '/sessions/27e0927b-9720-4e72-b831-15fa9c8f38eb'
    Object.defineProperty(window, 'performance', { configurable: true, value: { getEntriesByType: () => [{ type: 'reload' }] } })
    captureAnalyticsEntry()
    expect(analyticsEntryParams()).toMatchObject({ acquisition_id: acquisition, entry_path: '/games/diagnosis', utm_source: 'tg_med', utm_medium: 'paid_social', utm_campaign: 'diagnosis_pilot_reload' })
    expect(JSON.parse(analyticsAcquisitionHeaders()['X-Shoditsa-Acquisition'])).toMatchObject({ acquisition_id: acquisition, utm_campaign: 'diagnosis_pilot_reload' })
    // A genuinely new external navigation remains a new acquisition.
    Object.defineProperty(window, 'performance', { configurable: true, value: { getEntriesByType: () => [{ type: 'navigate' }] } })
    window.location.href = 'https://shoditsa.ru/games/animal'
    window.location.pathname = '/games/animal'
    captureAnalyticsEntry()
    expect(analyticsEntryParams().acquisition_id).not.toBe(acquisition)
    expect(analyticsEntryParams()).not.toHaveProperty('utm_campaign')
  })

  it('falls back to the clean current page if optional stored navigation data is malformed', () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'accepted')
    window.sessionStorage.setItem('shoditsa:analytics-entry:v1', JSON.stringify({
      acquisitionId: '10000000-0000-4000-8000-000000000003', url: 'javascript:private-data',
      path: '/games/character', source: 'direct', referrer: '',
    }))
    const ym = vi.fn()
    window.ym = ym
    expect(() => initMetrika()).not.toThrow()
    expect(ym).toHaveBeenCalledWith(110517987, 'init', expect.objectContaining({ url: 'https://shoditsa.ru/games/character' }))
    expect(JSON.stringify(ym.mock.calls)).not.toContain('private-data')
  })

  it.each(['accepted', null] as const)('clears %s campaign state on rejection and cannot revive it on a later clean page', (initialConsent) => {
    if (initialConsent) window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, initialConsent)
    window.location.href = 'https://shoditsa.ru/games/character?utm_source=tg_med&utm_medium=paid_social&utm_campaign=old_campaign'
    captureAnalyticsEntry()
    setAnalyticsConsent('rejected')
    expect(window.sessionStorage.getItem('shoditsa:analytics-entry:v1')).toBeNull()
    expect(analyticsAcquisitionHeaders()).toEqual({})

    window.location.href = 'https://shoditsa.ru/games/character'
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' })
    setAnalyticsConsent('accepted')
    expect(consentedAnalyticsEntryParams()).not.toHaveProperty('utm_source')
    expect(consentedAnalyticsEntryParams()).not.toHaveProperty('utm_campaign')
  })
})
