import { betterAuth } from 'better-auth'
import { anonymous } from 'better-auth/plugins'
import { genericOAuth, yandex } from 'better-auth/plugins/generic-oauth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { AppConfig } from '@shoditsa/config'
import type { Database } from '@shoditsa/database'
import * as schema from '@shoditsa/database'
import { mergeAnonymousAccount } from './merge.js'
import { createAuthEmailSender } from './email.js'

export const createAuth = (config: AppConfig, db: Database) => {
  const smtpConfigured = Boolean(config.smtp.host && config.smtp.from)
  const emailVerificationEnabled = config.authEmailEnabled && smtpConfigured
  const send = createAuthEmailSender(config)

  const plugins = [
    ...(config.authYandexEnabled
      ? [genericOAuth({
          config: [
            yandex({
              clientId: config.yandexClientId,
              clientSecret: config.yandexClientSecret,
            }),
          ],
        })]
      : []),
    anonymous({
      emailDomainName: new URL(config.authUrl).hostname,
      generateName: () => 'Гость',
      disableDeleteAnonymousUser: false,
      onLinkAccount: async ({ anonymousUser, newUser }) => mergeAnonymousAccount(db, anonymousUser.user.id, newUser.user.id),
    }),
  ]

  return betterAuth({
    baseURL: config.authUrl,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: config.cookieSecure,
      cookiePrefix: 'shoditsa',
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    user: { deleteUser: { enabled: true } },
    emailAndPassword: {
      enabled: config.authEmailEnabled,
      requireEmailVerification: emailVerificationEnabled,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) => {
        if (!send) throw new Error('Email authentication is temporarily unavailable')
        await send(user.email, 'password-reset', url)
      },
    },
    emailVerification: {
      sendOnSignUp: emailVerificationEnabled,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (!emailVerificationEnabled) return
        if (!send) throw new Error('Email authentication is temporarily unavailable')
        await send(user.email, 'verification', url)
      },
    },
    plugins,
  })
}

export type Auth = ReturnType<typeof createAuth>
