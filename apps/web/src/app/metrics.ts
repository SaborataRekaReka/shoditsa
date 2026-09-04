type RefactorMetric = {
  name: string
  value: number
  unit: 'ms' | 'score'
  meta?: Record<string, string | number | boolean>
  at: string
}
type MetrikaParamValue = string | number | boolean
const METRIKA_COUNTER_ID = 110517987
const METRIKA_SCRIPT_ID = 'yandex-metrika-script'
const ANALYTICS_ENTRY_STORAGE_KEY = 'shoditsa:analytics-entry:v1'
const ANALYTICS_OAUTH_RETURN_STORAGE_KEY = 'shoditsa:analytics-oauth-return:v1'
const ANALYTICS_AUTH_INTENT_STORAGE_KEY = 'shoditsa:analytics-auth-intent:v1'
const ANALYTICS_OAUTH_RETURN_TTL_MS = 15 * 60_000
export const ANALYTICS_CONSENT_STORAGE_KEY = 'shoditsa:analytics-consent:v1'
export const ANALYTICS_CONSENT_EVENT = 'shoditsa:analytics-consent-changed'
export type AnalyticsConsent = 'accepted' | 'rejected'

type AnalyticsEntry = {
  acquisitionId: string
  url: string
  path: string
  referrer: string
  referrerHost: string
  source: 'organic_search' | 'direct' | 'referral'
  searchEngine: string
}

declare global {
  interface Window {
    __SEANS_REFACTOR_METRICS__?: RefactorMetric[]
    ym?: (...args: unknown[]) => void
    dataLayer?: unknown[]
    __SHODITSA_METRIKA_INITIALIZED__?: boolean
  }
}

type MetrikaStub = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number }

const searchEngineFromHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^(?:www|m)\./, '')
  if (/^yandex\.(?:az|by|co\.il|kg|kz|md|ru|tj|tm|com\.tr|uz|com)$/.test(host) || host === 'ya.ru') return 'yandex'
  if (/^google\.(?:[a-z]{2,3}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host)) return 'google'
  if (host === 'bing.com') return 'bing'
  if (host === 'duckduckgo.com') return 'duckduckgo'
  if (host === 'go.mail.ru') return 'mailru'
  return ''
}

const preservesAcquisitionHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return /^(?:oauth|id)\.yandex\.(?:az|by|co\.il|kg|kz|md|ru|tj|tm|com\.tr|uz|com)$/.test(host)
    || host === 'accounts.google.com'
}

const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : ''
export const canonicalAnalyticsPath = (value: string) => {
  const path = value.startsWith('/') ? value : '/'
  if (/^\/sessions\/[^/]+/.test(path)) return '/sessions/:id'
  if (/^\/danetki\/join\/[^/]+/.test(path)) return '/danetki/join'
  if (/^\/specials\/[^/]+/.test(path)) return '/specials/:pack'
  if (/^\/auth(?:\/|$)/.test(path)) return '/auth'
  if (path.length > 160 || !/^\/[a-zA-Z0-9_~%./:@-]*$/.test(path)) return '/other'
  return path
}
const safeNavigationUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value) return ''
  try {
    const parsed = new URL(value, typeof window === 'undefined' ? 'https://shoditsa.ru' : window.location.origin)
    return `${parsed.origin}${canonicalAnalyticsPath(parsed.pathname)}`
  } catch {
    return ''
  }
}
const safeReferrerUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value) return ''
  try { return new URL(value).origin } catch { return '' }
}

export const markAnalyticsOAuthReturnPending = () => {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.setItem(ANALYTICS_OAUTH_RETURN_STORAGE_KEY, String(Date.now())) } catch { /* optional attribution only */ }
}

export type AnalyticsAuthIntent = 'sign_up' | 'sign_in'

export const markAnalyticsAuthIntent = (intent: AnalyticsAuthIntent) => {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.setItem(ANALYTICS_AUTH_INTENT_STORAGE_KEY, JSON.stringify({ intent, createdAt: Date.now() })) } catch { /* optional analytics only */ }
}

