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
export const ANALYTICS_CONSENT_STORAGE_KEY = 'shoditsa:analytics-consent:v1'
export type AnalyticsConsent = 'accepted' | 'rejected'

declare global {
  interface Window {
    __SEANS_REFACTOR_METRICS__?: RefactorMetric[]
    ym?: (...args: unknown[]) => void
    dataLayer?: unknown[]
    __SHODITSA_METRIKA_INITIALIZED__?: boolean
  }
}

type MetrikaStub = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number }

export const storedAnalyticsConsent = (): AnalyticsConsent | null => {
  if (typeof window === 'undefined') return null
  const value = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)
  return value === 'accepted' || value === 'rejected' ? value : null
}

export const initMetrika = () => {
  if (typeof window === 'undefined' || window.__SHODITSA_METRIKA_INITIALIZED__) return
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

  stub(METRIKA_COUNTER_ID, 'init', {
    ssr: true,
    webvisor: false,
    clickmap: true,
    ecommerce: 'dataLayer',
    referrer: document.referrer,
    url: window.location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  })
}

export const initMetrikaFromStoredConsent = () => {
  if (storedAnalyticsConsent() === 'accepted') initMetrika()
}

export const setAnalyticsConsent = (consent: AnalyticsConsent) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, consent)
  if (consent === 'accepted') {
    initMetrika()
    return
  }

  try { window.ym?.(METRIKA_COUNTER_ID, 'destruct') } catch { /* ignore cleanup errors */ }
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

const canUseMetrika = () => typeof window !== 'undefined' && typeof window.ym === 'function'
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
  const params = normalizeMetrikaParams(meta)
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

export const trackMetrikaScreen = (screen: string, meta?: Record<string, unknown>) => {
  if (!canUseMetrika()) return
  const params = normalizeMetrikaParams({ screen, ...(meta ?? {}) })
  const virtualUrl = `${window.location.pathname}#${screen}`
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
