import { trackClientEvent, type EventName } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'

export type TerritoryAnalyticsEvent = Extract<EventName,
  | 'territory_landing_view'
  | 'territory_room_created'
  | 'territory_room_started'
  | 'territory_duel_completed'
  | 'territory_match_completed'
  | 'territory_rematch_clicked'
  | 'territory_rematch_started'
>

const metrikaPayload = (properties: Record<string, unknown>) => Object.fromEntries(
  Object.entries(properties).filter(([key]) => !['roomId', 'matchId', 'duelId'].includes(key)),
)

export const trackTerritoryEvent = (
  eventName: TerritoryAnalyticsEvent,
  properties: Record<string, unknown> = {},
  context: { eventId?: string } = {},
) => {
  const payload = { mode: 'territory', ...properties }
  trackClientEvent(eventName, payload, context)
  trackMetrikaGoal(eventName, metrikaPayload(payload))
}
