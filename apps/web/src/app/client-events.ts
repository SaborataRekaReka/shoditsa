import { ANALYTICS_CONSENT_EVENT, canonicalAnalyticsPath, consentedAnalyticsEntryParams, storedAnalyticsConsent } from './metrics'

export type EventName =
  | 'page_view'
  | 'mode_opened'
  | 'game_session_start'
  | 'game_session_complete'
  | 'game_next_clicked'
  | 'game_next_start'
  | 'client_error'
  | 'api_error'
  | 'network_offline'
  | 'network_online'
  | 'report_form_opened'
  | 'report_submit_failed'
  | 'connections_started'
  | 'connections_guess_submitted'
  | 'connections_one_away'
  | 'connections_group_solved'
  | 'connections_hint_used'
  | 'connections_completed'
  | 'connections_shared'
  | 'connections_report_submitted'
  | 'club_screen_view' | 'club_interest_clicked' | 'archive_paywall_view' | 'archive_paywall_clicked'
  | 'checkout_started' | 'checkout_returned' | 'purchase_succeeded' | 'purchase_failed'
  | 'club_free_play_started' | 'pack_opened' | 'pack_paywall_view'
  | 'special_locked_view' | 'special_club_cta_clicked'
  | 'ticket_earned' | 'ticket_spent' | 'insufficient_tickets_view' | 'ticket_offer_view' | 'ticket_offer_clicked'
  | 'ticket_bundle_purchased' | 'period_unlocked' | 'free_play_started' | 'danetki_room_started'
  | 'friends_room_created' | 'friends_room_started' | 'friends_room_free_block_started' | 'friends_room_block_completed'
  | 'friends_room_intermission_view' | 'friends_room_continue_clicked' | 'friends_room_continued'
  | 'friends_room_ended_at_intermission' | 'friends_room_guest_joined' | 'friends_room_guest_registered'
  | 'danetki_room_completed' | 'danetki_limit_reached' | 'club_paywall_view'
  | 'danetki_landing_view' | 'danetki_start_clicked' | 'danetki_first_question'
  | 'danetki_catalog_view' | 'danetki_story_view' | 'danetki_story_answer_opened' | 'danetki_catalog_play_clicked'
  | 'danetki_registration_offer_view' | 'danetki_registration_offer_clicked' | 'danetki_registration_succeeded'
  | 'danetki_result_view' | 'danetki_cross_game_offer_view' | 'danetki_cross_game_clicked'
  | 'final_choice_shown' | 'final_choice_candidate_selected' | 'final_choice_submitted'
  | 'final_choice_reveal_opened' | 'final_choice_reveal_cancelled' | 'final_choice_revealed' | 'final_choice_timed_out'
  | 'final_choice_unavailable'
  | 'territory_landing_view' | 'territory_room_created' | 'territory_room_started'
  | 'territory_duel_completed' | 'territory_match_completed' | 'territory_rematch_clicked' | 'territory_rematch_started'
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
const ATTRIBUTION_PROPERTIES = new Set(['acquisition_id', 'entry_path', 'entry_source', 'entry_search_engine', 'entry_referrer_host'])
const CLIENT_EVENT_SESSION_STARTED_AT = Date.now()
let flushing = false

const read = (): QueuedEvent[] => {
  try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(parsed) ? parsed.slice(-100) : [] } catch { return [] }
}
const write = (events: QueuedEvent[]) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-100))) } catch { /* analytics must never block gameplay */ }
}
export const clearQueuedClientEvents = () => write([])
export const purgeQueuedClientEventAttribution = () => write(read().map((event) => ({
  ...event,
  properties: {
    ...Object.fromEntries(Object.entries(event.properties ?? {}).filter(([key]) => !ATTRIBUTION_PROPERTIES.has(key))),
    analytics_consent: 'rejected',
  },
})))

/**
 * Events created while the consent banner is still open stay in the browser.
 * If the visitor later accepts analytics, enrich those already queued events
 * before their first upload. Rejection still strips all acquisition fields.
 */
export const backfillQueuedClientEventAttribution = () => {
  const attribution = consentedAnalyticsEntryParams()
  if (!Object.keys(attribution).length) return
  write(read().map((event) => {
    const occurredAt = Date.parse(event.occurredAt)
    if (!Number.isFinite(occurredAt) || occurredAt < CLIENT_EVENT_SESSION_STARTED_AT) return event
    return {
      ...event,
      properties: { ...(event.properties ?? {}), analytics_consent: 'accepted', ...attribution },
    }
  }))
}

const safeProperty = (key: string, value: unknown): EventProperty | undefined => {
  if (key.length > 80) return undefined
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  if (/(?:url|path|route)$/i.test(key) && value.startsWith('/')) {
    try { return canonicalAnalyticsPath(new URL(value, window.location.origin).pathname) } catch { return '/other' }
  }
  return value.slice(0, 500)
}
const fingerprint = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return `fnv1a:${(hash >>> 0).toString(16)}`
}

