import { betterAuth } from 'better-auth'
import { anonymous } from 'better-auth/plugins'
import { genericOAuth, yandex } from 'better-auth/plugins/generic-oauth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import nodemailer from 'nodemailer'
import type { AppConfig } from '@shoditsa/config'
import type { Database } from '@shoditsa/database'
import * as schema from '@shoditsa/database'
import { mergeAnonymousAccount } from './merge.js'

export const createAuth = (config: AppConfig, db: Database) => {
  const smtpConfigured = Boolean(config.smtp.host && config.smtp.from)
  const emailVerificationEnabled = config.authEmailEnabled && smtpConfigured
  const transport = smtpConfigured ? nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  }) : null
  const send = async (to: string, subject: string, text: string) => {
    if (!transport || !config.smtp.from) throw new Error('Email authentication is temporarily unavailable')
    await transport.sendMail({ from: config.smtp.from, to, subject, text })
  }

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
      sendResetPassword: async ({ user, url }) => send(user.email, 'Сброс пароля — Сходится!', `Откройте ссылку для сброса пароля: ${url}`),
    },
    emailVerification: {
      sendOnSignUp: emailVerificationEnabled,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (!emailVerificationEnabled) return
        await send(user.email, 'Подтвердите email — Сходится!', `Подтвердите адрес: ${url}`)
      },
    },
    plugins,
  })
}

export type Auth = ReturnType<typeof createAuth>
