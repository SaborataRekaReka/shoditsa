import { beforeEach, describe, expect, it, vi } from 'vitest'

const spies = vi.hoisted(() => ({
  trackClientEvent: vi.fn(), trackMetrikaGoal: vi.fn(),
  ref: { current: null },
  observe: vi.fn(),
}))

vi.mock('../../app/client-events', () => ({
  trackClientEvent: spies.trackClientEvent,
  deterministicClientEventId: (scope: string, name: string) => `${scope}:${name}`,
}))
vi.mock('../../app/metrics', () => ({ trackMetrikaGoal: spies.trackMetrikaGoal }))
vi.mock('../../app/visible-impression', () => ({
  offerObservationScope: (placement: string, sessionId?: string) => `${sessionId ?? 'anonymous-tab'}:${placement}`,
  useVisibleImpression: (eventId: string | null, onVisible: () => void) => {
    spies.observe(eventId, onVisible)
    return spies.ref
  },
}))

import { useResultRegistrationTracking } from './use-result-registration-tracking'

describe('result registration offer bridge', () => {
  beforeEach(() => vi.clearAllMocks())
  const notifyVisible = () => (spies.observe.mock.calls.at(-1)![1] as () => void)()

  it('emits the visible impression to both sinks only after the visibility helper qualifies it', () => {
    const result = useResultRegistrationTracking({
      sessionId: 'session-a', mode: 'diagnosis', enabled: true,
      properties: { outcome: 'won', mode: 'wrong', placement: 'wrong', measurement_version: 'mount' },
    })
    expect(result.ref).toBe(spies.ref)
    expect(spies.observe.mock.calls[0][0]).toBe('session-a:result-registration:diagnosis:result_registration_offer_view')
    expect(spies.trackClientEvent).not.toHaveBeenCalled()
    expect(spies.trackMetrikaGoal).not.toHaveBeenCalled()
    notifyVisible()
    const payload = { outcome: 'won', mode: 'diagnosis', placement: 'result', measurement_version: 'visible-v2' }
    expect(spies.trackClientEvent).toHaveBeenCalledExactlyOnceWith('result_registration_offer_view', payload, {
      eventId: spies.observe.mock.calls[0][0], gameSessionId: 'session-a',
    })
    expect(spies.trackMetrikaGoal).toHaveBeenCalledExactlyOnceWith('result_registration_offer_view', payload)
  })

  it('bridges the click with its own stable identity and does not invent an impression', () => {
    const { trackClick } = useResultRegistrationTracking({ sessionId: 'session-b', mode: 'animal', enabled: true })
    trackClick()
    const payload = { mode: 'animal', placement: 'result', measurement_version: 'visible-v2' }
    expect(spies.trackClientEvent).toHaveBeenCalledExactlyOnceWith('result_registration_offer_clicked', payload, {
      eventId: 'session-b:result-registration:animal:result_registration_offer_clicked', gameSessionId: 'session-b',
    })
    expect(spies.trackMetrikaGoal).toHaveBeenCalledExactlyOnceWith('result_registration_offer_clicked', payload)
  })

  it('disables observation and both sinks, including a callback already queued while the offer was enabled', () => {
    const { trackClick } = useResultRegistrationTracking({ sessionId: 'session-c', mode: 'diagnosis', enabled: false })
    expect(spies.observe.mock.calls[0][0]).toBeNull()
    notifyVisible()
    trackClick()
    expect(spies.trackClientEvent).not.toHaveBeenCalled()
    expect(spies.trackMetrikaGoal).not.toHaveBeenCalled()
  })

  it('does not fabricate a game session id for result surfaces without one', () => {
    const { trackClick } = useResultRegistrationTracking({ mode: 'connections', enabled: true })
    notifyVisible()
    trackClick()
    expect(spies.trackClientEvent).toHaveBeenCalledTimes(2)
    expect(spies.trackMetrikaGoal).toHaveBeenCalledTimes(2)
    for (const [, , context] of spies.trackClientEvent.mock.calls) {
      expect(context).toHaveProperty('eventId')
      expect(context).not.toHaveProperty('gameSessionId')
    }
  })
})
