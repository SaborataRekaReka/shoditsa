import { Value } from '@sinclair/typebox/value'
import { FormatRegistry } from '@sinclair/typebox'
import { describe, expect, it } from 'vitest'
import { AttemptBodySchema, CatalogSearchQuerySchema, ContentReportBodySchema, GameStartBodySchema, LegacyImportBodySchema } from '../src/index.js'

FormatRegistry.Set('uuid', (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
FormatRegistry.Set('date', (value) => /^\d{4}-\d{2}-\d{2}$/.test(value))

describe('API schemas', () => {
  it('rejects unknown start fields', () => expect(Value.Check(GameStartBodySchema, { kind: 'daily', mode: 'movie', answerId: 'secret' })).toBe(false))
  it('rejects invalid attempts', () => expect(Value.Check(AttemptBodySchema, { itemId: '' })).toBe(false))
  it('bounds search limits', () => expect(Value.Check(CatalogSearchQuerySchema, { mode: 'movie', q: 'a', limit: 21 })).toBe(false))
  it('requires explicit consent for a legacy import', () => {
    const payload = { deviceId: crypto.randomUUID(), schemaVersion: 1, games: [], wallet: { tickets: 0 }, periodUnlocks: {} }
    expect(Value.Check(LegacyImportBodySchema, payload)).toBe(false)
    expect(Value.Check(LegacyImportBodySchema, { ...payload, consent: true })).toBe(true)
  })
  it('accepts only owned-session report fields', () => {
    const sessionId = crypto.randomUUID()
    expect(Value.Check(ContentReportBodySchema, { sessionId, reason: 'wrong_fact', answerId: 'secret' })).toBe(false)
    expect(Value.Check(ContentReportBodySchema, { sessionId, reason: 'wrong_fact', comment: 'Проверьте карточку' })).toBe(true)
  })
})
