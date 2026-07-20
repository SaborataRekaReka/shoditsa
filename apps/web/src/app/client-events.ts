export type EventName = 'page_view' | 'mode_opened' | 'client_error' | 'api_error' | 'network_offline' | 'network_online' | 'report_form_opened' | 'report_submit_failed'
  | 'club_screen_view' | 'club_interest_clicked' | 'archive_paywall_view' | 'archive_paywall_clicked'
  | 'checkout_started' | 'checkout_returned' | 'purchase_succeeded' | 'purchase_failed'
  | 'club_free_play_started' | 'pack_opened' | 'pack_paywall_view'
  | 'ticket_earned' | 'ticket_spent' | 'insufficient_tickets_view' | 'ticket_offer_view' | 'ticket_offer_clicked'
  | 'ticket_bundle_purchased' | 'period_unlocked' | 'free_play_started' | 'danetki_room_started'
  | 'danetki_room_completed' | 'danetki_limit_reached' | 'club_paywall_view'
type QueuedEvent = {
  eventId: string
  eventName: EventName
  occurredAt: string
  route?: string
  appVersion?: string
  requestId?: string
  errorCode?: string
  stackFingerprint?: string
  gameSessionId?: string | null
  properties?: Record<string, string | number | boolean | null>
}
type EventProperty = string | number | boolean | null

const STORAGE_KEY = 'shoditsa:client-events:v1'
const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
let flushing = false

const read = (): QueuedEvent[] => {
  try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(parsed) ? parsed.slice(-100) : [] } catch { return [] }
}
const write = (events: QueuedEvent[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-100)))
const fingerprint = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return `fnv1a:${(hash >>> 0).toString(16)}`
}

export const trackClientEvent = (eventName: EventName, properties: Record<string, unknown> = {}, context: Partial<Pick<QueuedEvent, 'requestId' | 'errorCode' | 'gameSessionId' | 'stackFingerprint'>> = {}) => {
  const safeProperties = Object.fromEntries(Object.entries(properties).flatMap(([key, value]) => {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [[key, value as EventProperty]]
    return []
  }))
  const event: QueuedEvent = {
    eventId: crypto.randomUUID(), eventName, occurredAt: new Date().toISOString(), route: window.location.pathname,
    appVersion: String(import.meta.env.VITE_APP_VERSION || 'dev'), properties: safeProperties, ...context,
  }
  if (eventName === 'client_error' && !event.stackFingerprint) event.stackFingerprint = fingerprint(String(safeProperties.message ?? 'client_error'))
  write([...read(), event]); void flushClientEvents()
}

export const flushClientEvents = async () => {
  if (flushing || !navigator.onLine) return
  const events = read().slice(0, 50); if (!events.length) return
  flushing = true
  try {
    const response = await fetch(`${API_BASE}/client-events/batch`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ events }) })
    if (response.ok) {
      const sent = new Set(events.map((event) => event.eventId))
      write(read().filter((entry) => !sent.has(entry.eventId)))
    }
  } catch { /* queue remains for the next authenticated/online flush */ }
  finally { flushing = false }
}

export const initClientEvents = () => {
  trackClientEvent('page_view', { route: window.location.pathname })
  addEventListener('online', () => { trackClientEvent('network_online'); void flushClientEvents() })
  addEventListener('offline', () => trackClientEvent('network_offline'))
  addEventListener('error', (event) => trackClientEvent('client_error', { message: String(event.message || 'window_error').slice(0, 500) }))
  addEventListener('unhandledrejection', (event) => trackClientEvent('client_error', { message: String(event.reason instanceof Error ? event.reason.message : event.reason).slice(0, 500) }))
  setInterval(() => void flushClientEvents(), 10_000)
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void flushClientEvents() })
}
