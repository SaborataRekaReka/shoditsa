import { FormatRegistry } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'
import { ClientEventSchema } from '../src/admin-schemas.js'

FormatRegistry.Set('uuid', (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
FormatRegistry.Set('date-time', (value) => !Number.isNaN(Date.parse(value)))

describe('growth client event contract', () => {
  it.each(['challenge_opened', 'challenge_accepted', 'challenge_started', 'challenge_completed', 'result_registration_offer_view', 'result_registration_offer_clicked'])('accepts %s without weakening the event whitelist', (eventName) => {
    const event = { eventId: crypto.randomUUID(), occurredAt: '2026-09-11T10:00:00.000Z', eventName, gameSessionId: crypto.randomUUID() }
    expect(Value.Check(ClientEventSchema, event)).toBe(true)
    expect(Value.Check(ClientEventSchema, { ...event, eventName: 'unknown_event' })).toBe(false)
  })
})
