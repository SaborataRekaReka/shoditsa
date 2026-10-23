import { Type, type Static } from '@sinclair/typebox'

/** Public contact shared by the form, mail delivery and legal contacts. */
export const SUPPORT_EMAIL = 'breneize@yandex.ru'

export const SUPPORT_TOPICS = {
  problem: 'Проблема с игрой',
  payment: 'Оплата и доступ',
  idea: 'Идея или пожелание',
  other: 'Другой вопрос',
} as const

export const SupportMessageBodySchema = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254, pattern: '^[^\\r\\n]+$' }),
  topic: Type.Union([
    Type.Literal('problem'), Type.Literal('payment'), Type.Literal('idea'), Type.Literal('other'),
  ]),
  message: Type.String({ minLength: 10, maxLength: 5000 }),
  consent: Type.Literal(true),
  website: Type.Optional(Type.String({ maxLength: 120 })),
}, { additionalProperties: false })

export type SupportMessageBody = Static<typeof SupportMessageBodySchema>
export type SupportMessageResponse = { sent: true }
