import { deterministicClientEventId, trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { offerObservationScope, useVisibleImpression } from '../../app/visible-impression'

/** General result CTA. The gated diagnosis bonus keeps its own, separate events. */
export function useResultRegistrationTracking({ sessionId, mode, enabled, properties = {} }: {
  sessionId?: string
  mode: string
  enabled: boolean
  properties?: Record<string, unknown>
}) {
  const scope = offerObservationScope(`result-registration:${mode}`, sessionId)
  const viewId = deterministicClientEventId(scope, 'result_registration_offer_view')
  const payload = { ...properties, mode, placement: 'result', measurement_version: 'visible-v2' }
  const ref = useVisibleImpression(enabled ? viewId : null, () => {
    if (!enabled) return
    trackClientEvent('result_registration_offer_view', payload, { eventId: viewId, ...(sessionId ? { gameSessionId: sessionId } : {}) })
    trackMetrikaGoal('result_registration_offer_view', payload)
  })
  const trackClick = () => {
    if (!enabled) return
    trackClientEvent('result_registration_offer_clicked', payload, {
      eventId: deterministicClientEventId(scope, 'result_registration_offer_clicked'),
      ...(sessionId ? { gameSessionId: sessionId } : {}),
    })
    trackMetrikaGoal('result_registration_offer_clicked', payload)
  }
  return { ref, trackClick }
}
