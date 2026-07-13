import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { integrationSecrets, type Database } from '@shoditsa/database'
import type { AppConfig } from '@shoditsa/config'
import type { IntegrationKey } from '@shoditsa/contracts'

export const integrationRegistry: ReadonlyArray<{
  key: IntegrationKey
  title: string
  provider: string
  description: string
  required: boolean
  secret: boolean
}> = [
  { key: 'OPENAI_API_KEY', title: 'OpenAI API key', provider: 'OpenAI', description: 'Поиск исполнителей, фактчекинг и генерация игровых подсказок.', required: true, secret: true },
  { key: 'LASTFM_API_KEY', title: 'Last.fm API key', provider: 'Last.fm', description: 'Популярность, теги, похожие исполнители, треки и альбомы.', required: false, secret: true },
  { key: 'SPOTIFY_CLIENT_ID', title: 'Spotify Client ID', provider: 'Spotify', description: 'Идентификатор приложения Spotify Web API.', required: false, secret: false },
  { key: 'SPOTIFY_CLIENT_SECRET', title: 'Spotify Client Secret', provider: 'Spotify', description: 'Секрет приложения Spotify Web API.', required: false, secret: true },
  { key: 'THEAUDIODB_API_KEY', title: 'TheAudioDB API key', provider: 'TheAudioDB', description: 'Дополнительные профили, изображения, релизы и видео.', required: false, secret: true },
  { key: 'MUSICBRAINZ_USER_AGENT', title: 'MusicBrainz User-Agent', provider: 'MusicBrainz', description: 'Контактный User-Agent для корректной работы с MusicBrainz API.', required: false, secret: false },
]

const registryByKey = new Map(integrationRegistry.map((entry) => [entry.key, entry]))
const encryptionKey = (config: AppConfig) => createHash('sha256').update(`shoditsa:pipeline-integrations:v1:${config.pipelineSecretsKey}`).digest()
const suffix = (value: string) => value.trim().slice(-4)
const masked = (value: string, secret: boolean) => secret ? `••••${suffix(value)}` : value.length > 12 ? `${value.slice(0, 8)}…${suffix(value)}` : value

export const encryptIntegrationValue = (value: string, config: AppConfig) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(config), iv)
  const encryptedValue = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return {
    encryptedValue: encryptedValue.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    lastFour: suffix(value),
  }
}

export const decryptIntegrationValue = (row: Pick<typeof integrationSecrets.$inferSelect, 'encryptedValue' | 'iv' | 'authTag'>, config: AppConfig) => {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(config), Buffer.from(row.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(row.authTag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(row.encryptedValue, 'base64')), decipher.final()]).toString('utf8')
}

export const loadIntegrationEnvironment = async (db: Database, config: AppConfig) => {
  const stored = await db.select().from(integrationSecrets)
  const byKey = new Map(stored.map((entry) => [entry.key, entry]))
  return Object.fromEntries(integrationRegistry.flatMap((definition) => {
    const override = byKey.get(definition.key)
    if (override) return [[definition.key, decryptIntegrationValue(override, config)]]
    const environmentValue = process.env[definition.key]?.trim()
    return environmentValue ? [[definition.key, environmentValue]] : []
  })) as Partial<Record<IntegrationKey, string>>
}

export const integrationStatuses = async (db: Database) => {
  const stored = await db.select().from(integrationSecrets)
  const byKey = new Map(stored.map((entry) => [entry.key, entry]))
  return integrationRegistry.map((definition) => {
    const override = byKey.get(definition.key)
    const environmentValue = process.env[definition.key]?.trim() || ''
    const source = override ? 'admin' : environmentValue ? 'environment' : null
    const displayValue = override ? `••••${override.lastFour}` : environmentValue ? masked(environmentValue, definition.secret) : null
    return {
      ...definition,
      configured: Boolean(source),
      source,
      maskedValue: displayValue,
      updatedAt: override?.updatedAt ?? null,
    }
  })
}

export const saveIntegrationSecret = async (db: Database, config: AppConfig, actorId: string, key: IntegrationKey, value: string) => {
  if (!registryByKey.has(key)) throw new Error('Unsupported integration key')
  const encrypted = encryptIntegrationValue(value.trim(), config)
  return (await db.insert(integrationSecrets).values({ key, ...encrypted, updatedBy: actorId })
    .onConflictDoUpdate({ target: integrationSecrets.key, set: { ...encrypted, updatedBy: actorId, updatedAt: new Date() } }).returning())[0]
}

export const deleteIntegrationSecret = async (db: Database, key: IntegrationKey) => {
  return db.delete(integrationSecrets).where(eq(integrationSecrets.key, key)).returning({ key: integrationSecrets.key })
}