export const consumeAnalyticsAuthIntent = (): AnalyticsAuthIntent | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(ANALYTICS_AUTH_INTENT_STORAGE_KEY) ?? 'null') as { intent?: unknown; createdAt?: unknown } | null
    window.sessionStorage.removeItem(ANALYTICS_AUTH_INTENT_STORAGE_KEY)
    if ((raw?.intent !== 'sign_up' && raw?.intent !== 'sign_in') || typeof raw.createdAt !== 'number') return null
    return Date.now() - raw.createdAt <= ANALYTICS_OAUTH_RETURN_TTL_MS ? raw.intent : null
  } catch {
    return null
  }
}

export const clearAnalyticsAuthIntent = () => {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.removeItem(ANALYTICS_AUTH_INTENT_STORAGE_KEY) } catch { /* optional analytics only */ }
}

const consumeAnalyticsOAuthReturnPending = () => {
  if (typeof window === 'undefined') return false
  try {
    const startedAt = Number(window.sessionStorage.getItem(ANALYTICS_OAUTH_RETURN_STORAGE_KEY))
    window.sessionStorage.removeItem(ANALYTICS_OAUTH_RETURN_STORAGE_KEY)
    return Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt <= ANALYTICS_OAUTH_RETURN_TTL_MS
  } catch {
    return false
  }
}

const readAnalyticsEntry = (): AnalyticsEntry | null => {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.sessionStorage.getItem(ANALYTICS_ENTRY_STORAGE_KEY) ?? 'null') as Partial<AnalyticsEntry> | null
    if (!value?.url || !value.path || !['organic_search', 'direct', 'referral'].includes(String(value.source))) return null
    return {
      acquisitionId: uuid(value.acquisitionId),
      url: safeNavigationUrl(value.url),
      path: canonicalAnalyticsPath(value.path),
      referrer: safeReferrerUrl(value.referrer),
      referrerHost: value.referrerHost ?? '',
      source: value.source as AnalyticsEntry['source'],
      searchEngine: value.searchEngine ?? '',
    }
  } catch {
    return null
  }
}

export const captureAnalyticsEntry = () => {
  if (typeof window === 'undefined') return
  if (storedAnalyticsConsent() === 'rejected') return
  let referrerHost = ''
  try { referrerHost = document.referrer ? new URL(document.referrer).hostname : '' } catch { /* ignore invalid referrers */ }
  const existing = readAnalyticsEntry()
  const oauthReturnPending = consumeAnalyticsOAuthReturnPending()
  if (existing && (oauthReturnPending || referrerHost === window.location.hostname || preservesAcquisitionHost(referrerHost))) {
    try { window.sessionStorage.setItem(ANALYTICS_ENTRY_STORAGE_KEY, JSON.stringify({ ...existing, acquisitionId: existing.acquisitionId || crypto.randomUUID() })) } catch { /* ignore unavailable storage */ }
    return
  }
  const searchEngine = searchEngineFromHost(referrerHost)
  const entry: AnalyticsEntry = {
    acquisitionId: crypto.randomUUID(),
    url: safeNavigationUrl(window.location.href),
    path: canonicalAnalyticsPath(window.location.pathname),
    referrer: safeReferrerUrl(document.referrer),
    referrerHost,
    source: searchEngine ? 'organic_search' : document.referrer ? 'referral' : 'direct',
    searchEngine,
  }
  try { window.sessionStorage.setItem(ANALYTICS_ENTRY_STORAGE_KEY, JSON.stringify(entry)) } catch { /* ignore unavailable storage */ }
}

export const analyticsEntryParams = (): Record<string, MetrikaParamValue> => {
  const entry = readAnalyticsEntry()
  if (!entry) return {}
  return {
    ...(entry.acquisitionId ? { acquisition_id: entry.acquisitionId } : {}),
    entry_path: entry.path,
    entry_source: entry.source,
    ...(entry.searchEngine ? { entry_search_engine: entry.searchEngine } : {}),
    ...(entry.referrerHost ? { entry_referrer_host: entry.referrerHost } : {}),
  }
}

export const consentedAnalyticsEntryParams = (): Record<string, MetrikaParamValue> => (
  storedAnalyticsConsent() === 'accepted' ? analyticsEntryParams() : {}
)

export const analyticsAcquisitionHeaders = (): Record<string, string> => {
  const entry = consentedAnalyticsEntryParams()
  if (!entry.acquisition_id || !entry.entry_source || !entry.entry_path) return {}
  return { 'X-Shoditsa-Acquisition': JSON.stringify(entry) }
}

