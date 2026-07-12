import { Type, type Static, type TSchema } from '@sinclair/typebox'

export const CONTENT_MODES = ['movie', 'series', 'anime', 'game', 'music', 'diagnosis'] as const
export const PERIOD_KEYS = ['all', 'from_1960', 'from_1980', 'from_1990', 'from_2000', 'from_2010', 'from_2020'] as const
export const DIFFICULTY_KEYS = ['easy', 'medium', 'hard', 'expert'] as const

export const ContentModeSchema = Type.Union(CONTENT_MODES.map((value) => Type.Literal(value)))
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
  mode: ContentModeSchema,
  titleRu: Type.String(),
  titleOriginal: Type.String(),
  year: Type.Union([Type.Integer(), Type.Null()]),
  posterUrl: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false })

export const CatalogSearchQuerySchema = Type.Object({
  mode: ContentModeSchema,
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
  kind: Type.Union([Type.Literal('daily'), Type.Literal('archive')]),
  mode: ContentModeSchema,
  period: Type.Optional(PeriodKeySchema),
  difficulty: Type.Optional(NullableDifficultySchema),
  archiveDate: Type.Optional(Type.Union([DateSchema, Type.Null()])),
}, { additionalProperties: false })

export const AttemptBodySchema = Type.Object({
  itemId: Type.String({ minLength: 1, maxLength: 255 }),
}, { additionalProperties: false })

export const HintChoiceBodySchema = Type.Object({
  checkpoint: Type.Union([Type.Literal(5), Type.Literal(8)]),
  hintKey: Type.Union(['plot', 'slogan', 'cast_main', 'cast_secondary', 'fact', 'awards'].map((value) => Type.Literal(value))),
}, { additionalProperties: false })

export const ProfilePatchSchema = Type.Partial(Type.Object({
  displayName: Type.Union([Type.String({ minLength: 1, maxLength: 80 }), Type.Null()]),
  locale: Type.String({ minLength: 2, maxLength: 12 }),
  timezone: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false }))

export const PeriodUnlockBodySchema = Type.Object({ mode: ContentModeSchema, period: PeriodKeySchema }, { additionalProperties: false })
export const FreePlayBodySchema = Type.Object({ mode: ContentModeSchema, difficulty: Type.Optional(NullableDifficultySchema) }, { additionalProperties: false })
export const PromoRedeemBodySchema = Type.Object({ code: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false })

export type ContentMode = Static<typeof ContentModeSchema>
export type ApiPeriodKey = Static<typeof PeriodKeySchema>
export type ApiDifficultyKey = Static<typeof DifficultyKeySchema>
export type CatalogSearchQuery = Static<typeof CatalogSearchQuerySchema>
export type GameStartBody = Static<typeof GameStartBodySchema>
export type AttemptBody = Static<typeof AttemptBodySchema>
export type HintChoiceBody = Static<typeof HintChoiceBodySchema>
export type ProfilePatch = Static<typeof ProfilePatchSchema>

export type RouteSchema = {
  body?: TSchema
  querystring?: TSchema
  params?: TSchema
  headers?: TSchema
  response?: Record<number, TSchema>
}
