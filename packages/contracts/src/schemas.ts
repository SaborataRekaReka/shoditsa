import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { CONTENT_MODE_IDS, PLAYABLE_MODE_IDS } from './game-modes.js'

export const CONTENT_MODES = CONTENT_MODE_IDS
export const PLAYABLE_MODES = PLAYABLE_MODE_IDS
export const PERIOD_KEYS = ['all', 'from_1960', 'from_1980', 'from_1990', 'from_2000', 'from_2010', 'from_2020'] as const
export const DIFFICULTY_KEYS = ['easy', 'medium', 'hard', 'expert'] as const

export const ContentModeSchema = Type.Union(CONTENT_MODES.map((value) => Type.Literal(value)))
export const PlayableModeSchema = Type.Union(PLAYABLE_MODES.map((value) => Type.Literal(value)))
export const PeriodKeySchema = Type.Union(PERIOD_KEYS.map((value) => Type.Literal(value)))
export const DifficultyKeySchema = Type.Union(DIFFICULTY_KEYS.map((value) => Type.Literal(value)))
export const NullableDifficultySchema = Type.Union([DifficultyKeySchema, Type.Null()])
export const UuidSchema = Type.String({ format: 'uuid' })
export const DateSchema = Type.String({ format: 'date' })
export const DateTimeSchema = Type.String({ format: 'date-time' })

export const ErrorEnvelopeSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Record(Type.String(), Type.Unknown()),
  }, { additionalProperties: false }),
}, { additionalProperties: false })

export const PublicContentItemSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  mode: PlayableModeSchema,
  titleRu: Type.String(),
  titleOriginal: Type.String(),
  year: Type.Union([Type.Integer(), Type.Null()]),
  genres: Type.Optional(Type.Array(Type.String())),
  posterUrl: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: true })

export const CatalogSearchQuerySchema = Type.Object({
  mode: PlayableModeSchema,
  q: Type.String({ minLength: 1, maxLength: 100 }),
  period: Type.Optional(PeriodKeySchema),
  difficulty: Type.Optional(DifficultyKeySchema),
  sessionId: Type.Optional(UuidSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 10 })),
}, { additionalProperties: false })

export const CatalogSearchResponseSchema = Type.Object({
  items: Type.Array(PublicContentItemSchema),
}, { additionalProperties: false })

export const GameStartBodySchema = Type.Object({
  kind: Type.Union([Type.Literal('daily'), Type.Literal('archive'), Type.Literal('free_play'), Type.Literal('pack')]),
  // Danetki shares the canonical route, but remains outside PLAYABLE_MODES
  // because the legacy catalog engine still assumes title-guessing semantics.
  mode: ContentModeSchema,
  roomMode: Type.Optional(Type.Union([Type.Literal('solo'), Type.Literal('group')])),
  period: Type.Optional(PeriodKeySchema),
  difficulty: Type.Optional(NullableDifficultySchema),
  variantKey: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  packId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  packPosition: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
  archiveDate: Type.Optional(Type.Union([DateSchema, Type.Null()])),
}, { additionalProperties: false })

export const DanetkiMessageBodySchema = Type.Object({
  text: Type.String({ minLength: 2, maxLength: 300 }),
  idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 120 })),
}, { additionalProperties: false })

export const DanetkiGuessBodySchema = Type.Object({
  text: Type.String({ minLength: 20, maxLength: 1_500 }),
  idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 120 })),
}, { additionalProperties: false })

export const DanetkiMutationBodySchema = Type.Object({
  idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 120 })),
}, { additionalProperties: false })

export const DanetkiJoinBodySchema = Type.Object({
  displayName: Type.String({ minLength: 1, maxLength: 40 }),
  idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 120 })),
}, { additionalProperties: false })

export const AttemptBodySchema = Type.Object({
  itemId: Type.String({ minLength: 1, maxLength: 255 }),
}, { additionalProperties: false })

export const HintChoiceBodySchema = Type.Object({
  checkpoint: Type.Union([Type.Literal(5), Type.Literal(8)]),
  hintKey: Type.Union(['plot', 'info', 'fact'].map((value) => Type.Literal(value))),
}, { additionalProperties: false })

export const ProfilePatchSchema = Type.Partial(Type.Object({
  displayName: Type.Union([Type.String({ minLength: 1, maxLength: 80 }), Type.Null()]),
  locale: Type.String({ minLength: 2, maxLength: 12 }),
  timezone: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false }))

export const PeriodUnlockBodySchema = Type.Object({ mode: PlayableModeSchema, period: PeriodKeySchema }, { additionalProperties: false })
export const FreePlayBodySchema = Type.Object({ mode: PlayableModeSchema, difficulty: Type.Optional(NullableDifficultySchema) }, { additionalProperties: false })
export const PromoRedeemBodySchema = Type.Object({ code: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false })