export const storedAnalyticsConsent = (): AnalyticsConsent | null => {
  if (typeof window === 'undefined') return null
  const value = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)
  return value === 'accepted' || value === 'rejected' ? value : null
}

export const initMetrika = () => {
  if (typeof window === 'undefined' || window.__SHODITSA_METRIKA_INITIALIZED__) return
  const entry = readAnalyticsEntry()
  const stub: MetrikaStub = (window.ym as MetrikaStub | undefined) ?? ((...args: unknown[]) => {
    stub.a = stub.a ?? []
    stub.a.push(args)
  })
  stub.l = Date.now()
  window.ym = stub
  window.__SHODITSA_METRIKA_INITIALIZED__ = true

  if (!document.getElementById(METRIKA_SCRIPT_ID)) {
    const script = document.createElement('script')
    script.id = METRIKA_SCRIPT_ID
    script.async = true
    script.src = 'https://mc.yandex.ru/metrika/tag.js?id=110517987'
    document.head.appendChild(script)
  }

  const landingParams = normalizeMetrikaParams({
    analytics_consent: 'accepted',
    landing_hit: true,
    ...consentedAnalyticsEntryParams(),
  })
  stub(METRIKA_COUNTER_ID, 'init', {
    ssr: true,
    webvisor: false,
    clickmap: true,
    ecommerce: 'dataLayer',
    accurateTrackBounce: true,
    trackLinks: true,
    url: entry?.url ?? safeNavigationUrl(window.location.href),
    referrer: entry?.referrer ?? safeReferrerUrl(document.referrer),
    ...(landingParams ? { params: landingParams } : {}),
  })
}

export const initMetrikaFromStoredConsent = () => {
  if (storedAnalyticsConsent() === 'accepted') initMetrika()
}

export const setAnalyticsConsent = (consent: AnalyticsConsent) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, consent)
  if (consent === 'accepted') {
    if (!readAnalyticsEntry()) captureAnalyticsEntry()
    window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: { consent } }))
    initMetrika()
    return
  }

  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: { consent } }))

  try { window.sessionStorage.removeItem(ANALYTICS_ENTRY_STORAGE_KEY) } catch { /* ignore unavailable storage */ }
  try { window.sessionStorage.removeItem(ANALYTICS_OAUTH_RETURN_STORAGE_KEY) } catch { /* ignore unavailable storage */ }
  try { window.ym?.(METRIKA_COUNTER_ID, 'destruct') } catch { /* ignore cleanup errors */ }
  window.ym = undefined
  window.__SHODITSA_METRIKA_INITIALIZED__ = false
  document.getElementById(METRIKA_SCRIPT_ID)?.remove()
  const cookieNames = ['_ym_uid', '_ym_d', '_ym_isad', '_ym_visorc', '_ym_metrika_enabled', '_ym_fa', '_ym_ucs']
  const hostname = window.location.hostname
  for (const name of cookieNames) {
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`
    if (hostname) document.cookie = `${name}=; Max-Age=0; path=/; domain=.${hostname}; SameSite=Lax`
  }
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith('_ym')) window.localStorage.removeItem(key)
  }
}

const pushMetric = (metric: RefactorMetric) => {
  if (typeof window === 'undefined') return
  window.__SEANS_REFACTOR_METRICS__ = window.__SEANS_REFACTOR_METRICS__ ?? []
  window.__SEANS_REFACTOR_METRICS__.push(metric)
}

const canUseMetrika = () => typeof window !== 'undefined' && storedAnalyticsConsent() === 'accepted' && typeof window.ym === 'function'
const normalizeMetrikaParams = (meta?: Record<string, unknown>) => {
  if (!meta) return undefined
  const allowedEntries = Object.entries(meta).filter(([, value]) => {
    const type = typeof value
    return value != null && (type === 'string' || type === 'number' || type === 'boolean')
  })
  if (!allowedEntries.length) return undefined
  return Object.fromEntries(allowedEntries) as Record<string, MetrikaParamValue>
}

export const initMetrikaDataLayer = () => {
  if (typeof window === 'undefined') return
  window.dataLayer = window.dataLayer ?? []
}

export const trackMetrikaGoal = (goal: string, meta?: Record<string, unknown>) => {
  if (!canUseMetrika()) return
  const params = normalizeMetrikaParams({ ...(meta ?? {}), ...consentedAnalyticsEntryParams() })
  try {
    if (params) {
      window.ym?.(METRIKA_COUNTER_ID, 'reachGoal', goal, params)
      return
    }
    window.ym?.(METRIKA_COUNTER_ID, 'reachGoal', goal)
  } catch {
    // ignore metrika transport errors
  }
}

export const trackAuthOutcome = (outcome: AnalyticsAuthIntent, meta?: Record<string, unknown>) => {
  const payload = { action: outcome, ...(meta ?? {}) }
  trackMetrikaGoal('auth_success', payload)
  trackMetrikaGoal(outcome === 'sign_up' ? 'sign_up_success' : 'sign_in_success', payload)
}

/** Only the authenticated server session can decide whether this was a new account or a login. */
export const trackConfirmedAuthOutcome = (
  confirmed: { eventId: string; action: AnalyticsAuthIntent } | null | undefined,
  meta?: Record<string, unknown>,
): AnalyticsAuthIntent | null => {
  if (!confirmed || !uuid(confirmed.eventId) || !['sign_up', 'sign_in'].includes(confirmed.action) || typeof window === 'undefined') return null
  const key = 'shoditsa:last-auth-analytics-event:v1'
  try {
    if (window.sessionStorage.getItem(key) === confirmed.eventId) return null
    window.sessionStorage.setItem(key, confirmed.eventId)
  } catch { /* auth must also work with unavailable storage */ }
  trackAuthOutcome(confirmed.action, { ...meta, outcome_source: 'server_session' })
  return confirmed.action
}

export const trackMetrikaScreen = (screen: string, meta?: Record<string, unknown>) => {
  if (!canUseMetrika()) return
  const params = normalizeMetrikaParams({ screen, ...(meta ?? {}), ...consentedAnalyticsEntryParams() })
  const virtualUrl = `${canonicalAnalyticsPath(window.location.pathname)}#${screen}`
  try {
    window.ym?.(METRIKA_COUNTER_ID, 'hit', virtualUrl, {
      title: document.title,
      ...(params ? { params } : {}),
    })
  } catch {
    // ignore metrika transport errors
  }
  trackMetrikaGoal('screen_view', params)
}

