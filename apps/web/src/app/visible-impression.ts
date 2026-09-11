import { useEffect, useRef } from 'react'
import { storedAnalyticsConsent } from './metrics'

const TAB_SCOPE_KEY = 'shoditsa:offer-tab:v1'
const SEEN_KEY = 'shoditsa:visible-offers:v1'
const seenInDocument = new Set<string>()
let fallbackTabId: string | undefined
const canPersistObservation = () => {
  try { return storedAnalyticsConsent() === 'accepted' } catch { return false }
}

/** No account, acquisition or URL is persisted: this only deduplicates CTA exposure in a tab. */
export const offerObservationScope = (placement: string, sessionId?: string, path = '') => {
  if (sessionId) return `session:${sessionId}:${placement}`
  fallbackTabId ??= crypto.randomUUID()
  const day = new Date().toISOString().slice(0, 10)
  let tabId = fallbackTabId
  try {
    if (canPersistObservation()) {
      const stored: unknown = JSON.parse(sessionStorage.getItem(TAB_SCOPE_KEY) || 'null')
      if (stored && typeof stored === 'object' && 'day' in stored && stored.day === day && 'id' in stored && typeof stored.id === 'string') {
        tabId = stored.id
      } else {
        sessionStorage.setItem(TAB_SCOPE_KEY, JSON.stringify({ day, id: tabId }))
      }
    }
  } catch { /* blocked storage must not affect the interface */ }
  return `tab:${tabId}:${day}:${placement}:${path}`
}

export const claimVisibleImpression = (eventId: string) => {
  if (seenInDocument.has(eventId)) return false
  let stored: string[] = []
  try {
    if (canPersistObservation()) {
      const value: unknown = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]')
      if (Array.isArray(value)) stored = value.filter((item): item is string => typeof item === 'string').slice(-250)
    }
  } catch { /* use in-document deduplication */ }
  seenInDocument.add(eventId)
  if (seenInDocument.size > 500) seenInDocument.delete(seenInDocument.values().next().value!)
  if (stored.includes(eventId)) return false
  try {
    if (canPersistObservation()) sessionStorage.setItem(SEEN_KEY, JSON.stringify([...stored, eventId].slice(-250)))
  } catch { /* optional cache */ }
  return true
}

/** A mounted or offscreen offer is not an impression. Hidden tabs do not qualify. */
export const observeVisibleOnce = (target: HTMLElement, onVisible: () => void) => {
  if (typeof IntersectionObserver === 'undefined') return () => {}
  let intersecting = false
  let finished = false
  const cleanup = () => {
    finished = true
    observer.disconnect()
    document.removeEventListener('visibilitychange', check)
  }
  const check = () => {
    if (finished || !intersecting || document.visibilityState === 'hidden') return
    cleanup()
    onVisible()
  }
  const observer = new IntersectionObserver((entries) => {
    const entry = entries.find((item) => item.target === target)
    if (!entry) return
    intersecting = entry.isIntersecting && entry.intersectionRatio >= 0.25
    check()
  }, { threshold: 0.25 })
  document.addEventListener('visibilitychange', check)
  observer.observe(target)
  return cleanup
}

export const useVisibleImpression = <T extends HTMLElement = HTMLElement>(eventId: string | null, onVisible: () => void) => {
  const ref = useRef<T>(null)
  const callback = useRef(onVisible)
  callback.current = onVisible
  useEffect(() => {
    if (!eventId || !ref.current) return
    return observeVisibleOnce(ref.current, () => {
      if (claimVisibleImpression(eventId)) callback.current()
    })
  }, [eventId])
  return ref
}
