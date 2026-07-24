import { desc, eq } from 'drizzle-orm'
import { badges, userBadges, type Database } from '@shoditsa/database'

export const REGISTRATION_REFERRAL_HEADER = 'x-registration-referral'
export const REGISTRATION_REFERRAL_COOKIE = 'shoditsa_registration_referral'

const BADGE_CATALOG = {
  dtf: {
    key: 'dtf',
    name: 'DTF',
    shortLabel: 'DTF',
    description: 'Участник сообщества DTF',
    styleKey: 'dtf',
  },
} as const

export type RegistrationReferral = keyof typeof BADGE_CATALOG

type AuthRequestContext = {
  getHeader: (name: string) => string | null
  getCookie: (name: string) => string | null
}

export const normalizeRegistrationReferral = (value: unknown): RegistrationReferral | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLocaleLowerCase('en-US')
  return normalized in BADGE_CATALOG ? normalized as RegistrationReferral : null
}

export const registrationReferralFromContext = (context: AuthRequestContext | null | undefined) => {
  if (!context) return null
  return normalizeRegistrationReferral(context.getHeader(REGISTRATION_REFERRAL_HEADER))
    ?? normalizeRegistrationReferral(context.getCookie(REGISTRATION_REFERRAL_COOKIE))
}

export const registrationReferralCookie = (
  referral: RegistrationReferral,
  secure: boolean,
) => [
  `${REGISTRATION_REFERRAL_COOKIE}=${encodeURIComponent(referral)}`,
  'Max-Age=1800',
  'Path=/api/auth',
  'HttpOnly',
  'SameSite=Lax',
  ...(secure ? ['Secure'] : []),
].join('; ')

export const clearRegistrationReferralCookie = (secure: boolean) => [
  `${REGISTRATION_REFERRAL_COOKIE}=`,
  'Max-Age=0',
  'Path=/api/auth',
  'HttpOnly',
  'SameSite=Lax',
  ...(secure ? ['Secure'] : []),
].join('; ')

export const awardRegistrationBadge = async (
  db: Database,
  userId: string,
  referral: RegistrationReferral,
) => {
  const definition = BADGE_CATALOG[referral]
  await db.transaction(async (transaction) => {
    await transaction.insert(badges).values(definition).onConflictDoNothing()
    await transaction.insert(userBadges).values({
      userId,
      badgeKey: definition.key,
      source: 'registration_referral',
      sourceRef: referral,
    }).onConflictDoNothing()
  })
}

export const listUserBadges = async (db: Database, userId: string) => {
  const rows = await db.select({
    key: badges.key,
    name: badges.name,
    shortLabel: badges.shortLabel,
    description: badges.description,
    styleKey: badges.styleKey,
    awardedAt: userBadges.awardedAt,
  }).from(userBadges)
    .innerJoin(badges, eq(badges.key, userBadges.badgeKey))
    .where(eq(userBadges.userId, userId))
    .orderBy(desc(userBadges.awardedAt))

  return rows.map((badge) => ({
    ...badge,
    awardedAt: badge.awardedAt.toISOString(),
  }))
}
