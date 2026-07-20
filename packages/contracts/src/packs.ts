import { Type, type Static } from '@sinclair/typebox'
import { PlayableModeSchema } from './schemas.js'

export const PackSessionBodySchema = Type.Object({
  position: Type.Integer({ minimum: 1, maximum: 10_000 }),
}, { additionalProperties: false })

export const ContentPackSchema = Type.Object({
  id: Type.String(),
  slug: Type.String(),
  mode: PlayableModeSchema,
  title: Type.String(),
  subtitle: Type.Union([Type.String(), Type.Null()]),
  description: Type.String(),
  coverUrl: Type.Union([Type.String(), Type.Null()]),
  accessModel: Type.Union([Type.Literal('free'), Type.Literal('club'), Type.Literal('purchase')]),
  includedInClub: Type.Boolean(),
  previewItems: Type.Integer(),
  totalItems: Type.Integer(),
  productId: Type.Union([Type.String(), Type.Null()]),
  priceMinor: Type.Union([Type.Integer(), Type.Null()]),
  currency: Type.Union([Type.String(), Type.Null()]),
  access: Type.Union([Type.Literal('admin'), Type.Literal('free'), Type.Literal('preview'), Type.Literal('club'), Type.Literal('purchase'), Type.Literal('locked')]),
  owned: Type.Boolean(),
  completedItems: Type.Integer(),
}, { additionalProperties: false })

export const ContentPackDetailSchema = Type.Intersect([
  ContentPackSchema,
  Type.Object({
    entries: Type.Array(Type.Object({
      position: Type.Integer(),
      preview: Type.Boolean(),
      completed: Type.Boolean(),
      accessible: Type.Boolean(),
      prompt: Type.Record(Type.String(), Type.Unknown()),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
])

export type PackSessionBody = Static<typeof PackSessionBodySchema>
export type ContentPack = Static<typeof ContentPackSchema>
export type ContentPackDetail = Static<typeof ContentPackDetailSchema>
export type PackListResponse = { items: ContentPack[] }
export type PackDetailResponse = { pack: ContentPackDetail }
export type PackProgressResponse = { packId: string; completedPositions: number[]; lastPosition: number | null; completedAt: string | null }
