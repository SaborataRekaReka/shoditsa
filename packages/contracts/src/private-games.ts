import { Type, type Static } from '@sinclair/typebox'
import { DateSchema, UuidSchema } from './schemas.js'

export const PrivateGameOrderBodySchema = Type.Object({
  contactName: Type.String({ minLength: 2, maxLength: 120 }),
  email: Type.String({ pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', maxLength: 254 }),
  company: Type.Optional(Type.String({ maxLength: 160 })),
  participants: Type.Integer({ minimum: 2, maximum: 10_000 }),
  eventDate: Type.Optional(Type.Union([DateSchema, Type.Null()])),
  description: Type.String({ minLength: 20, maxLength: 4_000 }),
  consent: Type.Literal(true),
  website: Type.Optional(Type.String({ maxLength: 0 })),
}, { additionalProperties: false })

export const AdminPrivateGameOrderPatchSchema = Type.Object({
  status: Type.Optional(Type.Union(['new', 'contacted', 'in_progress', 'completed', 'rejected'].map((value) => Type.Literal(value)))),
  internalNote: Type.Optional(Type.Union([Type.String({ maxLength: 4_000 }), Type.Null()])),
  packId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()])),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

export type PrivateGameOrderBody = Static<typeof PrivateGameOrderBodySchema>
export type AdminPrivateGameOrderPatch = Static<typeof AdminPrivateGameOrderPatchSchema>
export type PrivateGameOrderResponse = { id: string; status: 'new'; createdAt: string }
