import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimVisibleImpression, observeVisibleOnce, offerObservationScope } from './visible-impression'

describe('visible CTA impressions', () => {
  const target = {} as HTMLElement
  let callback: IntersectionObserverCallback
  let disconnect: ReturnType<typeof vi.fn>
  let observedDocument: EventTarget & { visibilityState: string }
  let storage: Map<string, string>
  let consent: string | null

  const intersection = (ratio: number, isIntersecting = true) => callback([
    { target, intersectionRatio: ratio, isIntersecting } as unknown as IntersectionObserverEntry,
  ], {} as IntersectionObserver)

  beforeEach(() => {
    observedDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    storage = new Map()
    consent = 'accepted'
    disconnect = vi.fn()
    vi.stubGlobal('document', observedDocument)
    vi.stubGlobal('window', { localStorage: { getItem: () => consent } })
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal('IntersectionObserver', class {
      disconnect = disconnect
      observe = vi.fn()
      constructor(handler: IntersectionObserverCallback, options: IntersectionObserverInit) {
        callback = handler
        expect(options.threshold).toBe(0.25)
      }
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('ignores mount and sub-threshold intersections, then records one visible exposure', () => {
    const visible = vi.fn()
    observeVisibleOnce(target, visible)
    expect(visible).not.toHaveBeenCalled()
    intersection(0.24)
    intersection(0.7, false)
    expect(visible).not.toHaveBeenCalled()
    intersection(0.25)
    intersection(1)
    expect(visible).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('waits until an intersecting offer is in a visible tab', () => {
    observedDocument.visibilityState = 'hidden'
    const visible = vi.fn()
    observeVisibleOnce(target, visible)
    intersection(1)
    expect(visible).not.toHaveBeenCalled()
    observedDocument.visibilityState = 'visible'
    observedDocument.dispatchEvent(new Event('visibilitychange'))
    expect(visible).toHaveBeenCalledOnce()
  })

  it('does not report a removed offer or invent visibility without the observer API', () => {
    const visible = vi.fn()
    const cleanup = observeVisibleOnce(target, visible)
    cleanup()
    intersection(1)
    expect(visible).not.toHaveBeenCalled()
    vi.stubGlobal('IntersectionObserver', undefined)
    observeVisibleOnce(target, visible)()
    expect(visible).not.toHaveBeenCalled()
  })

  it('deduplicates an exposure by event ID across remounts and previously stored impressions', () => {
    const id = crypto.randomUUID()
    expect(claimVisibleImpression(id)).toBe(true)
    expect(claimVisibleImpression(id)).toBe(false)
    const storedId = crypto.randomUUID()
    storage.set('shoditsa:visible-offers:v1', JSON.stringify([storedId]))
    expect(claimVisibleImpression(storedId)).toBe(false)
  })

  it('gives result placements stable session identities and separate catalog identities within a tab', () => {
    expect(offerObservationScope('result', 'session-a')).toBe(offerObservationScope('result', 'session-a'))
    expect(offerObservationScope('result', 'session-a')).not.toBe(offerObservationScope('investigation', 'session-a'))
    const catalog = offerObservationScope('catalog', undefined, '/danetki')
    expect(catalog).toBe(offerObservationScope('catalog', undefined, '/danetki'))
    expect(catalog).not.toBe(offerObservationScope('catalog', undefined, '/danetki/novye'))
    const stored = storage.get('shoditsa:offer-tab:v1')!
    expect(stored).not.toContain('/danetki')
    expect(stored).not.toContain('session-a')
  })

  it.each([null, 'rejected'])('keeps observation markers in memory without consent (%s)', (value) => {
    consent = value
    const scope = offerObservationScope('catalog', undefined, '/danetki')
    expect(offerObservationScope('catalog', undefined, '/danetki')).toBe(scope)
    const id = crypto.randomUUID()
    expect(claimVisibleImpression(id)).toBe(true)
    expect(claimVisibleImpression(id)).toBe(false)
    expect(storage.size).toBe(0)
  })
})