export const ArchiveQuerySchema = Type.Object({
  mode: Type.Optional(PlayableModeSchema),
  cursor: Type.Optional(DateTimeSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
}, { additionalProperties: false })

export const LedgerQuerySchema = Type.Object({
  cursor: Type.Optional(DateTimeSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
}, { additionalProperties: false })

export const ArchiveDateParamsSchema = Type.Object({ date: DateSchema }, { additionalProperties: false })

export const ContentReportReasonSchema = Type.Union([
  Type.Literal('wrong_fact'),
  Type.Literal('disputed_comparison'),
  Type.Literal('title_not_found'),
  Type.Literal('bad_hint'),
  Type.Literal('bad_image'),
  Type.Literal('duplicate_card'),
  Type.Literal('typo_or_translation'),
  Type.Literal('technical_error'),
  Type.Literal('other'),
])

export const ContentReportBodySchema = Type.Object({
  sessionId: UuidSchema,
  reason: ContentReportReasonSchema,
  comment: Type.Optional(Type.String({ maxLength: 500 })),
  clientEventId: Type.Optional(UuidSchema),
  appVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  pageUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  clientErrorId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
}, { additionalProperties: false })

export const LegacyImportBodySchema = Type.Object({
  consent: Type.Literal(true),
  deviceId: UuidSchema,
  schemaVersion: Type.Integer({ minimum: 1, maximum: 100 }),
  games: Type.Array(Type.Object({
    mode: PlayableModeSchema,
    period: PeriodKeySchema,
    date: DateSchema,
    difficulty: Type.Optional(Type.Union([DifficultyKeySchema, Type.Null()])),
    attemptTitleIds: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { maxItems: 10 }),
    attempts: Type.Optional(Type.Array(Type.Object({ titleId: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false }), { maxItems: 10 })),
  }, { additionalProperties: false }), { maxItems: 500 }),
  wallet: Type.Object({ tickets: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  periodUnlocks: Type.Record(Type.String(), Type.Array(PeriodKeySchema)),
}, { additionalProperties: false })

export const AdminPromoCreateBodySchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 64 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  rewardType: Type.Optional(Type.Literal('tickets')),
  rewardValue: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  perUserLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  globalLimit: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
}, { additionalProperties: false })

export const AdminPromoPatchBodySchema = Type.Partial(Type.Object({
  enabled: Type.Boolean(),
  endsAt: Type.Union([DateTimeSchema, Type.Null()]),
}, { additionalProperties: false }))

export const AdminWalletAdjustmentBodySchema = Type.Object({
  userId: UuidSchema,
  amount: Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

export const AdminContentReviewQuerySchema = Type.Object({
  mode: Type.Optional(ContentModeSchema),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
  pendingOnly: Type.Optional(Type.Boolean({ default: true })),
}, { additionalProperties: false })

export const AdminContentReviewParamsSchema = Type.Object({
  itemId: Type.String({ minLength: 1, maxLength: 255 }),
  field: Type.String({ minLength: 1, maxLength: 120 }),
}, { additionalProperties: false })

export const AdminContentReviewDecisionSchema = Type.Object({
  option: Type.Optional(Type.Union([Type.Literal('A'), Type.Literal('B')])),
  value: Type.Optional(Type.String({ maxLength: 1_000 })),
  approved: Type.Optional(Type.Boolean()),
  note: Type.Optional(Type.String({ maxLength: 1_000 })),
}, { additionalProperties: false, minProperties: 1 })

export type ContentMode = Static<typeof ContentModeSchema>
export type PlayableMode = Static<typeof PlayableModeSchema>
export type ApiPeriodKey = Static<typeof PeriodKeySchema>
export type ApiDifficultyKey = Static<typeof DifficultyKeySchema>
export type CatalogSearchQuery = Static<typeof CatalogSearchQuerySchema>
export type GameStartBody = Static<typeof GameStartBodySchema>
export type AttemptBody = Static<typeof AttemptBodySchema>
export type HintChoiceBody = Static<typeof HintChoiceBodySchema>
export type ProfilePatch = Static<typeof ProfilePatchSchema>
export type PeriodUnlockBody = Static<typeof PeriodUnlockBodySchema>
export type FreePlayBody = Static<typeof FreePlayBodySchema>
export type PromoRedeemBody = Static<typeof PromoRedeemBodySchema>
export type ArchiveQuery = Static<typeof ArchiveQuerySchema>
export type LedgerQuery = Static<typeof LedgerQuerySchema>
export type ContentReportBody = Static<typeof ContentReportBodySchema>
export type ContentReportReason = Static<typeof ContentReportReasonSchema>
export type LegacyImportBody = Static<typeof LegacyImportBodySchema>
export type AdminPromoCreateBody = Static<typeof AdminPromoCreateBodySchema>
export type AdminPromoPatchBody = Static<typeof AdminPromoPatchBodySchema>
export type AdminWalletAdjustmentBody = Static<typeof AdminWalletAdjustmentBodySchema>
export type AdminContentReviewQuery = Static<typeof AdminContentReviewQuerySchema>
export type AdminContentReviewDecision = Static<typeof AdminContentReviewDecisionSchema>

export type RouteSchema = {
  body?: TSchema
  querystring?: TSchema
  params?: TSchema
  headers?: TSchema
  response?: Record<number, TSchema>
}
