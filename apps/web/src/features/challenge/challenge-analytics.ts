import { deterministicClientEventId, trackClientEvent, type EventName } from '../../app/client-events'
import { ANALYTICS_CONSENT_EVENT, storedAnalyticsConsent, trackMetrikaGoal } from '../../app/metrics'
import type { ChallengePayload } from './challenge'
import { rememberServerChallenge, serverChallengeComparison, type ChallengeSession, type ServerChallengeContext } from './server-challenge'

type ChallengeEvent = Extract<EventName, 'challenge_opened' | 'challenge_accepted' | 'challenge_started' | 'challenge_completed'>
type EventRecord = { name: ChallengeEvent; id: string; gameSessionId?: string; properties: Record<string, string | number | boolean> }
const events = new Map<string, EventRecord>()
const sent = new Set<string>()
const visits = new Map<string, string>()
let listening = false

const challengeKey = (challenge: ChallengePayload) => JSON.stringify([
  challenge.mode, challenge.date, challenge.period, challenge.difficulty ?? '', challenge.variantKey ?? '', challenge.opponentAttempts,
])
const visitId = (challenge: ChallengePayload) => {
  const key = challengeKey(challenge)
  if (!visits.has(key)) visits.set(key, crypto.randomUUID())
  return visits.get(key)!
}
const metadata = (challenge: ChallengePayload) => ({
  mode: challenge.mode, date: challenge.date, period: challenge.period,
  measurement_version: 'server-invite-v1', analytics_population: 'consent_accepted',
})

const flush = () => {
  const consent = storedAnalyticsConsent()
  if (consent === 'rejected') { events.clear(); return }
  if (consent !== 'accepted') return
  for (const event of events.values()) {
    if (sent.has(event.id)) continue
    trackClientEvent(event.name, event.properties, { eventId: event.id, ...(event.gameSessionId ? { gameSessionId: event.gameSessionId } : {}) })
    // Metrika cannot use the server's event_id dedupe, so persist its marker only
    // after explicit analytics consent. Never store sender information.
    const marker = `shoditsa:challenge-goal:${event.id}`
    let alreadySent = false
    try { alreadySent = window.sessionStorage.getItem(marker) === '1' } catch { /* memory dedupe below */ }
    if (!alreadySent) {
      trackMetrikaGoal(event.name, event.properties)
      try { window.sessionStorage.setItem(marker, '1') } catch { /* optional analytics storage */ }
    }
    sent.add(event.id)
  }
  events.clear()
}

const record = (event: EventRecord) => {
  if (sent.has(event.id) || storedAnalyticsConsent() === 'rejected') return
  // Do not call the shared disk-backed event queue before analytics consent.
  // Pending invitation events exist only in memory and disappear with the page.
  events.set(event.id, event)
  if (!listening && typeof window !== 'undefined') {
    // setAnalyticsConsent dispatches before initializing the Metrika stub.
    // Wait for that synchronous setup or the first consented goals are lost.
    window.addEventListener(ANALYTICS_CONSENT_EVENT, () => queueMicrotask(flush))
    listening = true
  }
  flush()
}

export const trackChallengeOpened = (challenge: ChallengePayload) => {
  const id = visitId(challenge)
  record({ name: 'challenge_opened', id: deterministicClientEventId(id, 'challenge_opened'), properties: { ...metadata(challenge), invitation_visit_id: id } })
}

export const trackChallengeAccepted = (challenge: ChallengePayload) => {
  const id = visitId(challenge)
  record({ name: 'challenge_accepted', id: deterministicClientEventId(id, 'challenge_accepted'), properties: { ...metadata(challenge), invitation_visit_id: id } })
}

/** Call only in a successful api.start callback, never on the accept button. */
export const confirmServerChallengeStart = (challenge: ChallengePayload, session: ChallengeSession) => {
  const context = rememberServerChallenge(challenge, session)
  if (!context || (session.status !== 'playing' && session.status !== 'final_choice')) return context
  record({
    name: 'challenge_started', id: deterministicClientEventId(session.id, 'challenge_started'), gameSessionId: session.id,
    properties: { ...metadata(context.challenge), invitation_visit_id: visitId(challenge), kind: session.kind, state: session.attemptsCount > 0 ? 'resumed' : 'ready' },
  })
  return context
}

/** A pre-existing final result is comparable, but is not a new invite completion. */
export const observeServerChallengeCompletion = (session: ChallengeSession, context: ServerChallengeContext | null) => {
  const comparison = serverChallengeComparison(session, context)
  if (!comparison || !context?.joinedWhilePlaying) return
  record({
    name: 'challenge_completed', id: deterministicClientEventId(session.id, 'challenge_completed'), gameSessionId: session.id,
    properties: { ...metadata(context.challenge), outcome: comparison.challengeOutcome, result: comparison.playerAttempts, kind: session.kind },
  })
}
