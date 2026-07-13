import { Value } from '@sinclair/typebox/value'
import { FormatRegistry } from '@sinclair/typebox'
import { describe, expect, it } from 'vitest'
import {
  AttemptBodySchema, CatalogSearchQuerySchema, ContentReportBodySchema, GameStartBodySchema, IntegrationKeySchema, IntegrationSecretUpdateBodySchema,
  LegacyImportBodySchema, MoviePipelineManualPreviewBodySchema, MoviePipelineRunBodySchema, MusicPipelineManualPreviewBodySchema, MusicPipelineRunBodySchema,
} from '../src/index.js'

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
  it('accepts a bounded manual music artist queue', () => {
    const artists = [{ artist: 'Кино' }, { artist: 'Phoenix', country: 'Франция', hint: 'indie rock band' }]
    expect(Value.Check(MusicPipelineManualPreviewBodySchema, { artists })).toBe(true)
    expect(Value.Check(MusicPipelineRunBodySchema, { scenario: 'manual', maxItems: 5, artists, confirmation: true })).toBe(true)
    expect(Value.Check(MusicPipelineManualPreviewBodySchema, { artists: Array.from({ length: 501 }, (_, index) => ({ artist: `Artist ${index}` })) })).toBe(false)
  })
  it('accepts a bounded manual Kinopoisk movie queue', () => {
    const movies = [{ kinopoiskId: 326 }, { kinopoiskId: 435, hint: 'проверить награды' }]
    expect(Value.Check(MoviePipelineManualPreviewBodySchema, { movies })).toBe(true)
    expect(Value.Check(MoviePipelineRunBodySchema, { scenario: 'manual', maxItems: 5, movies, confirmation: true })).toBe(true)
    expect(Value.Check(MoviePipelineManualPreviewBodySchema, { movies: [{ kinopoiskId: 0 }] })).toBe(false)
  })
  it('requires explicit confirmation when saving an integration credential', () => {
    expect(Value.Check(IntegrationSecretUpdateBodySchema, { value: 'secret' })).toBe(false)
    expect(Value.Check(IntegrationSecretUpdateBodySchema, { value: 'secret', confirmation: true })).toBe(true)
  })
  it('accepts exactly five Kinopoisk Unofficial API key slots', () => {
    expect(Value.Check(IntegrationKeySchema, 'KINOPOISK_UNOFFICIAL_API_KEY_1')).toBe(true)
    expect(Value.Check(IntegrationKeySchema, 'KINOPOISK_UNOFFICIAL_API_KEY_5')).toBe(true)
    expect(Value.Check(IntegrationKeySchema, 'KINOPOISK_UNOFFICIAL_API_KEY_6')).toBe(false)
  })
})
