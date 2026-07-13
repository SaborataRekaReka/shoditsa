import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { integrationSecrets, type Database } from '@shoditsa/database'
import type { AppConfig } from '@shoditsa/config'
import type { IntegrationKey } from '@shoditsa/contracts'
import { normalizeMusicProxyUrl } from './music-proxy.js'

export const integrationRegistry: ReadonlyArray<{
  key: IntegrationKey
  title: string
  provider: string
  description: string
  required: boolean
  secret: boolean
}> = [
  { key: 'OPENAI_API_KEY', title: 'OpenAI API key', provider: 'OpenAI', description: 'Поиск контента, фактчекинг и генерация игровых подсказок для музыки, кино и аниме.', required: true, secret: true },
  { key: 'LASTFM_API_KEY', title: 'Last.fm API key', provider: 'Last.fm', description: 'Популярность, теги, похожие исполнители, треки и альбомы.', required: false, secret: true },
  { key: 'SPOTIFY_CLIENT_ID', title: 'Spotify Client ID', provider: 'Spotify', description: 'Идентификатор приложения Spotify Web API.', required: false, secret: false },
  { key: 'SPOTIFY_CLIENT_SECRET', title: 'Spotify Client Secret', provider: 'Spotify', description: 'Секрет приложения Spotify Web API.', required: false, secret: true },
  { key: 'THEAUDIODB_API_KEY', title: 'TheAudioDB API key', provider: 'TheAudioDB', description: 'Дополнительные профили, изображения, релизы и видео.', required: false, secret: true },
  { key: 'MUSICBRAINZ_USER_AGENT', title: 'MusicBrainz User-Agent', provider: 'MusicBrainz', description: 'Контактный User-Agent для корректной работы с MusicBrainz API.', required: false, secret: false },
  { key: 'MUSIC_OUTBOUND_PROXY_URL', title: 'Outbound proxy URL', provider: 'Внешние API', description: 'Доверенный HTTP/HTTPS proxy для OpenAI, MusicBrainz, Last.fm, Spotify и TheAudioDB. Поддерживает авторизацию в URL.', required: false, secret: true },
  { key: 'KINOPOISK_UNOFFICIAL_API_KEY_1', title: 'Ключ №1', provider: 'Кинопоиск Unofficial API', description: 'Первый ключ из пула для импорта и обогащения фильмов и сериалов.', required: false, secret: true },
  { key: 'KINOPOISK_UNOFFICIAL_API_KEY_2', title: 'Ключ №2', provider: 'Кинопоиск Unofficial API', description: 'Второй ключ из пула для импорта и обогащения фильмов и сериалов.', required: false, secret: true },
  { key: 'KINOPOISK_UNOFFICIAL_API_KEY_3', title: 'Ключ №3', provider: 'Кинопоиск Unofficial API', description: 'Третий ключ из пула для импорта и обогащения фильмов и сериалов.', required: false, secret: true },
  { key: 'KINOPOISK_UNOFFICIAL_API_KEY_4', title: 'Ключ №4', provider: 'Кинопоиск Unofficial API', description: 'Четвёртый ключ из пула для импорта и обогащения фильмов и сериалов.', required: false, secret: true },
  { key: 'KINOPOISK_UNOFFICIAL_API_KEY_5', title: 'Ключ №5', provider: 'Кинопоиск Unofficial API', description: 'Пятый ключ из пула для импорта и обогащения фильмов и сериалов.', required: false, secret: true },
  { key: 'SHIKIMORI_USER_AGENT', title: 'User-Agent приложения', provider: 'Shikimori API', description: 'Обязательное имя приложения и контакт для запросов публичного каталога Shikimori.', required: true, secret: false },
  { key: 'SHIKIMORI_CLIENT_ID', title: 'OAuth Client ID', provider: 'Shikimori API', description: 'Идентификатор OAuth-приложения Shikimori; для публичного каталога не обязателен.', required: false, secret: false },
  { key: 'SHIKIMORI_CLIENT_SECRET', title: 'OAuth Client Secret', provider: 'Shikimori API', description: 'Секрет OAuth-приложения Shikimori. Хранится зашифрованно и не возвращается в браузер.', required: false, secret: true },
  { key: 'SHIKIMORI_ACCESS_TOKEN', title: 'OAuth Access Token', provider: 'Shikimori API', description: 'Необязательный Bearer-токен для авторизованных запросов. Публичный каталог работает без него.', required: false, secret: true },
]

const registryByKey = new Map(integrationRegistry.map((entry) => [entry.key, entry]))
const kinopoiskKeySlots = [
  'KINOPOISK_UNOFFICIAL_API_KEY_1', 'KINOPOISK_UNOFFICIAL_API_KEY_2', 'KINOPOISK_UNOFFICIAL_API_KEY_3',
  'KINOPOISK_UNOFFICIAL_API_KEY_4', 'KINOPOISK_UNOFFICIAL_API_KEY_5',
] as const
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
  const environment = Object.fromEntries(integrationRegistry.flatMap((definition) => {
    const override = byKey.get(definition.key)
    if (override) return [[definition.key, decryptIntegrationValue(override, config)]]
    const environmentValue = process.env[definition.key]?.trim()
    return environmentValue ? [[definition.key, environmentValue]] : []
  })) as Record<string, string>
  const legacyKeys = [process.env.KINOPOISK_API_KEYS, process.env.KINOPOISK_API_KEY]
    .flatMap((value) => String(value ?? '').split(/[\n,;\s]+/)).map((value) => value.trim()).filter(Boolean)
  const pool = [...new Set([...kinopoiskKeySlots.map((key) => environment[key]).filter(Boolean), ...legacyKeys])]
  if (pool.length) {
    environment.KINOPOISK_API_KEYS = pool.join(',')
    environment.KINOPOISK_API_KEY = pool[0]
  }
  return environment
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
  const normalizedValue = key === 'MUSIC_OUTBOUND_PROXY_URL' ? normalizeMusicProxyUrl(value) : value.trim()
  const encrypted = encryptIntegrationValue(normalizedValue, config)
  return (await db.insert(integrationSecrets).values({ key, ...encrypted, updatedBy: actorId })
    .onConflictDoUpdate({ target: integrationSecrets.key, set: { ...encrypted, updatedBy: actorId, updatedAt: new Date() } }).returning())[0]
}

export const deleteIntegrationSecret = async (db: Database, key: IntegrationKey) => {
  return db.delete(integrationSecrets).where(eq(integrationSecrets.key, key)).returning({ key: integrationSecrets.key })
}
