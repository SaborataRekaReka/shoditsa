import 'dotenv/config'

export type AppConfig = ReturnType<typeof loadConfig>

const integer = (name: string, fallback: number, min = 1) => {
  const raw = process.env[name]
  const value = raw == null || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`)
  return value
}

const bool = (name: string, fallback: boolean) => {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} must be true or false`)
}

const required = (name: string, fallback?: string) => {
  const value = process.env[name]?.trim() || fallback
  if (!value) throw new Error(`${name} is required`)
  return value
}

export const loadConfig = () => {
  const production = process.env.NODE_ENV === 'production'
  const authSecret = required('BETTER_AUTH_SECRET', production ? undefined : 'development-only-secret-change-me-32-bytes')
  const promoPepper = required('PROMO_CODE_PEPPER', production ? undefined : 'development-only-promo-pepper')
  const yandexClientId = process.env.YANDEX_CLIENT_ID?.trim() || ''
  const yandexClientSecret = process.env.YANDEX_CLIENT_SECRET?.trim() || ''
  const authYandexEnabled = bool('AUTH_YANDEX_ENABLED', Boolean(yandexClientId && yandexClientSecret))
  if (production && authSecret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters')
  if (production && promoPepper.length < 32) throw new Error('PROMO_CODE_PEPPER must contain at least 32 characters')
  if (authYandexEnabled && (!yandexClientId || !yandexClientSecret)) {
    throw new Error('YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET are required when AUTH_YANDEX_ENABLED=true')
  }
  const smtpHost = process.env.SMTP_HOST?.trim() || ''
  const smtpUser = process.env.SMTP_USER?.trim() || ''
  const smtpPassword = process.env.SMTP_PASSWORD || ''
  const smtpFrom = process.env.SMTP_FROM?.trim() || ''
  const authEmailEnabled = bool('AUTH_EMAIL_ENABLED', !production)
  if (Boolean(smtpUser) !== Boolean(smtpPassword)) throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together')
  if (production && authEmailEnabled && (!smtpHost || !smtpFrom || !smtpUser || !smtpPassword)) {
    throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM are required when email authentication is enabled in production')
  }

  const authUrl = required('BETTER_AUTH_URL', production ? undefined : 'http://localhost:3001')
  const trustedOrigins = required('TRUSTED_ORIGINS', production ? undefined : 'http://localhost:5173,http://localhost:3001')
    .split(',').map((origin) => origin.trim()).filter(Boolean)
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',')
    .map((email) => email.trim().toLocaleLowerCase('en-US')).filter(Boolean)
  const adminUserIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map((id) => id.trim().toLocaleLowerCase('en-US')).filter(Boolean)
  if (production) {
    if (adminEmails.length !== 1 || adminEmails[0] !== 'breneize@yandex.ru') {
      throw new Error('ADMIN_EMAILS must contain only breneize@yandex.ru in production')
    }
    if (adminUserIds.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(adminUserIds[0])) {
      throw new Error('ADMIN_USER_IDS must contain exactly one valid UUID in production')
    }
  }

  return Object.freeze({
    nodeEnv: process.env.NODE_ENV ?? 'development',
    production,
    host: process.env.HOST?.trim() || '0.0.0.0',
    port: integer('PORT', 3001),
    logLevel: process.env.LOG_LEVEL?.trim() || 'info',
    databaseUrl: required('DATABASE_URL', production ? undefined : 'postgres://shoditsa_app:shoditsa_dev@localhost:5434/shoditsa'),
    databasePoolMax: integer('DATABASE_POOL_MAX', 10),
    authSecret,
    authUrl,
    trustedOrigins,
    cookieSecure: bool('COOKIE_SECURE', production),
    authEmailEnabled,
    authYandexEnabled,
    yandexClientId,
    yandexClientSecret,
    smtp: {
      host: smtpHost,
      port: integer('SMTP_PORT', 587),
      user: smtpUser,
      password: smtpPassword,
      from: smtpFrom,
    },
    adminEmails,
    adminUserIds,
    promoPepper,
    mediaRoot: process.env.MEDIA_ROOT?.trim() || './.tmp/media',
    publicMediaBaseUrl: process.env.PUBLIC_MEDIA_BASE_URL?.trim() || '/media',
    legacyImportEnabled: bool('LEGACY_IMPORT_ENABLED', !production),
    legacyImportTicketCap: integer('LEGACY_IMPORT_TICKET_CAP', 500, 0),
    appVersion: process.env.APP_VERSION?.trim() || '0.1.0',
    gitSha: process.env.GIT_SHA?.trim() || 'dev',
    metricsToken: process.env.METRICS_TOKEN?.trim() || '',
    enrichmentDataRoot: process.env.ENRICHMENT_DATA_ROOT?.trim() || './data/enrichment-agent',
    contentReleaseRoot: process.env.CONTENT_RELEASE_ROOT?.trim() || (production ? '/app/release-content/libraries' : './public/data/libraries'),
    workerId: process.env.WORKER_ID?.trim() || `worker-${process.pid}`,
    workerPollIntervalMs: integer('WORKER_POLL_INTERVAL_MS', 2_000, 250),
    workerHeartbeatIntervalMs: integer('WORKER_HEARTBEAT_INTERVAL_MS', 5_000, 1_000),
    workerStaleAfterMs: integer('WORKER_STALE_AFTER_MS', 60_000, 5_000),
    normalizationConcurrency: integer('NORMALIZATION_CONCURRENCY', 3, 1),
    musicPipelineModel: process.env.MUSIC_PIPELINE_MODEL?.trim() || 'gpt-5-mini',
    pipelineSecretsKey: process.env.PIPELINE_SECRETS_KEY?.trim() || authSecret,
  })
}