export const markAppBootStart = () => {
  if (typeof performance === 'undefined') return
  performance.mark('seans:app_boot:start')
}

export const markAppFirstRender = () => {
  if (typeof performance === 'undefined') return
  performance.mark('seans:app_boot:first_render')
  performance.measure('seans:first_render_ms', 'seans:app_boot:start', 'seans:app_boot:first_render')
  const [entry] = performance.getEntriesByName('seans:first_render_ms').slice(-1)
  if (!entry) return
  pushMetric({ name: 'first_render', value: Number(entry.duration.toFixed(2)), unit: 'ms', at: new Date().toISOString() })
}

export const markSearchDuration = (mode: string, queryLength: number, durationMs: number, resultsCount: number) => {
  pushMetric({
    name: 'search_duration',
    value: Number(durationMs.toFixed(2)),
    unit: 'ms',
    meta: { mode, queryLength, resultsCount },
    at: new Date().toISOString(),
  })
}

export const initWebVitalsObservers = () => {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return

  const supported: Array<{ type: string; metric: string; unit?: 'ms' | 'score' }> = [
    { type: 'largest-contentful-paint', metric: 'lcp' },
    { type: 'paint', metric: 'fcp' },
    { type: 'layout-shift', metric: 'cls', unit: 'score' },
  ]

  for (const item of supported) {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const last = entries[entries.length - 1]
        if (!last) return

        const value = item.metric === 'cls'
          ? entries.reduce((sum, entry: PerformanceEntry & { hadRecentInput?: boolean; value?: number }) => (
            entry.hadRecentInput ? sum : sum + (entry.value ?? 0)
          ), 0)
          : last.startTime

        pushMetric({
          name: item.metric,
          value: Number(value.toFixed(3)),
          unit: item.unit ?? 'ms',
          at: new Date().toISOString(),
        })
      })

      observer.observe({ type: item.type, buffered: true })
    } catch {
      // ignore unsupported observer entries
    }
  }
}