/**
 * Builds a stable UUID-shaped identity from a server-owned UUID and an event
 * name. The database already treats eventId as an idempotency key, so a page
 * reload can safely retry a lifecycle event without creating another row.
 * This is not a security primitive; the server session UUID remains in the
 * typed gameSessionId field and is not copied into event properties.
 */
export const deterministicClientEventId = (namespace: string, eventName: EventName) => {
  const source = `${namespace}:${eventName}`
  const words = [2166136261, 2166136261 ^ 0x9e3779b9, 2166136261 ^ 0x85ebca6b, 2166136261 ^ 0xc2b2ae35]
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    for (let word = 0; word < words.length; word += 1) {
      words[word] = Math.imul(words[word] ^ (code + word * 31), 16777619)
    }
  }
  const hex = words.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('').split('')
  hex[12] = '5'
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  const compact = hex.join('')
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
}

export const trackClientEvent = (eventName: EventName, properties: Record<string, unknown> = {}, context: Partial<Pick<QueuedEvent, 'eventId' | 'requestId' | 'errorCode' | 'gameSessionId' | 'stackFingerprint'>> = {}) => {
  const callerProperties = Object.fromEntries(Object.entries(properties).filter(([key]) => !ATTRIBUTION_PROPERTIES.has(key)))
  const consent = storedAnalyticsConsent()
  const attributedProperties = {
    ...callerProperties,
    analytics_consent: consent ?? 'pending',
    ...consentedAnalyticsEntryParams(),
  }
  const safeProperties = Object.fromEntries(Object.entries(attributedProperties).flatMap(([key, value]) => {
    const safeValue = safeProperty(key, value)
    return safeValue === undefined ? [] : [[key, safeValue]]
  }))
  const event: QueuedEvent = {
    eventId: crypto.randomUUID(), eventName, occurredAt: new Date().toISOString(), route: canonicalAnalyticsPath(window.location.pathname),
    appVersion: String(import.meta.env.VITE_APP_VERSION || 'dev').slice(0, 80), properties: safeProperties,
    ...context,
    ...(context.requestId ? { requestId: context.requestId.slice(0, 120) } : {}),
    ...(context.errorCode ? { errorCode: context.errorCode.slice(0, 120) } : {}),
    ...(context.stackFingerprint ? { stackFingerprint: context.stackFingerprint.slice(0, 160) } : {}),
  }
  if (eventName === 'client_error' && !event.stackFingerprint) event.stackFingerprint = fingerprint(String(safeProperties.message ?? 'client_error'))
  const queued = read()
  write(queued.some((entry) => entry.eventId === event.eventId) ? queued : [...queued, event])
  void flushClientEvents()
}

export const flushClientEvents = async () => {
  if (flushing || !navigator.onLine) return
  const consent = storedAnalyticsConsent()
  // Do not permanently lose a search entrance while the visitor is still
  // deciding. Nothing leaves the browser until the choice is explicit.
  if (consent === null) return
  if (consent === 'rejected') purgeQueuedClientEventAttribution()
  const events = read().slice(0, 50); if (!events.length) return
  flushing = true
  try {
    const response = await fetch(`${API_BASE}/client-events/batch`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ events }) })
    if (response.ok || [400, 413, 422].includes(response.status)) {
      const sent = new Set(events.map((event) => event.eventId))
      write(read().filter((entry) => !sent.has(entry.eventId)))
    }
  } catch { /* queue remains for the next authenticated/online flush */ }
  finally { flushing = false }
}

export const trackConsentedLanding = () => {
  const acquisitionId = consentedAnalyticsEntryParams().acquisition_id
  if (typeof acquisitionId !== 'string' || !acquisitionId) return
  trackClientEvent('page_view', { consent_granted: true }, {
    eventId: deterministicClientEventId(acquisitionId, 'page_view'),
  })
}

export const initClientEvents = () => {
  trackClientEvent('page_view')
  window.addEventListener(ANALYTICS_CONSENT_EVENT, (event) => {
    const consent = (event as CustomEvent<{ consent?: string }>).detail?.consent
    if (consent === 'accepted') {
      backfillQueuedClientEventAttribution()
      trackConsentedLanding()
      return
    }
    if (consent === 'rejected') {
      purgeQueuedClientEventAttribution()
      void flushClientEvents()
    }
  })
  addEventListener('online', () => { trackClientEvent('network_online'); void flushClientEvents() })
  addEventListener('offline', () => trackClientEvent('network_offline'))
  addEventListener('error', (event) => trackClientEvent('client_error', { message: String(event.message || 'window_error').slice(0, 500) }))
  addEventListener('unhandledrejection', (event) => trackClientEvent('client_error', { message: String(event.reason instanceof Error ? event.reason.message : event.reason).slice(0, 500) }))
  setInterval(() => void flushClientEvents(), 10_000)
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void flushClientEvents() })
}
