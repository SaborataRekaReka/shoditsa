import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChallengePayload } from './challenge'
import type { ChallengeSession } from './server-challenge'

const mock = vi.hoisted(() => ({ consent: null as 'accepted' | 'rejected' | null, trackClientEvent: vi.fn(), trackMetrikaGoal: vi.fn() }))
vi.mock('../../app/client-events', () => ({ deterministicClientEventId: (id: string, event: string) => `${id}:${event}`, trackClientEvent: mock.trackClientEvent }))
vi.mock('../../app/metrics', () => ({ ANALYTICS_CONSENT_EVENT: 'consent-changed', storedAnalyticsConsent: () => mock.consent, trackMetrikaGoal: mock.trackMetrikaGoal }))

const challenge: ChallengePayload = { mode: 'diagnosis', date: '2026-09-11', period: 'all', opponentAttempts: 4, from: 'DO-NOT-TRACK-SENDER' }
const session = (overrides: Partial<ChallengeSession> = {}): ChallengeSession => ({
  id: crypto.randomUUID(), kind: 'daily', mode: 'diagnosis', packId: null, period: 'all', difficulty: null,
  variantKey: '-', puzzleDate: '2026-09-11', status: 'playing', completionType: null, attemptsCount: 0, maxAttempts: 10, ...overrides,
})
const values = new Map<string, string>()
let onConsentChange: () => void

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  values.clear()
  mock.consent = null
  onConsentChange = () => {}
  vi.stubGlobal('window', {
    sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) },
    addEventListener: (_name: string, callback: () => void) => { onConsentChange = callback },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('consented recipient invitation funnel', () => {
  it('keeps undecided invitation events in memory, then links open and accept after consent', async () => {
    const analytics = await import('./challenge-analytics')
    analytics.trackChallengeOpened(challenge)
    analytics.trackChallengeOpened(challenge)
    analytics.trackChallengeAccepted(challenge)
    expect(mock.trackClientEvent).not.toHaveBeenCalled()
    expect(mock.trackMetrikaGoal).not.toHaveBeenCalled()
    expect(values.size).toBe(0)
    mock.consent = 'accepted'
    onConsentChange()
    await Promise.resolve()
    expect(mock.trackClientEvent).toHaveBeenCalledTimes(2)
    expect(mock.trackClientEvent.mock.calls[0]?.[1].invitation_visit_id).toBe(mock.trackClientEvent.mock.calls[1]?.[1].invitation_visit_id)
    expect(JSON.stringify(mock.trackClientEvent.mock.calls)).not.toContain('DO-NOT-TRACK-SENDER')
  })

  it('discards pending analytics on rejection while the functional game still starts', async () => {
    const analytics = await import('./challenge-analytics')
    analytics.trackChallengeOpened(challenge)
    mock.consent = 'rejected'
    onConsentChange()
    await Promise.resolve()
    const context = analytics.confirmServerChallengeStart(challenge, session())
    expect(context).not.toBeNull()
    expect(mock.trackClientEvent).not.toHaveBeenCalled()
    expect(mock.trackMetrikaGoal).not.toHaveBeenCalled()
    expect([...values.keys()]).toEqual(['shoditsa:challenge-game:v1'])
    expect([...values.values()].join('')).not.toContain('DO-NOT-TRACK-SENDER')
  })

  it('records intent separately from a successful matching server start and final completion', async () => {
    mock.consent = 'accepted'
    const analytics = await import('./challenge-analytics')
    analytics.trackChallengeOpened(challenge)
    analytics.trackChallengeAccepted(challenge)
    expect(mock.trackClientEvent.mock.calls.map((call) => call[0])).toEqual(['challenge_opened', 'challenge_accepted'])
    expect(analytics.confirmServerChallengeStart(challenge, session({ kind: 'free_play' }))).toBeNull()
    const own = session()
    const context = analytics.confirmServerChallengeStart(challenge, own)
    analytics.observeServerChallengeCompletion(own, context)
    expect(mock.trackClientEvent.mock.calls.map((call) => call[0])).toEqual(['challenge_opened', 'challenge_accepted', 'challenge_started'])
    const final = { ...own, status: 'won' as const, attemptsCount: 3 }
    analytics.observeServerChallengeCompletion(final, context)
    analytics.observeServerChallengeCompletion(final, context)
    expect(mock.trackClientEvent.mock.calls.filter((call) => call[0] === 'challenge_completed')).toHaveLength(1)
    expect(mock.trackClientEvent).toHaveBeenCalledWith('challenge_completed', expect.objectContaining({ result: 3, outcome: 'won' }), { eventId: `${own.id}:challenge_completed`, gameSessionId: own.id })
    expect(JSON.stringify(mock.trackMetrikaGoal.mock.calls)).not.toContain(own.id)
  })

  it('does not claim a start or completion when accepting an already completed puzzle', async () => {
    mock.consent = 'accepted'
    const analytics = await import('./challenge-analytics')
    const final = session({ status: 'won', attemptsCount: 2 })
    const context = analytics.confirmServerChallengeStart(challenge, final)
    analytics.observeServerChallengeCompletion(final, context)
    expect(context?.joinedWhilePlaying).toBe(false)
    expect(mock.trackClientEvent).not.toHaveBeenCalled()
  })

  it('retries completion after reload with the same first-party id but not a second Metrika goal', async () => {
    mock.consent = 'accepted'
    let analytics = await import('./challenge-analytics')
    const own = session()
    const context = analytics.confirmServerChallengeStart(challenge, own)
    const final = { ...own, status: 'lost' as const, attemptsCount: 10 }
    analytics.observeServerChallengeCompletion(final, context)
    vi.resetModules()
    analytics = await import('./challenge-analytics')
    const { readServerChallenge } = await import('./server-challenge')
    analytics.observeServerChallengeCompletion(final, readServerChallenge(final))
    const completions = mock.trackClientEvent.mock.calls.filter((call) => call[0] === 'challenge_completed')
    expect(completions).toHaveLength(2)
    expect(completions[0]?.[2]).toEqual(completions[1]?.[2])
    expect(mock.trackMetrikaGoal.mock.calls.filter((call) => call[0] === 'challenge_completed')).toHaveLength(1)
  })
})
