type RefactorMetric = {
  name: string
  value: number
  unit: 'ms' | 'score'
  meta?: Record<string, string | number | boolean>
  at: string
}

declare global {
  interface Window {
    __SEANS_REFACTOR_METRICS__?: RefactorMetric[]
  }
}

const pushMetric = (metric: RefactorMetric) => {
  if (typeof window === 'undefined') return
  window.__SEANS_REFACTOR_METRICS__ = window.__SEANS_REFACTOR_METRICS__ ?? []
  window.__SEANS_REFACTOR_METRICS__.push(metric)
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
