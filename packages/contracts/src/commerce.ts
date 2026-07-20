import { Type, type Static } from '@sinclair/typebox'
import { DateSchema, DateTimeSchema, DifficultyKeySchema, PeriodKeySchema, PlayableModeSchema, UuidSchema } from './schemas.js'
import type { ArchiveItem } from './api.js'

export const CommerceProductKindSchema = Type.Union(['club', 'pack', 'tip'].map((value) => Type.Literal(value)))
export type CommerceProductKind = Static<typeof CommerceProductKindSchema>

export type CommerceProduct = {
  id: string
  kind: CommerceProductKind
  title: string
  description: string
  priceMinor: number
  currency: string
  durationDays: number | null
  metadata: Record<string, unknown>
}

export type CommerceCatalogResponse = { enabled: boolean; currency: string; products: CommerceProduct[] }
export type MembershipSummary = {
  active: boolean
  startsAt: string | null
  endsAt: string | null
  source: 'order' | 'admin' | 'promo' | 'migration' | 'yandex' | null
}
export type MeCommerceResponse = {
  membership: MembershipSummary
  entitlements: Array<{ key: string; scope: string | null; startsAt: string; endsAt: string | null }>
}

export const CURRENT_OFFER_VERSION = '2026-07-20' as const
export const CheckoutBodySchema = Type.Object({
  productId: Type.String({ minLength: 1, maxLength: 120 }),
  termsAccepted: Type.Literal(true),
  offerVersion: Type.Literal(CURRENT_OFFER_VERSION),
}, { additionalProperties: false })
export type CheckoutBody = Static<typeof CheckoutBodySchema>

export const CommerceOrderParamsSchema = Type.Object({ orderId: UuidSchema }, { additionalProperties: false })
export type CommerceOrderParams = Static<typeof CommerceOrderParamsSchema>

export type PaymentOrderStatus = 'created' | 'pending' | 'paid' | 'failed' | 'canceled' | 'expired' | 'refunded' | 'chargeback'
export type PaymentOrderPublic = {
  id: string
  productId: string
  status: PaymentOrderStatus
  amountMinor: number
  currency: string
  createdAt: string
  paidAt: string | null
}
export type CheckoutResponse = { order: PaymentOrderPublic; checkoutUrl: string | null }
export type OrderResponse = { order: PaymentOrderPublic; product: CommerceProduct }

export const ArchiveCalendarQuerySchema = Type.Object({
  mode: PlayableModeSchema,
  from: DateSchema,
  to: DateSchema,
  period: Type.Optional(PeriodKeySchema),
  difficulty: Type.Optional(DifficultyKeySchema),
}, { additionalProperties: false })
export type ArchiveCalendarQuery = Static<typeof ArchiveCalendarQuerySchema>
export type ArchiveCalendarResponse = {
  access: { archiveFirstDate: string; freeFrom: string; clubActive: boolean }
  items: Array<{ date: string; access: 'free' | 'club' | 'locked'; session: ArchiveItem | null }>
}

export const AdminCommerceProductPatchSchema = Type.Partial(Type.Object({
  title: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.String({ maxLength: 1_000 }),
  priceMinor: Type.Integer({ minimum: 0, maximum: 100_000_000 }),
  currency: Type.String({ pattern: '^[A-Z]{3}$' }),
  durationDays: Type.Union([Type.Integer({ minimum: 1, maximum: 36_500 }), Type.Null()]),
  enabled: Type.Boolean(),
  sortOrder: Type.Integer({ minimum: -100_000, maximum: 100_000 }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false }), { minProperties: 2, additionalProperties: false })
export type AdminCommerceProductPatch = Static<typeof AdminCommerceProductPatchSchema>

export const AdminEntitlementGrantBodySchema = Type.Object({
  userId: UuidSchema,
  entitlementKey: Type.Union([Type.Literal('club'), Type.Literal('pack'), Type.Literal('supporter')]),
  scope: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 160 }), Type.Null()])),
  startsAt: Type.Optional(DateTimeSchema),
  durationDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 36_500 })),
  permanent: Type.Optional(Type.Boolean()),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })
export type AdminEntitlementGrantBody = Static<typeof AdminEntitlementGrantBodySchema>

export const AdminEntitlementRevokeBodySchema = Type.Object({ reason: Type.String({ minLength: 3, maxLength: 500 }) }, { additionalProperties: false })
export type AdminEntitlementRevokeBody = Static<typeof AdminEntitlementRevokeBodySchema>

export const AdminCommerceListQuerySchema = Type.Object({
  status: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  cursor: Type.Optional(DateTimeSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
}, { additionalProperties: false })
export type AdminCommerceListQuery = Static<typeof AdminCommerceListQuerySchema>
