import { Value } from '@sinclair/typebox/value'
import { FormatRegistry } from '@sinclair/typebox'
import { describe, expect, it } from 'vitest'
import {
  AnimePipelineManualPreviewBodySchema, AnimePipelineRunBodySchema, AttemptBodySchema, CatalogSearchQuerySchema, ContentExchangeDocumentSchema, ContentExchangeExportBodySchema, ContentReportBodySchema, GameStartBodySchema, HintChoiceBodySchema, IntegrationKeySchema, IntegrationSecretUpdateBodySchema,
  LegacyImportBodySchema, MoviePipelineManualPreviewBodySchema, MoviePipelineRunBodySchema, MusicPipelineManualPreviewBodySchema, MusicPipelineRunBodySchema,
  PipelineApprovalBodySchema, PipelineBulkDecisionBodySchema,
  PrivateGameOrderBodySchema,
  FriendsRoomConfigBodySchema, FriendsRoomCreateBodySchema, friendsRoomMinimumRounds,
} from '../src/index.js'

FormatRegistry.Set('uuid', (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
FormatRegistry.Set('date', (value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
FormatRegistry.Set('date-time', (value) => !Number.isNaN(Date.parse(value)))

describe('API schemas', () => {
  it('rejects unknown start fields', () => expect(Value.Check(GameStartBodySchema, { kind: 'daily', mode: 'movie', answerId: 'secret' })).toBe(false))
  it('accepts friends-room round counts from 3 to 30 in steps of 3', () => {
    expect(Value.Check(FriendsRoomCreateBodySchema, { roundsTotal: 3 })).toBe(true)
    expect(Value.Check(FriendsRoomConfigBodySchema, { roundsTotal: 30 })).toBe(true)
    expect(Value.Check(FriendsRoomConfigBodySchema, { roundsTotal: 5 })).toBe(false)
    expect(Value.Check(FriendsRoomConfigBodySchema, { roundsTotal: 33 })).toBe(false)
    expect(friendsRoomMinimumRounds(1)).toBe(3)
    expect(friendsRoomMinimumRounds(6)).toBe(6)
    expect(friendsRoomMinimumRounds(7)).toBe(9)
  })
  it('accepts city through the canonical game route with a supported variant', () => expect(Value.Check(GameStartBodySchema, { kind: 'daily', mode: 'city', variantKey: 'capitals' })).toBe(true))
  it('accepts a solo danetki session through the canonical game route', () => expect(Value.Check(GameStartBodySchema, { kind: 'daily', mode: 'danetki', roomMode: 'solo' })).toBe(true))
  it('accepts free play for the danetki chat engine', () => expect(Value.Check(GameStartBodySchema, { kind: 'free_play', mode: 'danetki', roomMode: 'group' })).toBe(true))
  it('accepts a pack session selector', () => expect(Value.Check(GameStartBodySchema, { kind: 'pack', mode: 'game', packId: 'dtf-game-comments-25-v1', packPosition: 1 })).toBe(true))
  it('validates the manual private-game order form strictly', () => {
    const valid = { contactName: 'Анна', email: 'anna@example.com', participants: 20, eventDate: null, description: 'Командная игра для летней встречи отдела.', consent: true }
    expect(Value.Check(PrivateGameOrderBodySchema, valid)).toBe(true)
    expect(Value.Check(PrivateGameOrderBodySchema, { ...valid, consent: false })).toBe(false)
    expect(Value.Check(PrivateGameOrderBodySchema, { ...valid, price: 100 })).toBe(false)
  })
  it('rejects invalid attempts', () => expect(Value.Check(AttemptBodySchema, { itemId: '' })).toBe(false))
  it('accepts plot and unopened-information hints, but not facts', () => {
    expect(Value.Check(HintChoiceBodySchema, { checkpoint: 5, hintKey: 'info' })).toBe(true)
    expect(Value.Check(HintChoiceBodySchema, { checkpoint: 5, hintKey: 'plot' })).toBe(true)
    expect(Value.Check(HintChoiceBodySchema, { checkpoint: 8, hintKey: 'fact' })).toBe(false)
  })
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
    expect(Value.Check(MusicPipelineRunBodySchema, { scenario: 'manual', maxItems: 5, artists, includeExisting: true, confirmation: true })).toBe(true)
    expect(Value.Check(MusicPipelineManualPreviewBodySchema, { artists: Array.from({ length: 501 }, (_, index) => ({ artist: `Artist ${index}` })) })).toBe(false)
  })
  it('accepts a bounded manual Kinopoisk movie queue', () => {
    const movies = [{ kinopoiskId: 326 }, { query: 'В поисках Немо', year: 2003 }, { query: 'Интерстеллар' }]
    expect(Value.Check(MoviePipelineManualPreviewBodySchema, { movies })).toBe(true)
    expect(Value.Check(MoviePipelineRunBodySchema, { scenario: 'manual', maxItems: 5, movies, includeExisting: true, confirmation: true })).toBe(true)
    expect(Value.Check(MoviePipelineManualPreviewBodySchema, { movies: [{ kinopoiskId: 0 }] })).toBe(false)
    expect(Value.Check(MoviePipelineManualPreviewBodySchema, { movies: [{ query: 'Бэтмен', year: 1800 }] })).toBe(false)
  })
  it('accepts a bounded manual Shikimori anime queue', () => {
    const anime = [{ shikimoriId: 16498 }, { shikimoriId: 5114, hint: 'проверить студию' }]
    expect(Value.Check(AnimePipelineManualPreviewBodySchema, { anime })).toBe(true)
    expect(Value.Check(AnimePipelineRunBodySchema, { scenario: 'manual', maxItems: 5, anime, includeExisting: true, confirmation: true })).toBe(true)
    expect(Value.Check(AnimePipelineManualPreviewBodySchema, { anime: [{ shikimoriId: 0 }] })).toBe(false)
  })
  it('accepts a self-describing selective content exchange document', () => {
    const document = {
      format: 'shoditsa-content-exchange', schemaVersion: 1, exportId: crypto.randomUUID(), exportedAt: new Date().toISOString(),
      source: { revisionId: crypto.randomUUID(), revisionVersion: 'test', workspaceId: crypto.randomUUID(), workspaceVersion: 1 },
      fields: ['titleRu', 'year'],
      items: [{ id: 'movie:test', mode: 'movie', base: null, data: { titleRu: 'Тест', year: 2026 }, unsetFields: [] }],
    }
    expect(Value.Check(ContentExchangeDocumentSchema, document)).toBe(true)
    expect(Value.Check(ContentExchangeExportBodySchema, { itemIds: ['movie:test'], fields: ['titleRu', 'year'] })).toBe(true)
    expect(Value.Check(ContentExchangeExportBodySchema, { itemIds: ['movie:test'], fields: ['titleRu', 'titleRu'] })).toBe(false)
    expect(Value.Check(ContentExchangeDocumentSchema, { ...document, fields: ['bad-field'] })).toBe(false)
  })
  it('requires explicit confirmation when saving an integration credential', () => {
    expect(Value.Check(IntegrationSecretUpdateBodySchema, { value: 'secret' })).toBe(false)
    expect(Value.Check(IntegrationSecretUpdateBodySchema, { value: 'secret', confirmation: true })).toBe(true)
  })
  it('accepts exactly five Kinopoisk Unofficial API key slots', () => {
    expect(Value.Check(IntegrationKeySchema, 'KINOPOISK_UNOFFICIAL_API_KEY_1')).toBe(true)
    expect(Value.Check(IntegrationKeySchema, 'KINOPOISK_UNOFFICIAL_API_KEY_5')).toBe(true)
    expect(Value.Check(IntegrationKeySchema, 'KINOPOISK_UNOFFICIAL_API_KEY_6')).toBe(false)
    expect(Value.Check(IntegrationKeySchema, 'SHIKIMORI_USER_AGENT')).toBe(true)
    expect(Value.Check(IntegrationKeySchema, 'SHIKIMORI_ACCESS_TOKEN')).toBe(true)
    expect(Value.Check(IntegrationKeySchema, 'YOOKASSA_SHOP_ID')).toBe(true)
    expect(Value.Check(IntegrationKeySchema, 'YOOKASSA_SECRET_KEY')).toBe(true)
  })
  it('accepts pipeline bulk actions larger than the old 500 item limit', () => {
    const itemIds = Array.from({ length: 501 }, () => crypto.randomUUID())
    expect(Value.Check(PipelineBulkDecisionBodySchema, { itemIds, approved: true })).toBe(true)
    expect(Value.Check(PipelineApprovalBodySchema, { itemIds })).toBe(true)
    expect(Value.Check(PipelineBulkDecisionBodySchema, { itemIds: [itemIds[0], itemIds[0]], approved: true })).toBe(false)
    expect(Value.Check(PipelineApprovalBodySchema, { itemIds: [itemIds[0], itemIds[0]] })).toBe(false)
  })
})
