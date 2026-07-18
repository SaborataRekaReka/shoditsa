import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import sharp from 'sharp'
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  AdminBlockUserBodySchema, AdminContentItemsQuerySchema, AdminDailyChallengeReplaceBodySchema, AdminEventsQuerySchema, AdminIdParamsSchema, AdminTagCreateBodySchema,
  AnimePipelineEstimateBodySchema, AnimePipelineManualPreviewBodySchema, AnimePipelineRunBodySchema,
  AdminItemParamsSchema, AdminMediaUploadBodySchema, AdminQualityIssuePatchBodySchema, AdminReportBulkResolveBodySchema, AdminReportPatchBodySchema, AdminReportQuerySchema, AdminUserNoteBodySchema,
  AdminUsersQuerySchema, AdminWorkspaceBulkBodySchema, AdminWorkspaceItemBodySchema, ClientEventsBatchBodySchema,
  ContentExchangeExportBodySchema, ContentExchangeImportApplyBodySchema, ContentExchangeImportPreviewBodySchema, ContentExchangeSelectionBodySchema,
  IntegrationKeyParamsSchema, IntegrationSecretUpdateBodySchema, MusicPipelineEstimateBodySchema, MusicPipelineManualPreviewBodySchema,
  MusicPipelineRunBodySchema, MoviePipelineEstimateBodySchema, MoviePipelineManualPreviewBodySchema, MoviePipelineRunBodySchema,
  NormalizationPipelineEstimateBodySchema, NormalizationPipelineRunBodySchema,
  PipelineApprovalBodySchema, PipelineBulkDecisionBodySchema, PipelineItemDecisionBodySchema,
  UuidSchema,
  type AdminBlockUserBody, type AdminContentItemsQuery, type AdminDailyChallengeReplaceBody, type AdminEventsQuery, type AdminReportPatchBody, type AdminTagCreateBody,
  type AdminMediaUploadBody, type AdminQualityIssuePatchBody, type AdminReportBulkResolveBody, type AdminReportQuery, type AdminUserNoteBody, type AdminUsersQuery, type AdminWorkspaceBulkBody,
  type AdminWorkspaceItemBody, type ClientEventsBatchBody, type ContentMode, type IntegrationKey, type IntegrationSecretUpdateBody,
  type ContentExchangeExportBody, type ContentExchangeImportApplyBody, type ContentExchangeImportPreviewBody, type ContentExchangeSelectionBody,
  type AnimePipelineEstimateBody, type AnimePipelineManualPreviewBody, type AnimePipelineRunBody,
  type MusicPipelineEstimateBody, type MusicPipelineManualPreviewBody, type MusicPipelineRunBody,
  type MoviePipelineEstimateBody, type MoviePipelineManualPreviewBody, type MoviePipelineRunBody,
  type NormalizationPipelineEstimateBody, type NormalizationPipelineRunBody,
  type PipelineApprovalBody, type PipelineBulkDecisionBody, type PipelineItemDecisionBody,
} from '@shoditsa/contracts'
import { Type } from '@sinclair/typebox'
import type { AppConfig } from '@shoditsa/config'
import {
  account, adminUserNotes, appSettings, attendanceStats, auditLog, authEvents, backgroundJobs, clientEvents,
  contentAliases, contentItems, contentItemTags, contentItemVersions, contentQualityIssues, contentReports, contentReviewDecisions, contentRevisionModes, contentTags,
  contentRevisions, contentWorkspaceChanges, contentWorkspaces, dailyAttendance, dailyChallenges, gameAttempts, gameHintChoices,
  gameSessions, legacyImports, periodEntitlements, pipelineRunItems, pipelineRuns, playerProfiles, promoCodes,
  promoRedemptions, session, user, userModeStats, walletAccounts, walletLedger, type Database,
} from '@shoditsa/database'
import type { Auth } from '../auth/auth.js'
import { getRequestUser, requireAdmin } from '../auth/session.js'
import { ApiError, requireIdempotencyKey } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import {
  activateWorkspaceRevision, blockingContentValidationIssues, buildWorkspaceRevision, contentPayloadsEqual, discardWorkspaceItem,
  getOrCreateWorkspace, loadWorkspaceChanges, saveWorkspaceItem, validateWorkspace, workspaceSummary,
} from './content-service.js'
import { applyContentExchangeImport, describeContentExchangeSelection, exportContentExchange, previewContentExchangeImport } from './content-exchange.js'
import { loadAdminTimeline } from './timeline-service.js'
import { deleteIntegrationSecret, integrationStatuses, loadIntegrationEnvironment, saveIntegrationSecret } from './integration-secrets.js'
import { normalizeMusicProxyUrl } from './music-proxy.js'
import { normalizeMovieTitle } from './movie-search.js'
import { inspectReleaseContent } from './release-content-service.js'
import {
  assertNormalizationField, assertNormalizationTemplate, buildNormalizationCardContext, normalizationContextOptions,
  normalizationDefaultContextFields, normalizationFields, normalizationTemplateVariables, renderNormalizationPrompt,
} from './normalization-pipeline.js'

type Deps = { db: Database; auth: Auth; config: AppConfig }
type AdminActor = Awaited<ReturnType<typeof requireAdmin>>

const admin = async (request: FastifyRequest, reply: FastifyReply, deps: Deps) => {
  reply.header('Cache-Control', 'no-store')
  return requireAdmin(request, deps.auth, deps.db, deps.config)
}
const params = Type.Object({ id: UuidSchema }, { additionalProperties: false })
const itemParams = Type.Object({ itemId: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false })
const runItemParams = Type.Object({ id: UuidSchema, itemId: UuidSchema }, { additionalProperties: false })
const idempotencyHeaders = Type.Object({ 'idempotency-key': UuidSchema }, { additionalProperties: true })
const asRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const rows = <T>(value: unknown) => Array.from(value as Iterable<T>)
const batches = <T>(values: T[], size: number) => Array.from(
  { length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, (index + 1) * size),
)
const pipelineFieldDecisions = (item: { beforeJson: unknown; proposedJson: unknown }, approved: boolean) => {
  const before = asRecord(item.beforeJson)
  const proposed = asRecord(item.proposedJson)
  const fields = [...new Set([...Object.keys(before), ...Object.keys(proposed)])]
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(proposed[field]))
  return Object.fromEntries(fields.map((field) => [field, { action: approved ? 'accept' : 'keep' }]))
}
const pipelineItemHasResult = (item: { proposedJson: unknown }) => Boolean(item.proposedJson && typeof item.proposedJson === 'object' && !Array.isArray(item.proposedJson))
const persistAdminMedia = async (body: AdminMediaUploadBody, config: AppConfig) => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64) || body.base64.length % 4 !== 0) throw new ApiError(422, 'MEDIA_BASE64_INVALID', 'Файл изображения повреждён')
  const input = Buffer.from(body.base64, 'base64')
  if (!input.length || input.length > 5 * 1024 * 1024) throw new ApiError(413, 'MEDIA_TOO_LARGE', 'Размер изображения не должен превышать 5 МБ')
  const image = sharp(input, { failOn: 'warning', limitInputPixels: 40_000_000 }).rotate()
  const metadata = await image.metadata().catch(() => null)
  if (!metadata?.width || !metadata.height || metadata.width < 320 || metadata.height < 180) throw new ApiError(422, 'MEDIA_RESOLUTION_TOO_SMALL', 'Минимальное разрешение изображения — 320×180')
  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) throw new ApiError(422, 'MEDIA_FORMAT_UNSUPPORTED', 'Допустимы JPEG, PNG и WebP')
  const output = await image.webp({ quality: 88, effort: 4 }).toBuffer()
  const digest = createHash('sha256').update(output).digest('hex'); const directory = join(config.mediaRoot, 'admin', digest.slice(0, 2)); const file = join(directory, `${digest}.webp`)
  await mkdir(directory, { recursive: true })
  await writeFile(file, output, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
  const base = config.publicMediaBaseUrl.replace(/\/$/, '')
  return { url: `${base}/admin/${digest.slice(0, 2)}/${digest}.webp`, width: metadata.width, height: metadata.height, bytes: output.length, digest, sourceExtension: extname(body.fileName).toLocaleLowerCase('en-US') }
}
const assertPipelineItemReviewable = (item: { id: string; status: string; workspaceChangeId: string | null; appliedRevisionId: string | null }) => {
  if (item.workspaceChangeId || item.appliedRevisionId || ['staged', 'published'].includes(item.status)) {
    throw new ApiError(409, 'PIPELINE_ITEM_ALREADY_APPLIED', 'Опубликованный или перенесённый в рабочую область результат нельзя пересмотреть', { itemId: item.id })
  }
}
const assertPipelineItemDecidable = (item: { id: string; status: string; proposedJson: unknown; workspaceChangeId: string | null; appliedRevisionId: string | null }) => {
  assertPipelineItemReviewable(item)
  if (!['review_required', 'approved', 'rejected'].includes(item.status) || !pipelineItemHasResult(item)) {
    throw new ApiError(409, 'PIPELINE_ITEM_NOT_DECIDABLE', 'Неуспешный или пустой результат нельзя одобрить. Перегенерируйте айтем или оставьте его в статусе ошибки.', { itemId: item.id, status: item.status })
  }
}
const posterOf = (payload: unknown) => {
  const record = asRecord(payload)
  return typeof record.posterUrl === 'string' ? record.posterUrl : typeof record.headerUrl === 'string' ? record.headerUrl : null
}
type CompletionField = { label: string; present: (payload: Record<string, unknown>) => boolean }

const hasTextValue = (value: unknown) => typeof value === 'string' && value.trim().length > 0
const numericContentFilterFields = new Set([
  'reports', 'issues', 'year', 'activityStartYear', 'endYear', 'runtime', 'runtimeMinutes',
  'kinopoiskId', 'episodes', 'seasonsCount', 'episodesAired', 'animeEpisodesAired',
  'shikimoriId', 'shikimoriScore', 'steamAppId', 'metacritic',
])

const hasContentValue = (value: unknown): boolean => {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.some((entry) => hasContentValue(entry))
  if (typeof value === 'object') return Object.values(asRecord(value)).some((entry) => hasContentValue(entry))
  return false
}

const valueFromKeys = (payload: Record<string, unknown>, keys: string[]) => keys.some((key) => hasContentValue(payload[key]))

const COMPLETION_COMMON_FIELDS: CompletionField[] = [
  { label: 'Русское название', present: (payload) => hasTextValue(payload.titleRu) },
  { label: 'Оригинальное название', present: (payload) => hasTextValue(payload.titleOriginal) },
  { label: 'Альтернативные названия', present: (payload) => hasContentValue(payload.alternativeTitles) },
  { label: 'Подсказка', present: (payload) => hasTextValue(payload.plotHint) || hasTextValue(payload.description) },
  { label: 'Постер', present: (payload) => valueFromKeys(payload, ['posterUrl', 'headerUrl', 'backdropUrl']) },
  { label: 'Жанры', present: (payload) => hasContentValue(payload.genres) },
]

const COMPLETION_MODE_FIELDS: Record<ContentMode, CompletionField[]> = {
  movie: [
    { label: 'Год', present: (payload) => hasContentValue(payload.year) },
    { label: 'Страна', present: (payload) => valueFromKeys(payload, ['countries', 'country']) },
    { label: 'Рейтинг Кинопоиска', present: (payload) => valueFromKeys(payload, ['kp', 'kpRating', 'kinopoiskRating']) },
  ],
  series: [
    { label: 'Год', present: (payload) => hasContentValue(payload.year) },
    { label: 'Страна', present: (payload) => valueFromKeys(payload, ['countries', 'country']) },
    { label: 'Сезоны', present: (payload) => hasContentValue(payload.seasons) || hasContentValue(payload.seasonsCount) },
  ],
  anime: [
    { label: 'Год', present: (payload) => hasContentValue(payload.year) },
    { label: 'Эпизоды', present: (payload) => hasContentValue(payload.episodes) || hasContentValue(payload.episodesAired) },
    { label: 'Студия', present: (payload) => valueFromKeys(payload, ['studio', 'studios']) },
  ],
  game: [
    { label: 'Платформы', present: (payload) => hasContentValue(payload.platforms) },
    { label: 'Разработчики', present: (payload) => valueFromKeys(payload, ['developers', 'developer']) },
    { label: 'Издатели', present: (payload) => valueFromKeys(payload, ['publishers', 'publisher']) },
  ],
  music: [
    { label: 'Страна', present: (payload) => valueFromKeys(payload, ['countries', 'country']) },
    { label: 'Топ-треки', present: (payload) => hasContentValue(payload.topTracks) },
    { label: 'Топ-альбомы', present: (payload) => hasContentValue(payload.topAlbums) },
  ],
  diagnosis: [
    { label: 'МКБ / группа', present: (payload) => valueFromKeys(payload, ['icd10', 'icdGroup']) },
    { label: 'Системы организма', present: (payload) => hasContentValue(payload.bodySystems) },
    { label: 'Симптомы', present: (payload) => valueFromKeys(payload, ['keySymptoms', 'symptoms']) },
  ],
  city: [
    { label: 'Страна', present: (payload) => hasTextValue(payload.country) },
    { label: 'Континент', present: (payload) => hasTextValue(payload.continent) },
    { label: 'Население', present: (payload) => hasContentValue(payload.population) },
    { label: 'Герб / флаг', present: (payload) => valueFromKeys(payload, ['coatOfArmsUrl', 'cityFlagUrl', 'countryFlagUrl']) },
  ],
}

const completionMeta = (payload: unknown, mode: ContentMode) => {
  const record = asRecord(payload)
  const fields = [...COMPLETION_COMMON_FIELDS, ...(COMPLETION_MODE_FIELDS[mode] ?? [])]
  const missingFields = fields.filter((field) => !field.present(record)).map((field) => field.label)
  const fieldsTotal = fields.length
  const fieldsFilled = fieldsTotal - missingFields.length
  const completeness = fieldsTotal > 0 ? Math.round(fieldsFilled / fieldsTotal * 100) : 0
  const hasHint = hasTextValue(record.plotHint) || hasTextValue(record.description)
  return { completeness, fieldsFilled, fieldsTotal, missingFields, hasHint }
}

const normalizeArtistName = (value: unknown) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU')
  .replaceAll('ё', 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim()

const previewManualArtists = async (db: Database, artists: MusicPipelineManualPreviewBody['artists']) => {
  const activeMusic = await db.select({ itemId: contentItemVersions.itemId, titleRu: contentItemVersions.titleRu, titleOriginal: contentItemVersions.titleOriginal, payload: contentItemVersions.payload })
    .from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
    .where(and(eq(contentRevisions.status, 'active'), eq(contentItemVersions.mode, 'music')))
  const existing = new Map<string, { itemId: string; title: string }>()
  for (const card of activeMusic) {
    const payload = asRecord(card.payload)
    const names = [card.titleRu, card.titleOriginal, ...(['aliases', 'alternativeTitles'].flatMap((field) => Array.isArray(payload[field]) ? payload[field] as unknown[] : []))]
    for (const name of names) {
      const normalized = normalizeArtistName(name)
      if (normalized && !existing.has(normalized)) existing.set(normalized, { itemId: card.itemId, title: card.titleRu })
    }
  }
  const seen = new Set<string>()
  const items = artists.map((entry, index) => {
    const artist = entry.artist.trim(); const normalized = normalizeArtistName(artist); const match = existing.get(normalized)
    const status = !normalized ? 'invalid' : seen.has(normalized) ? 'duplicate_input' : match ? 'existing_card' : 'ready'
    if (normalized) seen.add(normalized)
    return { index, artist, country: entry.country?.trim() || null, hint: entry.hint?.trim() || null, normalized, status, existingItemId: match?.itemId ?? null, existingTitle: match?.title ?? null }
  })
  return {
    items,
    summary: {
      total: items.length,
      ready: items.filter((entry) => entry.status === 'ready').length,
      duplicates: items.filter((entry) => entry.status === 'duplicate_input').length,
      existing: items.filter((entry) => entry.status === 'existing_card').length,
      invalid: items.filter((entry) => entry.status === 'invalid').length,
    },
  }
}

const previewManualMovies = async (db: Database, movies: MoviePipelineManualPreviewBody['movies']) => {
  const activeMovies = await db.select({
    itemId: contentItemVersions.itemId,
    titleRu: contentItemVersions.titleRu,
    titleOriginal: contentItemVersions.titleOriginal,
    year: contentItemVersions.year,
    payload: contentItemVersions.payload,
  })
    .from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
    .where(and(eq(contentRevisions.status, 'active'), eq(contentItemVersions.mode, 'movie')))
  const existing = new Map<number, { itemId: string; title: string }>()
  const existingByTitle = new Map<string, Array<{ itemId: string; title: string; year: number | null }>>()
  for (const card of activeMovies) {
    const payload = asRecord(card.payload)
    const kinopoiskId = Number(payload.kinopoiskId)
    if (Number.isInteger(kinopoiskId) && kinopoiskId > 0) existing.set(kinopoiskId, { itemId: card.itemId, title: card.titleRu })
    const aliases = Array.isArray(payload.alternativeTitles) ? payload.alternativeTitles : []
    for (const rawTitle of [card.titleRu, card.titleOriginal, ...aliases]) {
      const normalized = normalizeMovieTitle(rawTitle)
      if (!normalized) continue
      const matches = existingByTitle.get(normalized) ?? []
      if (!matches.some((entry) => entry.itemId === card.itemId)) matches.push({ itemId: card.itemId, title: card.titleRu, year: card.year })
      existingByTitle.set(normalized, matches)
    }
  }
  const seen = new Set<string>()
  const items = movies.map((entry, index) => {
    const source = asRecord(entry)
    const directId = Number(source.kinopoiskId)
    if (Number.isSafeInteger(directId) && directId > 0) {
      const match = existing.get(directId); const identity = `id:${directId}`
      const status = seen.has(identity) ? 'duplicate_input' : match ? 'existing_card' : 'ready'
      seen.add(identity)
      return { index, kinopoiskId: directId, hint: typeof source.hint === 'string' ? source.hint.trim() || null : null, query: null, requestedYear: null, status, existingItemId: match?.itemId ?? null, existingTitle: match?.title ?? null }
    }
    const query = typeof source.query === 'string' ? source.query.trim() : ''
    const requestedYear = Number.isInteger(source.year) ? Number(source.year) : null
    const normalized = normalizeMovieTitle(query); const identity = `query:${normalized}:${requestedYear ?? ''}`
    const titleMatches = existingByTitle.get(normalized) ?? []
    const match = requestedYear ? titleMatches.find((entry) => entry.year === requestedYear) : titleMatches[0]
    const status = !normalized ? 'invalid' : seen.has(identity) ? 'duplicate_input' : match ? 'existing_card' : 'ready'
    if (normalized) seen.add(identity)
    return { index, kinopoiskId: null, hint: null, query, requestedYear, status, existingItemId: match?.itemId ?? null, existingTitle: match?.title ?? null }
  })
  return {
    items,
    summary: {
      total: items.length,
      ready: items.filter((entry) => entry.status === 'ready').length,
      duplicates: items.filter((entry) => entry.status === 'duplicate_input').length,
      existing: items.filter((entry) => entry.status === 'existing_card').length,
      invalid: items.filter((entry) => entry.status === 'invalid').length,
    },
  }
}

const previewManualAnime = async (db: Database, anime: AnimePipelineManualPreviewBody['anime']) => {
  const activeAnime = await db.select({ itemId: contentItemVersions.itemId, titleRu: contentItemVersions.titleRu, payload: contentItemVersions.payload })
    .from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
    .where(and(eq(contentRevisions.status, 'active'), eq(contentItemVersions.mode, 'anime')))
  const existing = new Map<number, { itemId: string; title: string }>()
  for (const card of activeAnime) {
    const shikimoriId = Number(asRecord(card.payload).shikimoriId)
    if (Number.isInteger(shikimoriId) && shikimoriId > 0) existing.set(shikimoriId, { itemId: card.itemId, title: card.titleRu })
  }
  const seen = new Set<number>()
  const items = anime.map((entry, index) => {
    const shikimoriId = Number(entry.shikimoriId); const match = existing.get(shikimoriId)
    const status = !Number.isInteger(shikimoriId) || shikimoriId <= 0 ? 'invalid' : seen.has(shikimoriId) ? 'duplicate_input' : match ? 'existing_card' : 'ready'
    if (Number.isInteger(shikimoriId) && shikimoriId > 0) seen.add(shikimoriId)
    return { index, shikimoriId, hint: entry.hint?.trim() || null, status, existingItemId: match?.itemId ?? null, existingTitle: match?.title ?? null }
  })
  return {
    items,
    summary: {
      total: items.length,
      ready: items.filter((entry) => entry.status === 'ready').length,
      duplicates: items.filter((entry) => entry.status === 'duplicate_input').length,
      existing: items.filter((entry) => entry.status === 'existing_card').length,
      invalid: items.filter((entry) => entry.status === 'invalid').length,
    },
  }
}

const itemSchema = (mode: string) => ({
  mode,
  groups: [
    { key: 'identity', title: 'Идентификация и названия', fields: ['id', 'mode', 'titleRu', 'titleOriginal', 'alternativeTitles'] },
    { key: 'game', title: 'Игровые данные и подсказки', fields: [...(mode === 'music' ? ['activityStartYear'] : ['year']), 'endYear', 'plotHint', 'slogan', 'facts', 'genres', 'allowedInGame'] },
    { key: 'media', title: 'Медиа', fields: ['posterUrl', 'headerUrl', 'backdropUrl', 'screenshots'] },
    ...(mode === 'movie' ? [{ key: 'movie', title: 'Кино', fields: ['runtime', 'ageRating', 'budget', 'directors', 'writers', 'cast', 'kinopoiskId', 'imdbId', 'ratings', 'awards'] }] : []),
    ...(mode === 'series' ? [{ key: 'series', title: 'Сериал', fields: ['episodes', 'seasonsCount', 'seriesStatus', 'showrunners', 'writers', 'cast', 'kinopoiskId', 'imdbId'] }] : []),
    ...(mode === 'anime' ? [{ key: 'anime', title: 'Аниме', fields: ['kind', 'status', 'episodes', 'episodesAired', 'source', 'studios', 'shikimoriId', 'shikimoriScore', 'shikimoriUrl'] }] : []),
    ...(mode === 'game' ? [{ key: 'gameMeta', title: 'Игра', fields: ['developers', 'publishers', 'platforms', 'steamCategories', 'steamTags', 'steamAppId', 'steamUrl', 'price', 'metacritic'] }] : []),
    ...(mode === 'music' ? [{ key: 'music', title: 'Музыка', fields: ['canonicalId', 'aliases', 'gameTier', 'contentStatus', 'musicIsActive', 'musicOrigin', 'musicType', 'topTracks', 'topAlbums', 'similarArtists', 'members', 'associatedActs', 'musicLinks', 'dataQuality'] }] : []),
    ...(mode === 'diagnosis' ? [{ key: 'diagnosis', title: 'Диагноз', fields: ['icd10', 'icdGroup', 'bodySystems', 'diseaseTypes', 'course', 'contagiousness', 'symptoms', 'diagnostics', 'risks', 'severity', 'urgency', 'safetyDisclaimer', 'caseVignettes'] }] : []),
  ],
})

const registerContentRoutes = (app: FastifyInstance, deps: Deps) => {
  const tagIds = (value?: string) => [...new Set((value ?? '').split(',').map((entry) => entry.trim()).filter((entry) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(entry)))]

  app.get('/api/v1/admin/content/tags', async (request, reply) => {
    await admin(request, reply, deps)
    return { items: await deps.db.select({ id: contentTags.id, name: contentTags.name, slug: contentTags.slug, color: contentTags.color, itemsCount: sql<number>`count(${contentItemTags.itemId})::int` })
      .from(contentTags).leftJoin(contentItemTags, eq(contentItemTags.tagId, contentTags.id)).groupBy(contentTags.id).orderBy(asc(contentTags.name)) }
  })

  app.post('/api/v1/admin/content/tags', { schema: { body: AdminTagCreateBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const body = request.body as AdminTagCreateBody
    const name = body.name.trim().replace(/\s+/g, ' ')
    if (!name) throw new ApiError(422, 'CONTENT_TAG_NAME_REQUIRED', 'Введите название тега')
    const base = name.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]+/gu, '').replace(/^-+|-+$/g, '') || 'tag'
    const slug = `${base}-${createHash('sha256').update(name.toLocaleLowerCase('ru-RU')).digest('hex').slice(0, 8)}`
    try {
      const created = (await deps.db.insert(contentTags).values({ name, slug, color: body.color ?? '#6b7280', createdBy: actor.id }).returning())[0]
      await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'content.tag.create', entityType: 'content_tag', entityId: created.id, before: null, after: created, requestId: request.id })
      return reply.code(201).send(created)
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'CONTENT_TAG_EXISTS', 'Тег с таким названием уже существует')
      throw error
    }
  })

  app.get('/api/v1/admin/content/items', { schema: { querystring: AdminContentItemsQuerySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const query = request.query as AdminContentItemsQuery
    const active = (await deps.db.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
    if (!active) return { items: [], nextCursor: null, total: 0, filters: query }
    const workspace = await getOrCreateWorkspace(deps.db, actor)
    const effectivePayload = sql<Record<string, unknown>>`coalesce((select cwc.after_payload from content_workspace_changes cwc where cwc.workspace_id = ${workspace.id} and cwc.item_id = ${contentItemVersions.itemId} limit 1), ${contentItemVersions.payload})`
    const openQualityIssueExists = sql`exists (select 1 from content_quality_issues qi where qi.item_id = ${contentItemVersions.itemId} and qi.status = 'open')`
    const previewReviewIssueExists = sql`exists (select 1 from content_review_decisions crd where crd.item_id = ${contentItemVersions.itemId} and crd.field = '__card_preview__' and crd.decision @> '{"approved":false}'::jsonb)`
    const anyIssueExists = sql`(${openQualityIssueExists} or ${previewReviewIssueExists})`
    const issuesCount = sql<number>`((select count(*) from content_quality_issues qi where qi.item_id = ${contentItemVersions.itemId} and qi.status = 'open') + case when ${previewReviewIssueExists} then 1 else 0 end)::int`
    const filters = [eq(contentItemVersions.revisionId, active.id)]
    if (query.mode) filters.push(eq(contentItemVersions.mode, query.mode))
    if (query.publication === 'published') filters.push(eq(contentItemVersions.allowedInGame, true))
    if (query.publication === 'hidden') filters.push(eq(contentItemVersions.allowedInGame, false))
    if (query.hasReports === true) filters.push(sql`exists (select 1 from content_reports cr where cr.item_id = ${contentItemVersions.itemId} and cr.status in ('open','in_progress'))`)
    if (query.hasReports === false) filters.push(sql`not exists (select 1 from content_reports cr where cr.item_id = ${contentItemVersions.itemId} and cr.status in ('open','in_progress'))`)
    if (query.hasIssues === true) filters.push(anyIssueExists)
    if (query.hasIssues === false) filters.push(sql`not (${anyIssueExists})`)
    if (query.hasHint === true) filters.push(sql`coalesce(nullif(trim(${effectivePayload}->>'plotHint'), ''), nullif(trim(${effectivePayload}->>'description'), '')) is not null`)
    if (query.hasHint === false) filters.push(sql`coalesce(nullif(trim(${effectivePayload}->>'plotHint'), ''), nullif(trim(${effectivePayload}->>'description'), '')) is null`)
    if (query.source) filters.push(sql`exists (select 1 from content_workspace_changes cwc where cwc.item_id = ${contentItemVersions.itemId} and cwc.source = ${query.source})`)
    if (query.pipelineKey) filters.push(sql`exists (select 1 from content_workspace_changes cwc inner join pipeline_runs pr on pr.id = cwc.pipeline_run_id where cwc.item_id = ${contentItemVersions.itemId} and pr.pipeline_key = ${query.pipelineKey})`)
    const includedTags = tagIds(query.includeTagIds); const excludedTags = tagIds(query.excludeTagIds)
    if (includedTags.length && query.tagMatch === 'any') filters.push(sql`exists (select 1 from content_item_tags cit where cit.item_id = ${contentItemVersions.itemId} and cit.tag_id in (${sql.join(includedTags.map((id) => sql`${id}::uuid`), sql`, `)}))`)
    if (includedTags.length && query.tagMatch !== 'any') filters.push(sql`(select count(distinct cit.tag_id)::int from content_item_tags cit where cit.item_id = ${contentItemVersions.itemId} and cit.tag_id in (${sql.join(includedTags.map((id) => sql`${id}::uuid`), sql`, `)})) = ${includedTags.length}`)
    if (excludedTags.length) filters.push(sql`not exists (select 1 from content_item_tags cit where cit.item_id = ${contentItemVersions.itemId} and cit.tag_id in (${sql.join(excludedTags.map((id) => sql`${id}::uuid`), sql`, `)}))`)
    if (query.q?.trim()) {
      const raw = query.q.trim(); const exact = raw.length > 1 && raw.startsWith('"') && raw.endsWith('"')
      const needle = raw.replace(/^"|"$/g, '').replaceAll('ё', 'е').replaceAll('Ё', 'Е')
      filters.push(exact
        ? sql`(replace(lower(${contentItemVersions.titleRu}), 'ё', 'е') = replace(lower(${needle}), 'ё', 'е') or replace(lower(${contentItemVersions.titleOriginal}), 'ё', 'е') = replace(lower(${needle}), 'ё', 'е') or ${contentItemVersions.itemId} = ${needle})`
        : sql`(replace(lower(${contentItemVersions.titleRu}), 'ё', 'е') like ${`%${needle.toLocaleLowerCase('ru-RU')}%`} or replace(lower(${contentItemVersions.titleOriginal}), 'ё', 'е') like ${`%${needle.toLocaleLowerCase('ru-RU')}%`} or ${contentItemVersions.itemId} ilike ${`%${needle}%`} or replace(lower(coalesce(${effectivePayload}->>'alternativeTitles', '')), 'ё', 'е') like ${`%${needle.toLocaleLowerCase('ru-RU')}%`} or replace(lower(coalesce(${effectivePayload}->>'aliases', '')), 'ё', 'е') like ${`%${needle.toLocaleLowerCase('ru-RU')}%`})`)
    }
    const fieldOperator = query.fieldOp ?? 'contains'
    const fieldValue = query.fieldQ?.trim() ?? ''
    const fieldOperatorNeedsValue = !['empty', 'not_empty', 'is_true', 'is_false'].includes(fieldOperator)
    if (query.field && (!fieldOperatorNeedsValue || fieldValue)) {
      const field = query.field
      const serviceFields = new Set(['all', 'title', 'id', 'mode', 'publicationStatus', 'allowedInGame', 'changeSource', 'pipeline', 'tags', 'allHints', 'reports', 'issues'])
      const isPayloadField = !serviceFields.has(field)
      const fieldText = field === 'all' ? sql<string>`concat_ws(' ',
        ${contentItemVersions.itemId}, ${contentItemVersions.titleRu}, ${contentItemVersions.titleOriginal}, ${contentItemVersions.mode}::text,
        case when ${contentItemVersions.allowedInGame} then 'в игре active published true да разрешена' else 'скрыта hidden blocked false нет запрещена' end,
        ${effectivePayload}::text,
        coalesce((select string_agg(ct.name, ' ') from content_item_tags cit join content_tags ct on ct.id = cit.tag_id where cit.item_id = ${contentItemVersions.itemId}), ''),
        coalesce((select cwc.source from content_workspace_changes cwc where cwc.item_id = ${contentItemVersions.itemId} order by cwc."updatedAt" desc limit 1), ''),
        coalesce((select pr.pipeline_key from content_workspace_changes cwc join pipeline_runs pr on pr.id = cwc.pipeline_run_id where cwc.item_id = ${contentItemVersions.itemId} order by cwc."updatedAt" desc limit 1), '')
      )`
        : field === 'title' ? sql<string>`concat_ws(' ', ${contentItemVersions.titleRu}, ${contentItemVersions.titleOriginal}, ${effectivePayload}->>'alternativeTitles', ${effectivePayload}->>'aliases')`
          : field === 'id' ? sql<string>`${contentItemVersions.itemId}`
            : field === 'mode' ? sql<string>`concat_ws(' ', ${contentItemVersions.mode}::text, case ${contentItemVersions.mode} when 'movie' then 'кино' when 'series' then 'сериалы' when 'anime' then 'аниме' when 'game' then 'игры' when 'music' then 'музыка' when 'diagnosis' then 'диагнозы' end)`
              : field === 'publicationStatus' || field === 'allowedInGame' ? sql<string>`case when coalesce((${effectivePayload}->>'allowedInGame')::boolean, ${contentItemVersions.allowedInGame}) then 'true да yes 1 в игре active published разрешена' else 'false нет no 0 скрыта hidden blocked запрещена' end`
                : field === 'changeSource' ? sql<string>`coalesce((select cwc.source from content_workspace_changes cwc where cwc.item_id = ${contentItemVersions.itemId} order by cwc."updatedAt" desc limit 1), '')`
                  : field === 'pipeline' ? sql<string>`coalesce((select pr.pipeline_key from content_workspace_changes cwc join pipeline_runs pr on pr.id = cwc.pipeline_run_id where cwc.item_id = ${contentItemVersions.itemId} order by cwc."updatedAt" desc limit 1), '')`
                    : field === 'tags' ? sql<string>`coalesce((select string_agg(ct.name, ' ') from content_item_tags cit join content_tags ct on ct.id = cit.tag_id where cit.item_id = ${contentItemVersions.itemId}), '')`
                      : field === 'allHints' ? sql<string>`concat_ws(' ', ${effectivePayload}->>'plotHint', ${effectivePayload}->>'description', ${effectivePayload}->>'facts', ${effectivePayload}->>'slogan')`
                        : field === 'reports' ? sql<string>`(select count(*)::text from content_reports cr where cr.item_id = ${contentItemVersions.itemId} and cr.status in ('open','in_progress'))`
                          : field === 'issues' ? sql<string>`(${issuesCount})::text`
                            : sql<string>`coalesce(${effectivePayload}->>(${field}::text), '')`
      const normalizedFieldText = sql<string>`replace(lower(trim(coalesce(${fieldText}, ''))), 'ё', 'е')`
      const fieldNeedle = fieldValue.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е')
      const payloadJson = sql`${effectivePayload}->(${field}::text)`
      const isEmpty = isPayloadField
        ? sql`(${payloadJson} is null or ${payloadJson} = 'null'::jsonb or ${payloadJson} = '[]'::jsonb or ${payloadJson} = '{}'::jsonb or (jsonb_typeof(${payloadJson}) = 'string' and trim(coalesce(${fieldText}, '')) = ''))`
        : sql`trim(coalesce(${fieldText}, '')) = ''`
      if (fieldOperator === 'empty') filters.push(isEmpty)
      else if (fieldOperator === 'not_empty') filters.push(sql`not (${isEmpty})`)
      else if (fieldOperator === 'equals') filters.push(sql`${normalizedFieldText} = ${fieldNeedle}`)
      else if (fieldOperator === 'not_equals') filters.push(sql`${normalizedFieldText} <> ${fieldNeedle}`)
      else if (fieldOperator === 'not_contains') filters.push(sql`position(${fieldNeedle} in ${normalizedFieldText}) = 0`)
      else if (fieldOperator === 'starts_with') filters.push(sql`left(${normalizedFieldText}, length(${fieldNeedle})) = ${fieldNeedle}`)
      else if (fieldOperator === 'ends_with') filters.push(sql`right(${normalizedFieldText}, length(${fieldNeedle})) = ${fieldNeedle}`)
      else if (fieldOperator === 'is_true') filters.push(sql`position(' true ' in concat(' ', ${normalizedFieldText}, ' ')) > 0`)
      else if (fieldOperator === 'is_false') filters.push(sql`position(' false ' in concat(' ', ${normalizedFieldText}, ' ')) > 0`)
      else if (['gt', 'gte', 'lt', 'lte'].includes(fieldOperator)) {
        const numericNeedle = Number(fieldValue.replaceAll(' ', '').replace(',', '.'))
        const compareAsNumber = numericContentFilterFields.has(field)
        if (!Number.isFinite(numericNeedle) || (!compareAsNumber && numericNeedle < 0)) throw new ApiError(422, 'CONTENT_FIELD_FILTER_VALUE_INVALID', compareAsNumber ? 'Введите число' : 'Введите длину 0 или больше')
        const comparableField = compareAsNumber
          ? sql`case when trim(${fieldText}) ~ '^-?([0-9]+([.][0-9]*)?|[.][0-9]+)$' then (trim(${fieldText}))::numeric else null end`
          : sql`char_length(trim(coalesce(${fieldText}, '')))::numeric`
        if (fieldOperator === 'gt') filters.push(sql`${comparableField} > ${numericNeedle}`)
        if (fieldOperator === 'gte') filters.push(sql`${comparableField} >= ${numericNeedle}`)
        if (fieldOperator === 'lt') filters.push(sql`${comparableField} < ${numericNeedle}`)
        if (fieldOperator === 'lte') filters.push(sql`${comparableField} <= ${numericNeedle}`)
      } else filters.push(sql`position(${fieldNeedle} in ${normalizedFieldText}) > 0`)
    }
    const tagOffset = query.sort === 'tag' && query.cursor?.startsWith('tag:') ? Math.max(0, Number(query.cursor.slice(4)) || 0) : 0
    if (query.cursor && query.sort !== 'tag') filters.push(gt(contentItemVersions.itemId, query.cursor))
    const limit = query.limit ?? 40
    const orderField = query.sort === 'id' ? contentItemVersions.itemId
      : query.sort === 'createdAt' ? contentItemVersions.createdAt
        : query.sort === 'title' ? contentItemVersions.titleRu
          : query.sort === 'tag' ? sql<string>`coalesce((select min(lower(ct.name)) from content_item_tags cit join content_tags ct on ct.id = cit.tag_id where cit.item_id = ${contentItemVersions.itemId}), '')`
          : contentItemVersions.itemId
    const order = query.order === 'desc' ? desc(orderField) : asc(orderField)
    const selected = await deps.db.select({
      id: contentItemVersions.itemId, versionId: contentItemVersions.id, mode: contentItemVersions.mode,
      titleRu: contentItemVersions.titleRu, titleOriginal: contentItemVersions.titleOriginal, year: contentItemVersions.year,
      payload: contentItemVersions.payload, allowedInGame: contentItemVersions.allowedInGame,
      source: sql<string | null>`(select cwc.source from content_workspace_changes cwc where cwc.item_id = ${contentItemVersions.itemId} order by cwc."updatedAt" desc limit 1)`,
      pipelineKey: sql<string | null>`(select pr.pipeline_key from content_workspace_changes cwc inner join pipeline_runs pr on pr.id = cwc.pipeline_run_id where cwc.item_id = ${contentItemVersions.itemId} order by cwc."updatedAt" desc limit 1)`,
      updatedAt: sql<Date>`coalesce((select cwc."updatedAt" from content_workspace_changes cwc where cwc.item_id = ${contentItemVersions.itemId} order by cwc."updatedAt" desc limit 1), ${contentItemVersions.createdAt})`,
      reportsCount: sql<number>`(select count(*)::int from content_reports cr where cr.item_id = ${contentItemVersions.itemId} and cr.status in ('open','in_progress'))`,
      issuesCount,
      draftVersion: contentWorkspaceChanges.version,
      tags: sql<Array<{ id: string; name: string; slug: string; color: string }>>`coalesce((select jsonb_agg(jsonb_build_object('id', ct.id, 'name', ct.name, 'slug', ct.slug, 'color', ct.color) order by lower(ct.name)) from content_item_tags cit join content_tags ct on ct.id = cit.tag_id where cit.item_id = ${contentItemVersions.itemId}), '[]'::jsonb)`,
    }).from(contentItemVersions)
      .leftJoin(contentWorkspaceChanges, and(eq(contentWorkspaceChanges.workspaceId, workspace.id), eq(contentWorkspaceChanges.itemId, contentItemVersions.itemId)))
      .where(and(...filters)).orderBy(order, asc(contentItemVersions.itemId)).limit(limit + 1).offset(tagOffset)
    const totalFilters = filters.filter((_, index) => !(query.cursor && query.sort !== 'tag' && index === filters.length - 1))
    const total = query.cursor ? null : await deps.db.select({ count: sql<number>`count(*)::int` }).from(contentItemVersions).where(and(...totalFilters))
    return {
      items: selected.slice(0, limit).map(({ payload, mode, ...item }) => {
        const completion = completionMeta(payload, mode as ContentMode)
        return {
          ...item,
          mode,
          posterUrl: posterOf(payload),
          completeness: completion.completeness,
          fieldsFilled: completion.fieldsFilled,
          fieldsTotal: completion.fieldsTotal,
          missingFields: completion.missingFields,
          hasHint: completion.hasHint,
        }
      }),
      nextCursor: selected.length > limit ? (query.sort === 'tag' ? `tag:${tagOffset + limit}` : selected[limit - 1].id) : null,
      total: total?.[0]?.count ?? 0,
      filters: query,
    }
  })

  app.get('/api/v1/admin/content/items/:itemId', { schema: { params: AdminItemParamsSchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const { itemId } = request.params as { itemId: string }
    const workspace = await getOrCreateWorkspace(deps.db, actor)
    const active = await deps.db.select({
      id: contentItemVersions.id, itemId: contentItemVersions.itemId, mode: contentItemVersions.mode,
      payload: contentItemVersions.payload, createdAt: contentItemVersions.createdAt, revisionId: contentItemVersions.revisionId,
    }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
      .where(and(eq(contentItemVersions.itemId, itemId), eq(contentRevisions.status, 'active'))).limit(1)
    const draft = await deps.db.select().from(contentWorkspaceChanges).where(and(eq(contentWorkspaceChanges.workspaceId, workspace.id), eq(contentWorkspaceChanges.itemId, itemId))).limit(1)
    if (!active[0] && !draft[0]) throw new ApiError(404, 'CONTENT_ITEM_NOT_FOUND', 'Карточка не найдена')
    const mode = active[0]?.mode ?? draft[0].mode
    const [reports, issues, decisions, tags] = await Promise.all([
      deps.db.select().from(contentReports).where(eq(contentReports.itemId, itemId)).orderBy(desc(contentReports.createdAt)).limit(50),
      deps.db.select().from(contentQualityIssues).where(and(eq(contentQualityIssues.itemId, itemId), eq(contentQualityIssues.status, 'open'))).orderBy(desc(contentQualityIssues.createdAt)),
      deps.db.select().from(contentReviewDecisions).where(eq(contentReviewDecisions.itemId, itemId)).orderBy(desc(contentReviewDecisions.updatedAt)),
      deps.db.select({ id: contentTags.id, name: contentTags.name, slug: contentTags.slug, color: contentTags.color }).from(contentItemTags).innerJoin(contentTags, eq(contentTags.id, contentItemTags.tagId)).where(eq(contentItemTags.itemId, itemId)).orderBy(asc(contentTags.name)),
    ])
    return { active: active[0] ?? null, draft: draft[0] ?? null, workspace: await workspaceSummary(deps.db, actor), schema: itemSchema(mode), reports, issues, decisions, tags }
  })

  app.get('/api/v1/admin/content/items/:itemId/history', { schema: { params: AdminItemParamsSchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const { itemId } = request.params as { itemId: string }
    const versions = await deps.db.select({
      id: contentItemVersions.id, revisionId: contentItemVersions.revisionId, revisionVersion: contentRevisions.version,
      revisionStatus: contentRevisions.status, payload: contentItemVersions.payload, createdAt: contentItemVersions.createdAt, createdBy: contentRevisions.createdBy,
    }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
      .where(eq(contentItemVersions.itemId, itemId)).orderBy(desc(contentItemVersions.createdAt))
    const workspace = await getOrCreateWorkspace(deps.db, actor)
    const drafts = await deps.db.select().from(contentWorkspaceChanges).where(and(eq(contentWorkspaceChanges.workspaceId, workspace.id), eq(contentWorkspaceChanges.itemId, itemId)))
    return { versions, drafts }
  })

  app.get('/api/v1/admin/content/workspace', async (request, reply) => workspaceSummary(deps.db, await admin(request, reply, deps)))

  app.get('/api/v1/admin/content/release', async (request, reply) => {
    await admin(request, reply, deps)
    return inspectReleaseContent(deps.db, deps.config.contentReleaseRoot, deps.config.gitSha)
  })

  app.post('/api/v1/admin/content/release/build', { schema: { headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const key = requireIdempotencyKey(request)
    const existingByKey = await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1)
    if (existingByKey[0]) return reply.code(202).send({ job: existingByKey[0] })
    const activeJob = await deps.db.select().from(backgroundJobs).where(and(
      eq(backgroundJobs.type, 'content_release_import'), inArray(backgroundJobs.status, ['queued', 'running']),
    )).limit(1)
    if (activeJob[0]) return reply.code(202).send({ job: activeJob[0] })
    const job = (await deps.db.insert(backgroundJobs).values({
      type: 'content_release_import', idempotencyKey: key, createdBy: actor.id, payload: { requestId: request.id },
    }).returning())[0]
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id, action: 'content.release.build.enqueue', entityType: 'background_job', entityId: job.id,
      before: null, after: { gitSha: deps.config.gitSha }, requestId: request.id,
    })
    return reply.code(202).send({ job })
  })

  app.post('/api/v1/admin/content/exchange/selection', { schema: { body: ContentExchangeSelectionBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    return describeContentExchangeSelection(deps.db, actor, (request.body as ContentExchangeSelectionBody).itemIds)
  })

  app.post('/api/v1/admin/content/exchange/export', { schema: { body: ContentExchangeExportBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const body = request.body as ContentExchangeExportBody
    const document = await exportContentExchange(deps.db, actor, body)
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id, action: 'content.exchange.export', entityType: 'content_workspace', entityId: document.source.workspaceId ?? 'unknown',
      before: null, after: { exportId: document.exportId, itemCount: document.items.length, fields: document.fields }, requestId: request.id,
    })
    reply.header('Content-Disposition', `attachment; filename="shoditsa-content-${new Date().toISOString().slice(0, 10)}-${document.exportId.slice(0, 8)}.json"`)
    return document
  })

  app.post('/api/v1/admin/content/exchange/import/preview', {
    schema: { body: ContentExchangeImportPreviewBodySchema }, bodyLimit: 16 * 1024 * 1024,
  }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    return previewContentExchangeImport(deps.db, actor, (request.body as ContentExchangeImportPreviewBody).document)
  })

  app.post('/api/v1/admin/content/exchange/import/apply', {
    schema: { body: ContentExchangeImportApplyBodySchema }, bodyLimit: 16 * 1024 * 1024,
  }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    return applyContentExchangeImport(deps.db, actor, request.body as ContentExchangeImportApplyBody, request.id)
  })

  app.put('/api/v1/admin/content/workspace/items/:itemId', { schema: { params: AdminItemParamsSchema, body: AdminWorkspaceItemBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    return saveWorkspaceItem(deps.db, actor, (request.params as { itemId: string }).itemId, request.body as AdminWorkspaceItemBody, request.id)
  })

  app.delete('/api/v1/admin/content/workspace/items/:itemId', { schema: { params: AdminItemParamsSchema } }, async (request, reply) => discardWorkspaceItem(
    deps.db, await admin(request, reply, deps), (request.params as { itemId: string }).itemId, request.id,
  ))

  app.post('/api/v1/admin/content/builder/media', {
    schema: { body: AdminMediaUploadBodySchema },
    bodyLimit: 8 * 1024 * 1024,
  }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const body = request.body as AdminMediaUploadBody
    if (body.purpose !== 'posterUrl' && body.purpose !== 'headerUrl') throw new ApiError(422, 'BUILDER_MEDIA_PURPOSE_INVALID', 'В конструкторе можно загрузить постер или титульный фон')
    const media = await persistAdminMedia(body, deps.config)
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'content.media.upload',
      entityType: 'content_builder',
      entityId: media.digest,
      before: null,
      after: { purpose: body.purpose, url: media.url, width: media.width, height: media.height, bytes: media.bytes, sourceExtension: media.sourceExtension },
      reason: `Builder upload ${body.purpose}`,
      requestId: request.id,
    })
    return reply.code(201).send({ url: media.url, purpose: body.purpose, width: media.width, height: media.height, bytes: media.bytes })
  })

  app.post('/api/v1/admin/content/items/:itemId/media', {
    schema: { params: AdminItemParamsSchema, body: AdminMediaUploadBodySchema },
    bodyLimit: 8 * 1024 * 1024,
  }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const itemId = (request.params as { itemId: string }).itemId; const body = request.body as AdminMediaUploadBody
    const identity = await deps.db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, itemId)).limit(1)
    if (!identity[0]) throw new ApiError(404, 'CONTENT_ITEM_NOT_FOUND', 'Карточка не найдена')
    const media = await persistAdminMedia(body, deps.config)
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'content.media.upload',
      entityType: 'content_item',
      entityId: itemId,
      before: null,
      after: { purpose: body.purpose, url: media.url, width: media.width, height: media.height, bytes: media.bytes, sourceExtension: media.sourceExtension },
      reason: `Upload ${body.purpose}`,
      requestId: request.id,
    })
    return reply.code(201).send({ url: media.url, purpose: body.purpose, width: media.width, height: media.height, bytes: media.bytes })
  })

  app.post('/api/v1/admin/content/workspace/bulk', { schema: { body: AdminWorkspaceBulkBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const body = request.body as AdminWorkspaceBulkBody
    if (body.operation === 'add_tag' || body.operation === 'remove_tag') {
      if (!body.value || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.value)) throw new ApiError(422, 'CONTENT_TAG_REQUIRED', 'Выберите тег')
      const tag = (await deps.db.select({ id: contentTags.id }).from(contentTags).where(eq(contentTags.id, body.value)).limit(1))[0]
      if (!tag) throw new ApiError(404, 'CONTENT_TAG_NOT_FOUND', 'Тег не найден')
      const found = await deps.db.select({ id: contentItems.id }).from(contentItems).where(inArray(contentItems.id, body.itemIds))
      if (body.operation === 'add_tag' && found.length) await deps.db.insert(contentItemTags).values(found.map((item) => ({ itemId: item.id, tagId: tag.id, createdBy: actor.id }))).onConflictDoNothing()
      if (body.operation === 'remove_tag' && found.length) await deps.db.delete(contentItemTags).where(and(inArray(contentItemTags.itemId, found.map((item) => item.id)), eq(contentItemTags.tagId, tag.id)))
      await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: `content.tag.${body.operation === 'add_tag' ? 'assign' : 'remove'}`, entityType: 'content_tag', entityId: tag.id, before: null, after: { itemIds: found.map((item) => item.id) }, reason: body.reason, requestId: request.id })
      return { requested: body.itemIds.length, processed: found.length, succeeded: found.length, failed: body.itemIds.length - found.length, results: found.map((item) => ({ itemId: item.id, status: 'saved' })) }
    }
    const workspace = await getOrCreateWorkspace(deps.db, actor)
    const activeRows = await deps.db.select({ itemId: contentItemVersions.itemId, mode: contentItemVersions.mode, payload: contentItemVersions.payload })
      .from(contentItemVersions).where(and(eq(contentItemVersions.revisionId, workspace.baseRevisionId), inArray(contentItemVersions.itemId, body.itemIds)))
    const drafts = await loadWorkspaceChanges(deps.db, workspace.id, body.itemIds); const draftById = new Map(drafts.map((entry) => [entry.itemId, entry]))
    const results: Array<{ itemId: string; status: 'saved' | 'failed'; message?: string }> = []
    for (const row of activeRows) {
      const draft = draftById.get(row.itemId); const payload = { ...asRecord(draft?.afterPayload ?? row.payload) }
      if (body.operation === 'allow' || body.operation === 'disallow') payload.allowedInGame = body.operation === 'allow'
      try {
        await saveWorkspaceItem(deps.db, actor, row.itemId, { mode: row.mode, payload, expectedVersion: draft?.version ?? 0, source: 'bulk', reason: body.reason }, request.id)
        results.push({ itemId: row.itemId, status: 'saved' })
      } catch (error) { results.push({ itemId: row.itemId, status: 'failed', message: error instanceof Error ? error.message : 'Ошибка' }) }
    }
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'content.workspace.bulk', entityType: 'content_workspace', entityId: workspace.id, before: null, after: { operation: body.operation, requested: body.itemIds.length, results }, reason: body.reason, requestId: request.id })
    return { requested: body.itemIds.length, processed: results.length, succeeded: results.filter((entry) => entry.status === 'saved').length, failed: results.filter((entry) => entry.status === 'failed').length, results }
  })

  app.post('/api/v1/admin/content/workspace/validate', async (request, reply) => validateWorkspace(deps.db, await admin(request, reply, deps)))
  app.post('/api/v1/admin/content/workspace/build', { schema: { headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const workspace = await getOrCreateWorkspace(deps.db, actor); const key = requireIdempotencyKey(request)
    const existing = await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1)
    if (existing[0]) return reply.code(202).send({ job: existing[0] })
    const job = (await deps.db.insert(backgroundJobs).values({ type: 'content_revision_build', idempotencyKey: key, createdBy: actor.id, payload: { workspaceId: workspace.id, requestId: request.id } }).returning())[0]
    await deps.db.update(contentWorkspaces).set({ status: 'building', lockedAt: new Date(), updatedAt: new Date() }).where(eq(contentWorkspaces.id, workspace.id))
    return reply.code(202).send({ job })
  })
  app.post('/api/v1/admin/content/workspace/activate', { schema: { headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const workspace = await getOrCreateWorkspace(deps.db, actor)
    return activateWorkspaceRevision(deps.db, actor, workspace.id, request.id)
  })
  app.post('/api/v1/admin/content/quality-checks', { schema: { headers: idempotencyHeaders, body: Type.Optional(Type.Object({ itemIds: Type.Optional(Type.Array(Type.String(), { maxItems: 5000 })) })) } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const key = requireIdempotencyKey(request)
    const job = await deps.db.insert(backgroundJobs).values({ type: 'content_quality_check', idempotencyKey: key, createdBy: actor.id, payload: request.body ?? {} }).onConflictDoNothing().returning()
    const resolved = job[0] ?? (await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1))[0]
    return reply.code(202).send({ job: resolved })
  })
}

const registerReportRoutes = (app: FastifyInstance, deps: Deps) => {
  app.get('/api/v1/admin/content-reports', { schema: { querystring: AdminReportQuerySchema } }, async (request, reply) => {
    await admin(request, reply, deps); const query = request.query as AdminReportQuery; const filters = []
    if (query.status) filters.push(eq(contentReports.status, query.status))
    if (query.reason) filters.push(eq(contentReports.reason, query.reason))
    if (query.mode) filters.push(eq(contentReports.mode, query.mode))
    if (query.itemId) filters.push(eq(contentReports.itemId, query.itemId))
    if (query.userId) filters.push(eq(contentReports.userId, query.userId))
    if (query.cursor) filters.push(lt(contentReports.createdAt, new Date(query.cursor)))
    if (query.q) filters.push(or(ilike(contentReports.comment, `%${query.q}%`), sql`${contentReports.id}::text ilike ${`%${query.q}%`}`)!)
    const limit = query.limit ?? 40
    const list = await deps.db.select({ report: contentReports, userEmail: user.email, titleRu: contentItemVersions.titleRu, sessionStatus: gameSessions.status })
      .from(contentReports).innerJoin(user, eq(user.id, contentReports.userId)).innerJoin(gameSessions, eq(gameSessions.id, contentReports.sessionId))
      .innerJoin(contentItemVersions, eq(contentItemVersions.id, gameSessions.answerItemVersionId))
      .where(filters.length ? and(...filters) : undefined).orderBy(desc(contentReports.createdAt)).limit(limit + 1)
    return { items: list.slice(0, limit), nextCursor: list.length > limit ? list[limit - 1].report.createdAt.toISOString() : null }
  })

  app.post('/api/v1/admin/content-reports/bulk-resolve', { schema: { body: AdminReportBulkResolveBodySchema, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const body = request.body as AdminReportBulkResolveBody
    const key = requireIdempotencyKey(request)
    const before = await deps.db.select().from(contentReports).where(inArray(contentReports.id, body.reportIds))
    if (before.length !== new Set(body.reportIds).size) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Один или несколько баг-репортов не найдены')
    const updated = await deps.db.update(contentReports).set({
      status: body.status,
      resolutionType: body.resolutionType,
      resolutionComment: body.resolutionComment,
      linkedRevisionId: body.linkedRevisionId ?? null,
      resolvedAt: new Date(),
      resolvedBy: actor.id,
      updatedAt: new Date(),
    }).where(inArray(contentReports.id, body.reportIds)).returning({ id: contentReports.id, status: contentReports.status })
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'content_report.bulk_resolve',
      entityType: 'content_report_batch',
      entityId: key,
      before: before.map((entry) => ({ id: entry.id, status: entry.status })),
      after: { reports: updated, resolutionType: body.resolutionType, linkedRevisionId: body.linkedRevisionId ?? null },
      reason: body.resolutionComment,
      requestId: request.id,
    })
    return { requested: body.reportIds.length, updated: updated.length, items: updated }
  })

  app.get('/api/v1/admin/content-reports/:id', { schema: { params: AdminIdParamsSchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id
    const report = await deps.db.select({ report: contentReports, reporter: user, game: gameSessions, snapshot: contentItemVersions.payload, snapshotVersionId: contentItemVersions.id })
      .from(contentReports).innerJoin(user, eq(user.id, contentReports.userId)).innerJoin(gameSessions, eq(gameSessions.id, contentReports.sessionId))
      .innerJoin(contentItemVersions, eq(contentItemVersions.id, gameSessions.answerItemVersionId)).where(eq(contentReports.id, id)).limit(1)
    if (!report[0]) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Баг-репорт не найден')
    const workspace = await getOrCreateWorkspace(deps.db, actor)
    const [attempts, hints, active, draft, similar] = await Promise.all([
      deps.db.select().from(gameAttempts).where(eq(gameAttempts.sessionId, report[0].game.id)).orderBy(asc(gameAttempts.position)),
      deps.db.select().from(gameHintChoices).where(eq(gameHintChoices.sessionId, report[0].game.id)).orderBy(asc(gameHintChoices.checkpoint)),
      deps.db.select({ id: contentItemVersions.id, payload: contentItemVersions.payload }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId)).where(and(eq(contentItemVersions.itemId, report[0].report.itemId), eq(contentRevisions.status, 'active'))).limit(1),
      deps.db.select().from(contentWorkspaceChanges).where(and(eq(contentWorkspaceChanges.workspaceId, workspace.id), eq(contentWorkspaceChanges.itemId, report[0].report.itemId))).limit(1),
      deps.db.select().from(contentReports).where(and(eq(contentReports.itemId, report[0].report.itemId), sql`${contentReports.id} <> ${id}`)).orderBy(desc(contentReports.createdAt)).limit(20),
    ])
    return { ...report[0], attempts, hints, active: active[0] ?? null, draft: draft[0] ?? null, similar }
  })

  app.get('/api/v1/admin/content-reports/:id/similar', { schema: { params: AdminIdParamsSchema } }, async (request, reply) => {
    await admin(request, reply, deps); const id = (request.params as { id: string }).id
    const current = await deps.db.select().from(contentReports).where(eq(contentReports.id, id)).limit(1)
    if (!current[0]) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Баг-репорт не найден')
    return { items: await deps.db.select().from(contentReports).where(and(eq(contentReports.itemId, current[0].itemId), sql`${contentReports.id} <> ${id}`)).orderBy(desc(contentReports.createdAt)).limit(50) }
  })

  app.patch('/api/v1/admin/content-reports/:id', { schema: { params: AdminIdParamsSchema, body: AdminReportPatchBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id; const body = request.body as AdminReportPatchBody
    if (body.status === 'duplicate' && !body.duplicateOfReportId) throw new ApiError(422, 'DUPLICATE_TARGET_REQUIRED', 'Выберите основной отчёт')
    if (['resolved', 'dismissed', 'duplicate'].includes(body.status) && !body.resolutionType) throw new ApiError(422, 'RESOLUTION_REQUIRED', 'Выберите итог обработки')
    if (['resolved', 'dismissed', 'duplicate'].includes(body.status) && !body.resolutionComment?.trim()) throw new ApiError(422, 'RESOLUTION_COMMENT_REQUIRED', 'Добавьте комментарий к итогу обработки')
    const before = await deps.db.select().from(contentReports).where(eq(contentReports.id, id)).limit(1)
    if (!before[0]) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Баг-репорт не найден')
    if (body.duplicateOfReportId === id) throw new ApiError(422, 'SELF_DUPLICATE', 'Отчёт не может быть дубликатом самого себя')
    const resolved = ['resolved', 'dismissed', 'duplicate'].includes(body.status)
    const updated = await deps.db.update(contentReports).set({
      status: body.status, assignedTo: body.assignedTo === undefined ? before[0].assignedTo : body.assignedTo,
      resolutionType: body.resolutionType === undefined ? before[0].resolutionType : body.resolutionType,
      resolutionComment: body.resolutionComment === undefined ? before[0].resolutionComment : body.resolutionComment,
      linkedWorkspaceChangeId: body.linkedWorkspaceChangeId === undefined ? before[0].linkedWorkspaceChangeId : body.linkedWorkspaceChangeId,
      linkedRevisionId: body.linkedRevisionId === undefined ? before[0].linkedRevisionId : body.linkedRevisionId,
      duplicateOfReportId: body.duplicateOfReportId === undefined ? before[0].duplicateOfReportId : body.duplicateOfReportId,
      resolvedAt: resolved ? new Date() : null, resolvedBy: resolved ? actor.id : null, updatedAt: new Date(),
    }).where(eq(contentReports.id, id)).returning()
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'content_report.update', entityType: 'content_report', entityId: id, before: before[0], after: updated[0], reason: body.resolutionComment ?? undefined, requestId: request.id })
    return updated[0]
  })
}

const registerPipelineRoutes = (app: FastifyInstance, deps: Deps) => {
  const confirmBodySchema = Type.Object({ confirmation: Type.Literal(true) }, { additionalProperties: false })
  const cleanupBodySchema = Type.Object({
    confirmation: Type.Literal(true),
    keepLatest: Type.Optional(Type.Integer({ minimum: 0, maximum: 500 })),
  }, { additionalProperties: false })

  const lifecycleMessage = (status: string) => {
    if (status === 'queued') return 'Запуск поставлен в очередь'
    if (status === 'running') return 'Worker обрабатывает список'
    if (status === 'review_required') return 'Результаты готовы к проверке'
    if (status === 'partially_failed') return 'Запуск завершён частично с ошибками'
    if (status === 'failed') return 'Запуск завершился ошибкой'
    if (status === 'cancelled') return 'Запуск остановлен'
    if (status === 'staged') return 'Одобренные изменения добавлены в рабочую версию'
    if (status === 'published' || status === 'partially_published') return 'Изменения опубликованы'
    return `Статус: ${status}`
  }

  const itemEventMessage = (item: { entityKey: string; status: string; safeErrorMessage: string | null }) => {
    if (item.status === 'failed') return `${item.entityKey}: ошибка${item.safeErrorMessage ? ` — ${item.safeErrorMessage}` : ''}`
    if (item.status === 'review_required') return `${item.entityKey}: готово к ручной проверке`
    if (item.status === 'approved') return `${item.entityKey}: одобрено`
    if (item.status === 'rejected') return `${item.entityKey}: отклонено`
    if (item.status === 'staged') return `${item.entityKey}: добавлено в рабочую версию`
    if (item.status === 'published') return `${item.entityKey}: опубликовано`
    if (item.status === 'conflict') return `${item.entityKey}: конфликт рабочей версии`
    return `${item.entityKey}: статус ${item.status}`
  }

  app.get('/api/v1/admin/pipelines', async (request, reply) => {
    await admin(request, reply, deps)
    const last = await deps.db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt)).limit(20)
    const music = last.filter((entry) => entry.pipelineKey === 'music')
    const movies = last.filter((entry) => entry.pipelineKey === 'movie')
    const anime = last.filter((entry) => entry.pipelineKey === 'anime')
    const normalization = last.filter((entry) => entry.pipelineKey === 'normalization')
    return { items: [
      { key: 'music', title: 'Музыка', description: 'Поиск, проверка источников и подготовка музыкальных карточек', mode: 'music', state: 'connected', lastRun: music[0] ?? null, awaitingReview: music.filter((entry) => ['review_required', 'partially_failed'].includes(entry.status)).length },
      { key: 'movie', title: 'Кино · Кинопоиск', description: 'Поиск фильмов, данные Кинопоиска, фактчекинг и подготовка карточек', mode: 'movie', state: 'connected', lastRun: movies[0] ?? null, awaitingReview: movies.filter((entry) => ['review_required', 'partially_failed'].includes(entry.status)).length },
      { key: 'anime', title: 'Аниме · Shikimori', description: 'Каталог Shikimori, роли, метаданные, фактчекинг и подготовка аниме-карточек', mode: 'anime', state: 'connected', lastRun: anime[0] ?? null, awaitingReview: anime.filter((entry) => ['review_required', 'partially_failed'].includes(entry.status)).length },
      { key: 'normalization', title: 'Универсальная нормализация', description: 'Выбор категории, карточек и поля; произвольная инструкция для GPT-5 mini с учетом токенов и стоимости', mode: null, state: 'connected', lastRun: normalization[0] ?? null, awaitingReview: normalization.filter((entry) => ['review_required', 'partially_failed'].includes(entry.status)).length },
      { key: 'translation', title: 'Машинный перевод', description: 'Единый review-контур для переводов', mode: null, state: 'not_connected', lastRun: null, awaitingReview: 0 },
    ] }
  })

  const normalizationModeQuery = Type.Object({ mode: Type.Union(['movie', 'series', 'anime', 'game', 'music', 'diagnosis', 'city'].map((value) => Type.Literal(value))) }, { additionalProperties: false })
  let normalizationFieldCache: { expiresAt: number; fields: string[] } | null = null
  const normalizationAvailableFields = async () => {
    if (normalizationFieldCache && normalizationFieldCache.expiresAt > Date.now()) return normalizationFieldCache.fields
    try {
      const discovered = await deps.db.execute(sql`
        select distinct keys.field
        from content_item_versions civ
        inner join content_revisions cr on cr.id = civ.revision_id
        cross join lateral jsonb_object_keys(civ.payload) as keys(field)
        where cr.status = 'active' and keys.field ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'
        order by keys.field
        limit 500
      `)
      const fields = Array.from(discovered as Iterable<{ field: string }>).map((entry) => entry.field)
      normalizationFieldCache = { expiresAt: Date.now() + 60_000, fields }
      return fields
    } catch (error) {
      app.log.warn({ err: error }, 'Could not discover extra normalization fields; using the built-in schema')
      normalizationFieldCache = { expiresAt: Date.now() + 10_000, fields: [] }
      return []
    }
  }
  app.get('/api/v1/admin/pipelines/normalization/fields', { schema: { querystring: normalizationModeQuery } }, async (request, reply) => {
    await admin(request, reply, deps)
    const mode = (request.query as { mode: ContentMode }).mode
    const availableFields = await normalizationAvailableFields()
    return {
      mode,
      items: normalizationFields(mode),
      variables: normalizationTemplateVariables(mode, availableFields),
      contextOptions: normalizationContextOptions(mode, availableFields),
      defaultContextFields: normalizationDefaultContextFields(mode),
    }
  })

  const resolveNormalizationItems = async (body: NormalizationPipelineEstimateBody) => {
    const availableFields = await normalizationAvailableFields()
    try { assertNormalizationField(body.mode, body.field) } catch (error) { throw new ApiError(422, 'NORMALIZATION_FIELD_INVALID', error instanceof Error ? error.message : 'Недопустимое поле') }
    try {
      assertNormalizationTemplate(body.prompt, body.mode, availableFields)
      buildNormalizationCardContext({}, body.mode, body.field, body.contextFields, undefined, availableFields)
    } catch (error) { throw new ApiError(422, 'NORMALIZATION_TEMPLATE_INVALID', error instanceof Error ? error.message : 'Недопустимый шаблон промпта') }
    if (body.scope === 'selected' && !body.itemIds?.length) throw new ApiError(422, 'PIPELINE_SELECTION_REQUIRED', 'Выберите хотя бы одну карточку')
    const active = (await deps.db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
    if (!active) throw new ApiError(409, 'ACTIVE_REVISION_NOT_FOUND', 'Нет активной ревизии контента')
    const filters = [eq(contentItemVersions.revisionId, active.id), eq(contentItemVersions.mode, body.mode)]
    if (body.scope === 'selected') filters.push(inArray(contentItemVersions.itemId, body.itemIds!))
    if (body.includeTagIds?.length && body.tagMatch === 'any') filters.push(sql`exists (select 1 from content_item_tags cit where cit.item_id = ${contentItemVersions.itemId} and cit.tag_id in (${sql.join(body.includeTagIds.map((id) => sql`${id}::uuid`), sql`, `)}))`)
    if (body.includeTagIds?.length && body.tagMatch !== 'any') filters.push(sql`(select count(distinct cit.tag_id)::int from content_item_tags cit where cit.item_id = ${contentItemVersions.itemId} and cit.tag_id in (${sql.join(body.includeTagIds.map((id) => sql`${id}::uuid`), sql`, `)})) = ${body.includeTagIds.length}`)
    if (body.excludeTagIds?.length) filters.push(sql`not exists (select 1 from content_item_tags cit where cit.item_id = ${contentItemVersions.itemId} and cit.tag_id in (${sql.join(body.excludeTagIds.map((id) => sql`${id}::uuid`), sql`, `)}))`)
    if (body.query?.trim()) {
      const needle = `%${body.query.trim()}%`
      filters.push(or(ilike(contentItemVersions.itemId, needle), ilike(contentItemVersions.titleRu, needle), ilike(contentItemVersions.titleOriginal, needle))!)
    }
    const items = await deps.db.select({ itemId: contentItemVersions.itemId, versionId: contentItemVersions.id, titleRu: contentItemVersions.titleRu, titleOriginal: contentItemVersions.titleOriginal, payload: contentItemVersions.payload })
      .from(contentItemVersions).where(and(...filters)).orderBy(asc(contentItemVersions.itemId)).limit(body.maxItems)
    return { items, availableFields }
  }

  app.post('/api/v1/admin/pipelines/normalization/estimate', { schema: { body: NormalizationPipelineEstimateBodySchema } }, async (request, reply) => {
    await admin(request, reply, deps)
    const body = request.body as NormalizationPipelineEstimateBody
    const { items } = await resolveNormalizationItems(body)
    return { items: items.length, aiReviewCalls: items.length, estimatedCost: Number((items.length * 0.02).toFixed(2)), currency: 'USD', upperBound: true, model: body.model ?? 'gpt-5-mini' }
  })

  app.post('/api/v1/admin/pipelines/normalization/preview', { schema: { body: NormalizationPipelineEstimateBodySchema } }, async (request, reply) => {
    await admin(request, reply, deps)
    const body = request.body as NormalizationPipelineEstimateBody
    const { items, availableFields } = await resolveNormalizationItems({ ...body, maxItems: 1 })
    const item = items[0]
    if (!item) throw new ApiError(409, 'NORMALIZATION_ITEMS_EMPTY', 'Под заданный фильтр не найдено карточек для предпросмотра')
    const rendered = renderNormalizationPrompt({
      prompt: body.prompt, payload: asRecord(item.payload), mode: body.mode, field: body.field,
      contextFields: body.contextFields, cardId: item.itemId, availableFields,
    })
    return {
      item: { id: item.itemId, titleRu: item.titleRu, titleOriginal: item.titleOriginal },
      renderedPrompt: rendered.prompt,
      context: rendered.context,
    }
  })

  app.post('/api/v1/admin/pipelines/normalization/runs', { schema: { body: NormalizationPipelineRunBodySchema, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const body = request.body as NormalizationPipelineRunBody; const key = requireIdempotencyKey(request)
    const existingJob = await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1)
    if (existingJob[0]) return reply.code(202).send({ runId: existingJob[0].pipelineRunId, jobId: existingJob[0].id })
    const integrations = await loadIntegrationEnvironment(deps.db, deps.config)
    if (!integrations.OPENAI_API_KEY) throw new ApiError(409, 'OPENAI_API_KEY_REQUIRED', 'Добавьте OpenAI API key в разделе «API-интеграции»')
    const { items, availableFields } = await resolveNormalizationItems(body)
    if (!items.length) throw new ApiError(409, 'NORMALIZATION_ITEMS_EMPTY', 'Под заданный фильтр не найдено карточек')
    const run = (await deps.db.insert(pipelineRuns).values({
      pipelineKey: 'normalization', pipelineVersion: 'normalization-v1', status: 'queued', createdBy: actor.id, itemsTotal: items.length,
      inputDefinitionJson: { scenario: 'normalize', mode: body.mode, field: body.field, prompt: body.prompt, contextFields: body.contextFields ?? normalizationDefaultContextFields(body.mode), availableFields, scope: body.scope, query: body.query ?? '', includeTagIds: body.includeTagIds ?? [], excludeTagIds: body.excludeTagIds ?? [], tagMatch: body.tagMatch ?? 'all', itemIds: items.map((item) => item.itemId) },
      settingsJson: { maxItems: items.length, model: body.model ?? 'gpt-5-mini', webSearch: body.webSearch ?? true, concurrency: Math.min(6, deps.config.normalizationConcurrency) },
      estimatedCost: String((items.length * 0.02).toFixed(6)), resultExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    }).returning())[0]
    const job = (await deps.db.insert(backgroundJobs).values({ type: 'normalization_pipeline', idempotencyKey: key, createdBy: actor.id, pipelineRunId: run.id, payload: { runId: run.id } }).returning())[0]
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'pipeline.normalization.start', entityType: 'pipeline_run', entityId: run.id, before: null, after: { mode: body.mode, field: body.field, items: items.length, jobId: job.id }, requestId: request.id })
    return reply.code(202).send({ runId: run.id, jobId: job.id })
  })

  app.post('/api/v1/admin/pipelines/music/estimate', { schema: { body: MusicPipelineEstimateBodySchema } }, async (request, reply) => {
    await admin(request, reply, deps); const body = request.body as MusicPipelineEstimateBody
    const itemCount = body.scenario === 'manual' ? body.artists?.length ?? 0 : body.maxItems
    const calls = body.aiMode === 'never' ? 0 : itemCount * (body.scenario === 'discover' ? 2 : 1)
    return { items: itemCount, aiReviewCalls: calls, estimatedCost: Number((calls * 0.02).toFixed(2)), currency: 'USD', upperBound: true, model: deps.config.musicPipelineModel }
  })

  app.post('/api/v1/admin/pipelines/music/manual/preview', { schema: { body: MusicPipelineManualPreviewBodySchema } }, async (request, reply) => {
    await admin(request, reply, deps)
    return previewManualArtists(deps.db, (request.body as MusicPipelineManualPreviewBody).artists)
  })

  app.post('/api/v1/admin/pipelines/music/runs', { schema: { body: MusicPipelineRunBodySchema, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const body = request.body as MusicPipelineRunBody; const key = requireIdempotencyKey(request)
    if (body.scenario === 'selected' && (!body.itemIds?.length || body.itemIds.length > body.maxItems)) throw new ApiError(422, 'PIPELINE_SELECTION_REQUIRED', 'Выберите музыкальные карточки в пределах лимита')
    let manualArtists: MusicPipelineManualPreviewBody['artists'] = []
    if (body.scenario === 'manual') {
      if (!body.artists?.length) throw new ApiError(422, 'PIPELINE_ARTISTS_REQUIRED', 'Добавьте хотя бы одного исполнителя')
      const preview = await previewManualArtists(deps.db, body.artists)
      manualArtists = preview.items.filter((entry) => entry.status === 'ready' || (body.includeExisting === true && entry.status === 'existing_card')).map(({ artist, country, hint }) => ({ artist, ...(country ? { country } : {}), ...(hint ? { hint } : {}) }))
      if (!manualArtists.length) throw new ApiError(409, 'PIPELINE_ARTISTS_ALREADY_EXIST', 'В списке нет новых исполнителей для обработки', preview.summary)
    }
    if (body.scenario === 'discover' || body.aiMode !== 'never') {
      const integrations = await loadIntegrationEnvironment(deps.db, deps.config)
      if (!integrations.OPENAI_API_KEY) throw new ApiError(409, 'OPENAI_API_KEY_REQUIRED', 'Добавьте OpenAI API key в разделе «API-интеграции»')
    }
    const existingJob = await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1)
    if (existingJob[0]) return reply.code(202).send({ runId: existingJob[0].pipelineRunId, jobId: existingJob[0].id })
    const estimatedCalls = body.aiMode === 'never' ? 0 : body.scenario === 'manual' ? manualArtists.length : body.scenario === 'discover' ? body.maxItems * 2 : body.maxItems
    const run = (await deps.db.insert(pipelineRuns).values({
      pipelineKey: 'music', pipelineVersion: 'music-cli-v2', status: 'queued', createdBy: actor.id, itemsTotal: body.scenario === 'manual' ? manualArtists.length : body.maxItems,
      inputDefinitionJson: { scenario: body.scenario, itemIds: body.itemIds ?? [], artists: manualArtists, includeExisting: body.includeExisting ?? false },
      settingsJson: { maxItems: body.maxItems, aiMode: body.aiMode ?? 'auto', model: body.model ?? deps.config.musicPipelineModel, webSearch: body.webSearch ?? true },
      estimatedCost: String((estimatedCalls * .02).toFixed(6)), resultExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    }).returning())[0]
    const job = (await deps.db.insert(backgroundJobs).values({ type: 'music_pipeline', idempotencyKey: key, createdBy: actor.id, pipelineRunId: run.id, payload: { runId: run.id, offset: 0 } }).returning())[0]
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'pipeline.music.start', entityType: 'pipeline_run', entityId: run.id, before: null, after: { scenario: body.scenario, maxItems: body.maxItems, jobId: job.id }, requestId: request.id })
    return reply.code(202).send({ runId: run.id, jobId: job.id })
  })

  app.post('/api/v1/admin/pipelines/movie/estimate', { schema: { body: MoviePipelineEstimateBodySchema } }, async (request, reply) => {
    await admin(request, reply, deps); const body = request.body as MoviePipelineEstimateBody
    const itemCount = body.scenario === 'manual' ? body.movies?.length ?? 0 : body.maxItems
    const calls = body.aiMode === 'never' ? 0 : itemCount
    return { items: itemCount, aiReviewCalls: calls, estimatedCost: Number((calls * 0.02).toFixed(2)), currency: 'USD', upperBound: true, model: deps.config.musicPipelineModel }
  })

  app.post('/api/v1/admin/pipelines/movie/manual/preview', { schema: { body: MoviePipelineManualPreviewBodySchema } }, async (request, reply) => {
    await admin(request, reply, deps)
    return previewManualMovies(deps.db, (request.body as MoviePipelineManualPreviewBody).movies)
  })

  app.post('/api/v1/admin/pipelines/movie/runs', { schema: { body: MoviePipelineRunBodySchema, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const body = request.body as MoviePipelineRunBody; const key = requireIdempotencyKey(request)
    if (body.scenario === 'selected' && (!body.itemIds?.length || body.itemIds.length > body.maxItems)) throw new ApiError(422, 'PIPELINE_SELECTION_REQUIRED', 'Выберите карточки фильмов в пределах лимита')
    const integrations = await loadIntegrationEnvironment(deps.db, deps.config)
    let manualMovies: MoviePipelineManualPreviewBody['movies'] = []
    if (body.scenario === 'manual') {
      if (!body.movies?.length) throw new ApiError(422, 'PIPELINE_MOVIES_REQUIRED', 'Добавьте хотя бы один фильм')
      const preview = await previewManualMovies(deps.db, body.movies)
      for (const entry of preview.items) {
        if (entry.status !== 'ready' && !(body.includeExisting === true && entry.status === 'existing_card')) continue
        if (typeof entry.kinopoiskId === 'number') {
          manualMovies.push({ kinopoiskId: entry.kinopoiskId, ...(entry.hint ? { hint: entry.hint } : {}) })
        } else if (entry.query) {
          manualMovies.push({ query: entry.query, ...(entry.requestedYear ? { year: entry.requestedYear } : {}) })
        }
      }
      if (!manualMovies.length) throw new ApiError(409, 'PIPELINE_MOVIES_ALREADY_EXIST', 'В списке нет новых фильмов для обработки', preview.summary)
    }
    if (!integrations.KINOPOISK_API_KEYS) throw new ApiError(409, 'KINOPOISK_API_KEY_REQUIRED', 'Добавьте ключ Кинопоиск Unofficial API в разделе «API-интеграции»')
    if (body.aiMode !== 'never' && !integrations.OPENAI_API_KEY) throw new ApiError(409, 'OPENAI_API_KEY_REQUIRED', 'Добавьте OpenAI API key в разделе «API-интеграции»')
    const existingJob = await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1)
    if (existingJob[0]) return reply.code(202).send({ runId: existingJob[0].pipelineRunId, jobId: existingJob[0].id })
    const itemCount = body.scenario === 'manual' ? manualMovies.length : body.maxItems
    const estimatedCalls = body.aiMode === 'never' ? 0 : itemCount
    const run = (await deps.db.insert(pipelineRuns).values({
      pipelineKey: 'movie', pipelineVersion: 'kinopoisk-cli-v1', status: 'queued', createdBy: actor.id, itemsTotal: itemCount,
      inputDefinitionJson: { scenario: body.scenario, itemIds: body.itemIds ?? [], movies: manualMovies, includeExisting: body.includeExisting ?? false },
      settingsJson: { maxItems: body.maxItems, aiMode: body.aiMode ?? 'auto', model: body.model ?? deps.config.musicPipelineModel, webSearch: body.webSearch ?? true },
      estimatedCost: String((estimatedCalls * .02).toFixed(6)), resultExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    }).returning())[0]
    const job = (await deps.db.insert(backgroundJobs).values({ type: 'movie_pipeline', idempotencyKey: key, createdBy: actor.id, pipelineRunId: run.id, payload: { runId: run.id, offset: 0 } }).returning())[0]
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'pipeline.movie.start', entityType: 'pipeline_run', entityId: run.id, before: null, after: { scenario: body.scenario, maxItems: body.maxItems, jobId: job.id }, requestId: request.id })
    return reply.code(202).send({ runId: run.id, jobId: job.id })
  })

  app.post('/api/v1/admin/pipelines/anime/estimate', { schema: { body: AnimePipelineEstimateBodySchema } }, async (request, reply) => {
    await admin(request, reply, deps); const body = request.body as AnimePipelineEstimateBody
    const itemCount = body.scenario === 'manual' ? body.anime?.length ?? 0 : body.maxItems
    const calls = body.aiMode === 'never' ? 0 : itemCount
    return { items: itemCount, aiReviewCalls: calls, estimatedCost: Number((calls * 0.02).toFixed(2)), currency: 'USD', upperBound: true, model: deps.config.musicPipelineModel }
  })

  app.post('/api/v1/admin/pipelines/anime/manual/preview', { schema: { body: AnimePipelineManualPreviewBodySchema } }, async (request, reply) => {
    await admin(request, reply, deps)
    return previewManualAnime(deps.db, (request.body as AnimePipelineManualPreviewBody).anime)
  })

  app.post('/api/v1/admin/pipelines/anime/runs', { schema: { body: AnimePipelineRunBodySchema, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const body = request.body as AnimePipelineRunBody; const key = requireIdempotencyKey(request)
    if (body.scenario === 'selected' && (!body.itemIds?.length || body.itemIds.length > body.maxItems)) throw new ApiError(422, 'PIPELINE_SELECTION_REQUIRED', 'Выберите аниме-карточки в пределах лимита')
    let manualAnime: AnimePipelineManualPreviewBody['anime'] = []
    if (body.scenario === 'manual') {
      if (!body.anime?.length) throw new ApiError(422, 'PIPELINE_ANIME_REQUIRED', 'Добавьте хотя бы один ID Shikimori')
      const preview = await previewManualAnime(deps.db, body.anime)
      manualAnime = preview.items.filter((entry) => entry.status === 'ready' || (body.includeExisting === true && entry.status === 'existing_card')).map(({ shikimoriId, hint }) => ({ shikimoriId, ...(hint ? { hint } : {}) }))
      if (!manualAnime.length) throw new ApiError(409, 'PIPELINE_ANIME_ALREADY_EXIST', 'В списке нет новых аниме для обработки', preview.summary)
    }
    const integrations = await loadIntegrationEnvironment(deps.db, deps.config)
    if (!integrations.SHIKIMORI_USER_AGENT) throw new ApiError(409, 'SHIKIMORI_USER_AGENT_REQUIRED', 'Добавьте User-Agent приложения Shikimori в разделе «API-интеграции»')
    if (body.aiMode !== 'never' && !integrations.OPENAI_API_KEY) throw new ApiError(409, 'OPENAI_API_KEY_REQUIRED', 'Добавьте OpenAI API key в разделе «API-интеграции»')
    const existingJob = await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1)
    if (existingJob[0]) return reply.code(202).send({ runId: existingJob[0].pipelineRunId, jobId: existingJob[0].id })
    const itemCount = body.scenario === 'manual' ? manualAnime.length : body.maxItems
    const estimatedCalls = body.aiMode === 'never' ? 0 : itemCount
    const run = (await deps.db.insert(pipelineRuns).values({
      pipelineKey: 'anime', pipelineVersion: 'shikimori-cli-v1', status: 'queued', createdBy: actor.id, itemsTotal: itemCount,
      inputDefinitionJson: { scenario: body.scenario, itemIds: body.itemIds ?? [], anime: manualAnime, includeExisting: body.includeExisting ?? false },
      settingsJson: { maxItems: body.maxItems, aiMode: body.aiMode ?? 'auto', model: body.model ?? deps.config.musicPipelineModel, webSearch: body.webSearch ?? true },
      estimatedCost: String((estimatedCalls * .02).toFixed(6)), resultExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    }).returning())[0]
    const job = (await deps.db.insert(backgroundJobs).values({ type: 'anime_pipeline', idempotencyKey: key, createdBy: actor.id, pipelineRunId: run.id, payload: { runId: run.id, offset: 0 } }).returning())[0]
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'pipeline.anime.start', entityType: 'pipeline_run', entityId: run.id, before: null, after: { scenario: body.scenario, maxItems: body.maxItems, jobId: job.id }, requestId: request.id })
    return reply.code(202).send({ runId: run.id, jobId: job.id })
  })

  app.post('/api/v1/admin/pipeline-runs/cleanup', { schema: { body: cleanupBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const body = request.body as { keepLatest?: number }
    const keepLatest = Math.max(0, Number(body.keepLatest ?? 30))
    const completed = await deps.db.select({ id: pipelineRuns.id, status: pipelineRuns.status, createdAt: pipelineRuns.createdAt })
      .from(pipelineRuns)
      .where(sql`${pipelineRuns.status} not in ('queued','running')`)
      .orderBy(desc(pipelineRuns.createdAt))
    const toDelete = completed.slice(keepLatest)
    if (!toDelete.length) return { deleted: 0, keepLatest, kept: completed.length }
    const ids = toDelete.map((entry) => entry.id)
    await deps.db.delete(pipelineRuns).where(inArray(pipelineRuns.id, ids))
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'pipeline.cleanup',
      entityType: 'pipeline_run',
      entityId: 'bulk',
      before: { keepLatest, completed: completed.length },
      after: { deleted: ids.length },
      reason: `Очистка старых запусков, оставлено ${keepLatest}`,
      requestId: request.id,
    })
    return { deleted: ids.length, keepLatest, kept: completed.length - ids.length }
  })

  app.get('/api/v1/admin/pipeline-runs', async (request, reply) => ({ items: await deps.db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt)).limit(100) , actor: (await admin(request, reply, deps)).id }))

  app.delete('/api/v1/admin/pipeline-runs/:id', { schema: { params, body: confirmBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const id = (request.params as { id: string }).id
    const run = await deps.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id)).limit(1)
    if (!run[0]) throw new ApiError(404, 'PIPELINE_RUN_NOT_FOUND', 'Запуск не найден')
    let cancelledJobs = 0
    if (['queued', 'running'].includes(run[0].status)) {
      const staleAfterMs = Math.max(30_000, deps.config.workerStaleAfterMs)
      const heartbeatTs = run[0].heartbeatAt?.getTime() ?? run[0].startedAt?.getTime() ?? run[0].createdAt.getTime()
      const stale = Date.now() - heartbeatTs > staleAfterMs
      if (!stale) throw new ApiError(409, 'PIPELINE_RUN_ACTIVE', 'Нельзя удалить активный пайплайн: сначала остановите процесс или дождитесь stale heartbeat')
      const cancelled = await deps.db.update(backgroundJobs).set({
        status: 'cancelled',
        finishedAt: new Date(),
        nextRetryAt: null,
        heartbeatAt: new Date(),
        errorCode: 'PIPELINE_RUN_DELETED',
        safeErrorMessage: 'Задача отменена при удалении зависшего пайплайна',
      }).where(and(eq(backgroundJobs.pipelineRunId, id), sql`${backgroundJobs.status} in ('queued','running')`)).returning({ id: backgroundJobs.id })
      cancelledJobs = cancelled.length
    }
    const items = await deps.db.select({ count: sql<number>`count(*)::int` }).from(pipelineRunItems).where(eq(pipelineRunItems.runId, id))
    await deps.db.delete(pipelineRuns).where(eq(pipelineRuns.id, id))
    await deps.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'pipeline.run.delete',
      entityType: 'pipeline_run',
      entityId: id,
      before: run[0],
      after: { deleted: true, items: items[0]?.count ?? 0, cancelledJobs },
      requestId: request.id,
    })
    return { deleted: true, runId: id, removedItems: items[0]?.count ?? 0, cancelledJobs }
  })

  app.get('/api/v1/admin/pipeline-runs/:id', { schema: { params } }, async (request, reply) => {
    await admin(request, reply, deps); const run = await deps.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, (request.params as { id: string }).id)).limit(1)
    if (!run[0]) throw new ApiError(404, 'PIPELINE_RUN_NOT_FOUND', 'Запуск не найден')
    return run[0]
  })
  app.get('/api/v1/admin/pipeline-runs/:id/items', { schema: { params } }, async (request, reply) => {
    await admin(request, reply, deps)
    const rows = await deps.db.select().from(pipelineRunItems).where(eq(pipelineRunItems.runId, (request.params as { id: string }).id)).orderBy(asc(pipelineRunItems.createdAt))
    const cardIds = [...new Set(rows.map((item) => item.cardId ?? item.entityKey).filter(Boolean))]
    const activeCards = cardIds.length ? await deps.db.select({
      itemId: contentItemVersions.itemId, versionId: contentItemVersions.id, mode: contentItemVersions.mode,
      titleRu: contentItemVersions.titleRu, titleOriginal: contentItemVersions.titleOriginal,
    }).from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
      .where(and(eq(contentRevisions.status, 'active'), inArray(contentItemVersions.itemId, cardIds))) : []
    const activeByCard = new Map(activeCards.map((card) => [card.itemId, card]))
    const assigned = cardIds.length ? await deps.db.select({ itemId: contentItemTags.itemId, id: contentTags.id, name: contentTags.name, slug: contentTags.slug, color: contentTags.color })
      .from(contentItemTags).innerJoin(contentTags, eq(contentTags.id, contentItemTags.tagId)).where(inArray(contentItemTags.itemId, cardIds)).orderBy(asc(contentTags.name)) : []
    const byCard = new Map<string, typeof assigned>()
    for (const tag of assigned) byCard.set(tag.itemId, [...(byCard.get(tag.itemId) ?? []), tag])
    return { items: rows.map((item) => {
      const card = activeByCard.get(item.cardId ?? item.entityKey) ?? null
      const cardId = item.cardId ?? card?.itemId ?? null
      return { ...item, cardId, card, tags: cardId ? (byCard.get(cardId) ?? []).map(({ itemId: _, ...tag }) => tag) : [] }
    }) }
  })
  app.patch('/api/v1/admin/pipeline-runs/:id/items/decisions', { schema: { params, body: PipelineBulkDecisionBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const { id: runId } = request.params as { id: string }
    const body = request.body as PipelineBulkDecisionBody
    const result = await deps.db.transaction(async (tx) => {
      const selected: Array<typeof pipelineRunItems.$inferSelect> = []
      for (const itemIds of batches(body.itemIds, 500)) {
        selected.push(...await tx.select().from(pipelineRunItems).where(and(eq(pipelineRunItems.runId, runId), inArray(pipelineRunItems.id, itemIds))))
      }
      if (selected.length !== body.itemIds.length) {
        const found = new Set(selected.map((item) => item.id))
        throw new ApiError(404, 'PIPELINE_ITEMS_NOT_FOUND', 'Часть результатов не найдена', { missingItemIds: body.itemIds.filter((itemId) => !found.has(itemId)) })
      }
      selected.forEach(assertPipelineItemDecidable)

      const now = new Date()
      const changes: Array<{ before: typeof selected[number]; after: typeof selected[number] }> = []
      for (const batch of batches(selected, 200)) {
        const decisions = new Map(batch.map((item) => [item.id, pipelineFieldDecisions(item, body.approved)]))
        const updated = await tx.update(pipelineRunItems).set({
          status: body.approved ? 'approved' : 'rejected',
          fieldDecisionsJson: sql`case ${pipelineRunItems.id} ${sql.join(batch.map((item) => sql`when ${item.id} then ${JSON.stringify(decisions.get(item.id))}::jsonb`), sql` `)} else ${pipelineRunItems.fieldDecisionsJson} end`,
          approvedBy: actor.id,
          approvedAt: now,
          updatedAt: now,
        }).where(and(
          inArray(pipelineRunItems.id, batch.map((item) => item.id)),
          eq(pipelineRunItems.runId, runId),
          notInArray(pipelineRunItems.status, ['staged', 'published']),
          isNull(pipelineRunItems.workspaceChangeId),
          isNull(pipelineRunItems.appliedRevisionId),
        )).returning()
        if (updated.length !== batch.length) {
          const updatedIds = new Set(updated.map((item) => item.id))
          throw new ApiError(409, 'PIPELINE_ITEM_UPDATE_CONFLICT', 'Часть результатов изменилась во время массового действия', { itemIds: batch.filter((item) => !updatedIds.has(item.id)).map((item) => item.id) })
        }
        const beforeById = new Map(batch.map((item) => [item.id, item]))
        const batchChanges = updated.map((after) => ({ before: beforeById.get(after.id)!, after }))
        await tx.insert(auditLog).values(batchChanges.map((change) => ({
          actorUserId: actor.id,
          action: 'pipeline.item.decision',
          entityType: 'pipeline_run_item',
          entityId: change.after.id,
          before: change.before,
          after: change.after,
          reason: body.note,
          requestId: request.id,
        })))
        changes.push(...batchChanges)
      }
      return changes
    })
    return { success: result.length, failed: 0, approved: body.approved, itemIds: result.map((change) => change.after.id) }
  })
  app.patch('/api/v1/admin/pipeline-runs/:id/items/:itemId/decision', { schema: { params: runItemParams, body: PipelineItemDecisionBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const { id, itemId } = request.params as { id: string; itemId: string }; const body = request.body as PipelineItemDecisionBody
    const item = await deps.db.select().from(pipelineRunItems).where(and(eq(pipelineRunItems.id, itemId), eq(pipelineRunItems.runId, id))).limit(1)
    if (!item[0]) throw new ApiError(404, 'PIPELINE_ITEM_NOT_FOUND', 'Результат не найден')
    assertPipelineItemDecidable(item[0])
    const updated = await deps.db.update(pipelineRunItems).set({ status: body.approved ? 'approved' : 'rejected', fieldDecisionsJson: body.fieldDecisions, approvedBy: actor.id, approvedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(pipelineRunItems.id, itemId),
      eq(pipelineRunItems.runId, id),
      notInArray(pipelineRunItems.status, ['staged', 'published']),
      isNull(pipelineRunItems.workspaceChangeId),
      isNull(pipelineRunItems.appliedRevisionId),
    )).returning()
    if (!updated[0]) throw new ApiError(409, 'PIPELINE_ITEM_UPDATE_CONFLICT', 'Результат изменился во время сохранения', { itemId })
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'pipeline.item.decision', entityType: 'pipeline_run_item', entityId: itemId, before: item[0], after: updated[0], reason: body.note, requestId: request.id })
    return updated[0]
  })
  app.post('/api/v1/admin/pipeline-runs/:id/items/:itemId/regenerate', { schema: { params: runItemParams, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const { id: runId, itemId } = request.params as { id: string; itemId: string }
    const key = requireIdempotencyKey(request)
    const existingJob = await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1)
    if (existingJob[0]) return reply.code(202).send({ runId, itemId, jobId: existingJob[0].id })

    const result = await deps.db.transaction(async (tx) => {
      const run = await tx.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1)
      if (!run[0]) throw new ApiError(404, 'PIPELINE_RUN_NOT_FOUND', 'Запуск не найден')
      if (run[0].pipelineKey !== 'normalization') throw new ApiError(409, 'PIPELINE_ITEM_REGENERATE_UNSUPPORTED', 'Повторная генерация отдельного айтема доступна только для универсальной нормализации')
      if (['queued', 'running'].includes(run[0].status)) throw new ApiError(409, 'PIPELINE_RUN_ACTIVE', 'Дождитесь остановки или завершения общего запуска')

      const item = await tx.select().from(pipelineRunItems).where(and(eq(pipelineRunItems.id, itemId), eq(pipelineRunItems.runId, runId))).limit(1)
      if (!item[0]) throw new ApiError(404, 'PIPELINE_ITEM_NOT_FOUND', 'Результат не найден')
      if (item[0].workspaceChangeId || item[0].appliedRevisionId || ['staged', 'published'].includes(item[0].status)) {
        throw new ApiError(409, 'PIPELINE_ITEM_ALREADY_APPLIED', 'Айтем уже перенесён в рабочую версию или опубликован')
      }
      const active = await tx.select({ id: backgroundJobs.id }).from(backgroundJobs).where(and(
        eq(backgroundJobs.pipelineRunId, runId),
        eq(backgroundJobs.type, 'normalization_pipeline'),
        sql`${backgroundJobs.status} in ('queued','running')`,
        sql`${backgroundJobs.payload}->>'regenerateItemId' = ${itemId}`,
      )).limit(1)
      if (active[0]) throw new ApiError(409, 'PIPELINE_ITEM_REGENERATE_ACTIVE', 'Этот айтем уже перегенерируется')

      const job = (await tx.insert(backgroundJobs).values({
        type: 'normalization_pipeline', idempotencyKey: key, createdBy: actor.id, pipelineRunId: runId,
        payload: { runId, itemIds: [item[0].entityKey], regenerateItemId: itemId },
      }).returning())[0]
      await tx.update(pipelineRunItems).set({
        status: 'pending', fieldDecisionsJson: {}, approvedBy: null, approvedAt: null,
        errorCode: null, safeErrorMessage: null, updatedAt: new Date(),
      }).where(eq(pipelineRunItems.id, itemId))
      await tx.insert(auditLog).values({
        actorUserId: actor.id, action: 'pipeline.item.regenerate', entityType: 'pipeline_run_item', entityId: itemId,
        before: item[0], after: { jobId: job.id, entityKey: item[0].entityKey }, requestId: request.id,
      })
      return { runId, itemId, jobId: job.id }
    })
    return reply.code(202).send(result)
  })

  const approveToWorkspace = async (request: FastifyRequest, reply: FastifyReply, publish: boolean) => {
    const actor = await admin(request, reply, deps); const runId = (request.params as { id: string }).id; const body = request.body as PipelineApprovalBody
    const run = (await deps.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1))[0]
    if (!run) throw new ApiError(404, 'PIPELINE_RUN_NOT_FOUND', 'Запуск не найден')
    const items: Array<typeof pipelineRunItems.$inferSelect> = []
    if (body.itemIds?.length) {
      for (const itemIds of batches(body.itemIds, 500)) {
        items.push(...await deps.db.select().from(pipelineRunItems).where(and(
          eq(pipelineRunItems.runId, runId),
          eq(pipelineRunItems.status, 'approved'),
          inArray(pipelineRunItems.id, itemIds),
        )))
      }
    } else {
      items.push(...await deps.db.select().from(pipelineRunItems).where(and(eq(pipelineRunItems.runId, runId), eq(pipelineRunItems.status, 'approved'))))
    }
    if (!items.length) throw new ApiError(409, 'PIPELINE_ITEMS_NOT_APPROVED', 'Нет одобренных результатов для применения')
    const targetIds = items.map((item) => item.cardId ?? String(asRecord(item.proposedJson).id ?? item.entityKey))
    const activeVersions: Array<{ itemId: string; versionId: string; mode: ContentMode; payload: unknown }> = []
    for (const itemIds of batches([...new Set(targetIds)], 500)) {
      activeVersions.push(...await deps.db.select({ itemId: contentItemVersions.itemId, versionId: contentItemVersions.id, mode: contentItemVersions.mode, payload: contentItemVersions.payload }).from(contentItemVersions)
        .innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId)).where(and(eq(contentRevisions.status, 'active'), inArray(contentItemVersions.itemId, itemIds))))
    }
    const activeVersionByItem = new Map(activeVersions.map((entry) => [entry.itemId, entry]))
    const contentModes: ContentMode[] = ['movie', 'series', 'anime', 'game', 'music', 'diagnosis', 'city']
    const prepared = items.map((item) => {
      const before = asRecord(item.beforeJson); const proposed = asRecord(item.proposedJson); const decisions = asRecord(item.fieldDecisionsJson)
      const itemId = item.cardId ?? String(proposed.id ?? item.entityKey)
      const active = activeVersionByItem.get(itemId)
      const mode = String(active?.mode ?? proposed.mode ?? before.mode ?? '')
      if (!pipelineItemHasResult(item)) return { item, itemId, error: 'У результата отсутствует proposedJson' }
      if (!contentModes.includes(mode as ContentMode)) return { item, itemId, error: 'Не удалось определить допустимую категорию карточки' }
      if (item.inputItemVersionId && (!active || (active.versionId !== item.inputItemVersionId && !contentPayloadsEqual(
        { ...before, id: itemId, mode },
        { ...asRecord(active.payload), id: itemId, mode },
      )))) return { item, itemId, error: 'Содержимое карточки изменилось после запуска пайплайна' }
      const payload = { ...before }
      for (const [field, rawDecision] of Object.entries(decisions)) {
        const decision = asRecord(rawDecision); const action = decision.action
        if (action === 'accept') payload[field] = proposed[field]
        if (action === 'edit') payload[field] = decision.value
      }
      payload.id = itemId; payload.mode = mode
      const fieldErrors = blockingContentValidationIssues(Object.keys(before).length ? { ...before, id: itemId, mode } : null, payload, mode as ContentMode)
      if (fieldErrors.length) return { item, itemId, error: 'Карточка не прошла валидацию', fieldErrors }
      return { item, itemId, mode: mode as ContentMode, payload }
    })
    const invalid = prepared.filter((entry) => entry.error)
    if (invalid.length) throw new ApiError(422, 'PIPELINE_ITEMS_INVALID', 'Часть одобренных результатов нельзя применить. Ни одна новая карточка не была добавлена в рабочую версию.', {
      items: invalid.slice(0, 50).map((entry) => ({ itemId: entry.item.id, entityKey: entry.item.entityKey, message: entry.error, fieldErrors: entry.fieldErrors ?? [] })),
      invalidCount: invalid.length,
    })
    const workspace = await getOrCreateWorkspace(deps.db, actor)
    if (body.expectedWorkspaceVersion !== undefined && workspace.version !== body.expectedWorkspaceVersion) throw new ApiError(409, 'WORKSPACE_VERSION_CONFLICT', 'Рабочая версия уже изменилась; обновите данные перед применением', { expectedVersion: body.expectedWorkspaceVersion, currentVersion: workspace.version })
    const existingChanges = await loadWorkspaceChanges(deps.db, workspace.id, targetIds)
    const changeByItem = new Map(existingChanges.map((entry) => [entry.itemId, entry]))
    const results: Array<{ itemId: string; status: string; message?: string }> = []
    for (const batch of batches(prepared, 8)) {
      results.push(...await Promise.all(batch.map(async (entry) => {
        const { item, itemId, mode, payload } = entry as typeof entry & { mode: ContentMode; payload: Record<string, unknown> }
        try {
          const change = await saveWorkspaceItem(deps.db, actor, itemId, { mode, payload, expectedVersion: changeByItem.get(itemId)?.version ?? 0, source: 'ai_pipeline', reason: `Pipeline ${runId}`, pipelineRunId: runId, pipelineRunItemId: item.id }, request.id)
          await deps.db.update(pipelineRunItems).set({ status: 'staged', workspaceChangeId: change.id, updatedAt: new Date() }).where(eq(pipelineRunItems.id, item.id))
          return { itemId: item.id, status: 'staged' }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Конфликт'
          await deps.db.update(pipelineRunItems).set({ status: 'conflict', errorCode: 'WORKSPACE_CONFLICT', safeErrorMessage: message, updatedAt: new Date() }).where(eq(pipelineRunItems.id, item.id))
          return { itemId: item.id, status: 'conflict', message }
        }
      })))
    }
    await deps.db.update(pipelineRuns).set({ status: results.some((entry) => entry.status === 'conflict') ? 'partially_failed' : 'staged' }).where(eq(pipelineRuns.id, runId))
    if (!publish) return { results, workspace: await workspaceSummary(deps.db, actor) }
    const built = await buildWorkspaceRevision(deps.db, actor, workspace.id, request.id)
    const activated = await activateWorkspaceRevision(deps.db, actor, workspace.id, request.id)
    await deps.db.update(pipelineRunItems).set({ status: 'published', appliedRevisionId: activated.revision.id, updatedAt: new Date() }).where(and(eq(pipelineRunItems.runId, runId), eq(pipelineRunItems.status, 'staged')))
    const unresolved = await deps.db.select({ count: sql<number>`count(*)::int` }).from(pipelineRunItems).where(and(eq(pipelineRunItems.runId, runId), sql`${pipelineRunItems.status} <> 'published'`))
    await deps.db.update(pipelineRuns).set({ status: unresolved[0]?.count ? 'partially_published' : 'published', finishedAt: new Date() }).where(eq(pipelineRuns.id, runId))
    const publishedItems = await deps.db.select({ cardId: pipelineRunItems.cardId, entityKey: pipelineRunItems.entityKey }).from(pipelineRunItems).where(and(eq(pipelineRunItems.runId, runId), eq(pipelineRunItems.appliedRevisionId, activated.revision.id)))
    const publishedCardIds = [...new Set(publishedItems.map((item) => item.cardId ?? item.entityKey).filter(Boolean))]
    const tagSlug = `pipeline-run-${runId}`
    const pipelineName = run.pipelineKey === 'normalization' ? 'Нормализация' : run.pipelineKey === 'music' ? 'Музыка' : run.pipelineKey === 'movie' ? 'Кино' : run.pipelineKey === 'anime' ? 'Аниме' : 'Пайплайн'
    const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric' }).format(run.createdAt)
    await deps.db.insert(contentTags).values({ name: `${pipelineName} · ${date} · ${runId.slice(0, 8)}`, slug: tagSlug, color: '#697f2f', createdBy: actor.id }).onConflictDoNothing()
    const runTag = (await deps.db.select({ id: contentTags.id, name: contentTags.name, slug: contentTags.slug, color: contentTags.color }).from(contentTags).where(eq(contentTags.slug, tagSlug)).limit(1))[0]
    if (runTag) for (const itemIds of batches(publishedCardIds, 250)) {
      await deps.db.insert(contentItemTags).values(itemIds.map((itemId) => ({ itemId, tagId: runTag.id, createdBy: actor.id }))).onConflictDoNothing()
    }
    if (runTag) await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'pipeline.publish.tag', entityType: 'content_tag', entityId: runTag.id, before: null, after: { runId, itemIds: publishedCardIds }, requestId: request.id })
    return { results, built, activated, tag: runTag ?? null }
  }
  app.post('/api/v1/admin/pipeline-runs/:id/approve-to-workspace', { schema: { params, body: PipelineApprovalBodySchema } }, async (request, reply) => approveToWorkspace(request, reply, false))
  app.post('/api/v1/admin/pipeline-runs/:id/approve-and-publish', { schema: { params, body: PipelineApprovalBodySchema } }, async (request, reply) => approveToWorkspace(request, reply, true))
  app.post('/api/v1/admin/pipeline-runs/:id/retry-failed', { schema: { params, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const runId = (request.params as { id: string }).id; const key = requireIdempotencyKey(request)
    const existing = await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1)
    if (existing[0]) return reply.code(202).send({ job: existing[0], failedCount: Number(asRecord(existing[0].payload).failedCount ?? 0) })
    const result = await deps.db.transaction(async (tx) => {
      const run = await tx.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1)
      if (!run[0]) throw new ApiError(404, 'PIPELINE_RUN_NOT_FOUND', 'Запуск не найден')
      if (['queued', 'running'].includes(run[0].status)) throw new ApiError(409, 'PIPELINE_RUN_ACTIVE', 'Дождитесь завершения текущего запуска')
      const input = asRecord(run[0].inputDefinitionJson)
      if (run[0].pipelineKey === 'normalization' && String(input.scenario || '') !== 'normalize') {
        throw new ApiError(409, 'PIPELINE_RETRY_CUSTOM_UNSUPPORTED', 'Этот специальный запуск повторяется собственным воркером; универсальный повтор к нему неприменим')
      }
      const failed = await tx.select({ count: sql<number>`count(*)::int` }).from(pipelineRunItems).where(and(eq(pipelineRunItems.runId, runId), eq(pipelineRunItems.status, 'failed')))
      const failedCount = failed[0]?.count ?? 0
      if (!failedCount) throw new ApiError(409, 'NO_FAILED_ITEMS', 'Нет ошибочных элементов для повтора')
      const jobType = run[0].pipelineKey === 'movie' ? 'movie_pipeline' : run[0].pipelineKey === 'anime' ? 'anime_pipeline' : run[0].pipelineKey === 'normalization' ? 'normalization_pipeline' : run[0].pipelineKey === 'music' ? 'music_pipeline' : null
      if (!jobType) throw new ApiError(409, 'PIPELINE_RETRY_UNSUPPORTED', 'Повтор ошибок для этого пайплайна недоступен')
      const active = await tx.select({ id: backgroundJobs.id }).from(backgroundJobs).where(and(
        eq(backgroundJobs.pipelineRunId, runId),
        sql`${backgroundJobs.status} in ('queued','running')`,
        sql`${backgroundJobs.payload}->>'retryFailed' = 'true'`,
      )).limit(1)
      if (active[0]) throw new ApiError(409, 'PIPELINE_RETRY_ACTIVE', 'Ошибочные айтемы уже перегенерируются')
      const job = (await tx.insert(backgroundJobs).values({
        type: jobType, idempotencyKey: key, createdBy: actor.id, pipelineRunId: runId,
        payload: { runId, retryFailed: true, failedCount },
      }).returning())[0]
      await tx.update(pipelineRuns).set({ status: 'queued', cancelRequestedAt: null, finishedAt: null, heartbeatAt: new Date(), errorCode: null, safeErrorMessage: null }).where(eq(pipelineRuns.id, runId))
      await tx.insert(auditLog).values({
        actorUserId: actor.id, action: 'pipeline.failed.retry', entityType: 'pipeline_run', entityId: runId,
        before: { status: run[0].status, failedCount }, after: { status: 'queued', jobId: job.id }, requestId: request.id,
      })
      return { job, failedCount }
    })
    return reply.code(202).send(result)
  })
  app.post('/api/v1/admin/pipeline-runs/:id/continue', { schema: { params } }, async (request, reply) => {
    const actor = await admin(request, reply, deps)
    const runId = (request.params as { id: string }).id
    const run = await deps.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1)
    if (!run[0]) throw new ApiError(404, 'PIPELINE_RUN_NOT_FOUND', 'Запуск не найден')

    const pipelineKey = String(run[0].pipelineKey)
    const jobType = pipelineKey === 'music' ? 'music_pipeline' : pipelineKey === 'movie' ? 'movie_pipeline' : pipelineKey === 'anime' ? 'anime_pipeline' : pipelineKey === 'normalization' ? 'normalization_pipeline' : null
    if (!jobType) throw new ApiError(409, 'PIPELINE_CONTINUE_UNSUPPORTED', 'Продолжение недоступно для этого типа пайплайна')

    const input = asRecord(run[0].inputDefinitionJson)
    const scenario = String(input.scenario || 'discover')
    const resumableScenario = pipelineKey === 'normalization' ? scenario === 'normalize' : scenario === 'manual'
    if (!resumableScenario) throw new ApiError(409, 'PIPELINE_CONTINUE_MANUAL_ONLY', 'Этот запуск нельзя продолжить универсальным воркером')

    const nonResumableStatuses = new Set(['review_required', 'approved', 'staged', 'published', 'partially_published'])
    if (nonResumableStatuses.has(run[0].status)) throw new ApiError(409, 'PIPELINE_ALREADY_COMPLETE', 'Запуск уже завершён; продолжать нечего')

    const staleAfterMs = Math.max(30_000, deps.config.workerStaleAfterMs)
    const heartbeatTs = run[0].heartbeatAt?.getTime() ?? run[0].startedAt?.getTime() ?? run[0].createdAt.getTime()
    const runIsStale = Date.now() - heartbeatTs > staleAfterMs
    if (['queued', 'running'].includes(run[0].status) && !runIsStale) {
      throw new ApiError(409, 'PIPELINE_RUN_ACTIVE', 'Запуск уже выполняется. Продолжение доступно только для stale процесса')
    }

    const activeJobs = await deps.db.select().from(backgroundJobs).where(and(eq(backgroundJobs.pipelineRunId, runId), sql`${backgroundJobs.status} in ('queued','running')`)).orderBy(desc(backgroundJobs.createdAt))
    const freshActiveJob = activeJobs.find((job) => {
      const jobTs = job.heartbeatAt?.getTime() ?? job.startedAt?.getTime() ?? job.createdAt.getTime()
      return Date.now() - jobTs <= staleAfterMs
    })
    if (freshActiveJob) throw new ApiError(409, 'PIPELINE_RUN_ACTIVE', 'Фоновая задача уже активна; дождитесь завершения или stale heartbeat')

    const processedItems = await deps.db.select({ count: sql<number>`count(*)::int` }).from(pipelineRunItems).where(eq(pipelineRunItems.runId, runId))
    const processed = Math.max(Number(run[0].itemsProcessed ?? 0), Number(processedItems[0]?.count ?? 0))
    const inputTotal = pipelineKey === 'normalization'
      ? (Array.isArray(input.itemIds) ? input.itemIds.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).length : 0)
      : pipelineKey === 'music'
      ? (Array.isArray(input.artists) ? input.artists.map(asRecord).filter((entry) => typeof entry.artist === 'string' && entry.artist.trim().length > 0).length : 0)
      : pipelineKey === 'movie'
        ? (Array.isArray(input.movies) ? input.movies.length : 0)
        : (Array.isArray(input.anime) ? input.anime.length : 0)
    const total = Math.max(Number(run[0].itemsTotal ?? 0), inputTotal)
    const offset = Math.max(0, Math.min(total, Math.trunc(processed)))
    if (total <= 0 || offset >= total) throw new ApiError(409, 'PIPELINE_ALREADY_COMPLETE', 'Все элементы уже обработаны. Продолжать нечего')

    const resumeKey = `${runId}:${pipelineKey === 'normalization' ? 'normalization' : 'manual'}:${offset}`
    let job = (await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, resumeKey)).limit(1))[0]
    if (job) {
      job = (await deps.db.update(backgroundJobs).set({
        status: 'queued',
        startedAt: null,
        finishedAt: null,
        nextRetryAt: null,
        heartbeatAt: new Date(),
        workerId: null,
        errorCode: null,
        safeErrorMessage: null,
      }).where(eq(backgroundJobs.id, job.id)).returning())[0]
    } else {
      const inserted = await deps.db.insert(backgroundJobs).values({
        type: jobType,
        idempotencyKey: resumeKey,
        createdBy: actor.id,
        pipelineRunId: runId,
        payload: { runId, offset },
      }).onConflictDoNothing().returning()
      job = inserted[0] ?? (await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, resumeKey)).limit(1))[0]
    }

    const staleJobIds = activeJobs.map((entry) => entry.id).filter((id) => id !== job.id)
    if (staleJobIds.length) {
      await deps.db.update(backgroundJobs).set({
        status: 'cancelled',
        finishedAt: new Date(),
        nextRetryAt: null,
        heartbeatAt: new Date(),
        errorCode: 'PIPELINE_RUN_CONTINUED',
        safeErrorMessage: 'Задача отменена после ручного продолжения процесса',
      }).where(inArray(backgroundJobs.id, staleJobIds))
    }

    await deps.db.update(pipelineRuns).set({
      status: 'queued',
      finishedAt: null,
      cancelRequestedAt: null,
      heartbeatAt: new Date(),
      workerId: null,
      errorCode: null,
      safeErrorMessage: null,
    }).where(eq(pipelineRuns.id, runId))

    await deps.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: 'pipeline.continue',
      entityType: 'pipeline_run',
      entityId: runId,
      before: run[0],
      after: { jobId: job.id, offset, staleJobsCancelled: staleJobIds.length },
      requestId: request.id,
    })
    return reply.code(202).send({ runId, jobId: job.id, offset })
  })
  app.post('/api/v1/admin/pipeline-runs/:id/cancel', { schema: { params } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id
    const run = await deps.db.update(pipelineRuns).set({ cancelRequestedAt: new Date() }).where(and(eq(pipelineRuns.id, id), sql`${pipelineRuns.status} in ('queued','running')`)).returning()
    if (!run[0]) throw new ApiError(409, 'PIPELINE_NOT_CANCELLABLE', 'Запуск уже завершён')
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'pipeline.cancel', entityType: 'pipeline_run', entityId: id, before: null, after: { cancelRequestedAt: run[0].cancelRequestedAt }, requestId: request.id })
    return run[0]
  })

  app.get('/api/v1/admin/pipeline-runs/:id/events', { schema: { params } }, async (request, reply) => {
    await admin(request, reply, deps)
    const id = (request.params as { id: string }).id
    const run = await deps.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id)).limit(1)
    if (!run[0]) throw new ApiError(404, 'PIPELINE_RUN_NOT_FOUND', 'Запуск не найден')
    const [itemStatusRows, recentItems] = await Promise.all([
      deps.db.select({ status: pipelineRunItems.status, count: sql<number>`count(*)::int` }).from(pipelineRunItems).where(eq(pipelineRunItems.runId, id)).groupBy(pipelineRunItems.status),
      deps.db.select({ id: pipelineRunItems.id, entityKey: pipelineRunItems.entityKey, status: pipelineRunItems.status, safeErrorMessage: pipelineRunItems.safeErrorMessage, updatedAt: pipelineRunItems.updatedAt, createdAt: pipelineRunItems.createdAt })
        .from(pipelineRunItems).where(eq(pipelineRunItems.runId, id)).orderBy(desc(pipelineRunItems.updatedAt)).limit(24),
    ])
    const statusCounts = Object.fromEntries(itemStatusRows.map((entry) => [entry.status, entry.count]))
    const running = ['queued', 'running'].includes(run[0].status)
    const heartbeatAgeMs = run[0].heartbeatAt ? Math.max(0, Date.now() - run[0].heartbeatAt.getTime()) : null
    const staleAfterMs = Math.max(30_000, deps.config.workerStaleAfterMs)
    const stale = running && heartbeatAgeMs != null && heartbeatAgeMs > staleAfterMs
    const progressPercent = Math.min(100, Math.round((Number(run[0].itemsProcessed ?? 0) / Math.max(1, Number(run[0].itemsTotal ?? 1))) * 100))
    const journalLines = String(run[0].logExcerpt ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-80)
    const lifecycleEvents = [
      { id: 'created', at: run[0].createdAt, type: 'lifecycle', message: 'Запуск создан' },
      ...(run[0].startedAt ? [{ id: 'started', at: run[0].startedAt, type: 'lifecycle', message: 'Worker начал обработку' }] : []),
      ...(run[0].cancelRequestedAt ? [{ id: 'cancel-requested', at: run[0].cancelRequestedAt, type: 'lifecycle', message: 'Запрошена остановка' }] : []),
      ...(run[0].finishedAt ? [{ id: 'finished', at: run[0].finishedAt, type: 'lifecycle', message: lifecycleMessage(run[0].status) }] : []),
      ...(run[0].heartbeatAt ? [{ id: 'heartbeat', at: run[0].heartbeatAt, type: 'heartbeat', message: stale ? 'Нет heartbeat дольше порога — проверьте worker' : 'Получен heartbeat от worker' }] : []),
    ]
    const itemEvents = recentItems.map((item) => ({
      id: String(item.id),
      at: item.updatedAt ?? item.createdAt,
      type: 'item',
      status: item.status,
      message: itemEventMessage(item),
    }))
    const logEvents = journalLines.slice(-20).map((line, index) => ({
      id: `log-${index}`,
      at: run[0].heartbeatAt ?? run[0].startedAt ?? run[0].createdAt,
      type: 'log',
      message: line,
    }))
    const events = [...lifecycleEvents, ...itemEvents, ...logEvents]
      .sort((left, right) => new Date(String(right.at)).getTime() - new Date(String(left.at)).getTime())
      .slice(0, 120)
    return {
      run: run[0],
      pollAfterMs: running ? 2500 : null,
      stale,
      staleAfterMs,
      heartbeatAgeMs,
      progressPercent,
      lifecycleMessage: lifecycleMessage(run[0].status),
      journalLines,
      itemStats: { total: Object.values(statusCounts).reduce((sum, count) => sum + Number(count), 0), byStatus: statusCounts },
      events,
    }
  })
}

const registerIntegrationRoutes = (app: FastifyInstance, deps: Deps) => {
  app.get('/api/v1/admin/integrations', async (request, reply) => {
    await admin(request, reply, deps)
    return { items: await integrationStatuses(deps.db) }
  })
  app.put('/api/v1/admin/integrations/:key', { schema: { params: IntegrationKeyParamsSchema, body: IntegrationSecretUpdateBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const key = (request.params as { key: IntegrationKey }).key; const body = request.body as IntegrationSecretUpdateBody
    if (key === 'MUSIC_OUTBOUND_PROXY_URL') {
      try { normalizeMusicProxyUrl(body.value) }
      catch { throw new ApiError(422, 'MUSIC_PROXY_URL_INVALID', 'Proxy URL должен использовать http:// или https:// и содержать адрес сервера') }
    }
    await saveIntegrationSecret(deps.db, deps.config, actor.id, key, body.value)
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'integration.secret.update', entityType: 'integration_secret', entityId: key, before: null, after: { configured: true }, requestId: request.id })
    return { items: await integrationStatuses(deps.db) }
  })
  app.delete('/api/v1/admin/integrations/:key', { schema: { params: IntegrationKeyParamsSchema, body: Type.Object({ confirmation: Type.Literal(true) }, { additionalProperties: false }) } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const key = (request.params as { key: IntegrationKey }).key
    const removed = await deleteIntegrationSecret(deps.db, key)
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'integration.secret.delete', entityType: 'integration_secret', entityId: key, before: { configured: Boolean(removed.length) }, after: { configured: false }, requestId: request.id })
    return { items: await integrationStatuses(deps.db) }
  })
}

const registerUserRoutes = (app: FastifyInstance, deps: Deps) => {
  app.get('/api/v1/admin/users', { schema: { querystring: AdminUsersQuerySchema } }, async (request, reply) => {
    await admin(request, reply, deps); const query = request.query as AdminUsersQuery; const filters = []
    if (query.status) filters.push(eq(playerProfiles.accountStatus, query.status))
    if (query.accountType) filters.push(eq(user.isAnonymous, query.accountType === 'anonymous'))
    if (query.cursor) filters.push(lt(user.createdAt, new Date(query.cursor)))
    if (query.q) filters.push(or(ilike(user.email, `%${query.q}%`), ilike(user.name, `%${query.q}%`), ilike(playerProfiles.displayName, `%${query.q}%`), sql`${user.id}::text ilike ${`%${query.q}%`}`)!)
    const limit = query.limit ?? 40
    const items = await deps.db.select({
      id: user.id, email: user.email, name: user.name, displayName: playerProfiles.displayName, isAnonymous: user.isAnonymous,
      accountStatus: playerProfiles.accountStatus, role: playerProfiles.role, createdAt: user.createdAt,
      lastActivityAt: sql<Date | null>`(select max(gs."startedAt") from game_sessions gs where gs.user_id = ${user.id})`,
      sessionsCount: sql<number>`(select count(*)::int from game_sessions gs where gs.user_id = ${user.id})`,
      completedCount: sql<number>`(select count(*)::int from game_sessions gs where gs.user_id = ${user.id} and gs.status in ('won','lost'))`,
      reportsCount: sql<number>`(select count(*)::int from content_reports cr where cr.user_id = ${user.id})`,
      balance: sql<number>`coalesce(${walletAccounts.balance}, 0)`,
    }).from(user).leftJoin(playerProfiles, eq(playerProfiles.userId, user.id)).leftJoin(walletAccounts, eq(walletAccounts.userId, user.id))
      .where(filters.length ? and(...filters) : undefined).orderBy(desc(user.createdAt)).limit(limit + 1)
    return { items: items.slice(0, limit), nextCursor: items.length > limit ? items[limit - 1].createdAt.toISOString() : null }
  })

  app.get('/api/v1/admin/users/:id', { schema: { params: AdminIdParamsSchema } }, async (request, reply) => {
    await admin(request, reply, deps); const id = (request.params as { id: string }).id
    const profile = await deps.db.select({ user, profile: playerProfiles, wallet: walletAccounts }).from(user)
      .leftJoin(playerProfiles, eq(playerProfiles.userId, user.id)).leftJoin(walletAccounts, eq(walletAccounts.userId, user.id)).where(eq(user.id, id)).limit(1)
    if (!profile[0]) throw new ApiError(404, 'USER_NOT_FOUND', 'Пользователь не найден')
    const [sessions, reports, stats, attendance, ledger, entitlements, redemptions, imports, notes, auth, audit] = await Promise.all([
      deps.db.select().from(gameSessions).where(eq(gameSessions.userId, id)).orderBy(desc(gameSessions.startedAt)).limit(30),
      deps.db.select().from(contentReports).where(eq(contentReports.userId, id)).orderBy(desc(contentReports.createdAt)).limit(30),
      deps.db.select().from(userModeStats).where(eq(userModeStats.userId, id)),
      deps.db.select().from(attendanceStats).where(eq(attendanceStats.userId, id)).limit(1),
      deps.db.select().from(walletLedger).where(eq(walletLedger.userId, id)).orderBy(desc(walletLedger.createdAt)).limit(50),
      deps.db.select().from(periodEntitlements).where(eq(periodEntitlements.userId, id)),
      deps.db.select().from(promoRedemptions).where(eq(promoRedemptions.userId, id)).orderBy(desc(promoRedemptions.createdAt)),
      deps.db.select().from(legacyImports).where(eq(legacyImports.userId, id)).orderBy(desc(legacyImports.createdAt)),
      deps.db.select().from(adminUserNotes).where(eq(adminUserNotes.userId, id)).orderBy(desc(adminUserNotes.createdAt)),
      deps.db.select().from(authEvents).where(eq(authEvents.userId, id)).orderBy(desc(authEvents.occurredAt)).limit(50),
      deps.db.select().from(auditLog).where(and(eq(auditLog.entityType, 'user'), eq(auditLog.entityId, id))).orderBy(desc(auditLog.createdAt)).limit(50),
    ])
    return { ...profile[0], sessions, reports, stats, attendance: attendance[0] ?? null, ledger, entitlements, redemptions, imports, notes, authEvents: auth, audit }
  })

  app.post('/api/v1/admin/users/:id/block', { schema: { params: AdminIdParamsSchema, body: AdminBlockUserBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id; const body = request.body as AdminBlockUserBody
    if (id === actor.id) throw new ApiError(409, 'ADMIN_SELF_ACTION_FORBIDDEN', 'Нельзя заблокировать собственный аккаунт')
    const before = await deps.db.select().from(playerProfiles).where(eq(playerProfiles.userId, id)).limit(1)
    if (!before[0]) throw new ApiError(404, 'USER_NOT_FOUND', 'Пользователь не найден')
    const updated = await deps.db.update(playerProfiles).set({ accountStatus: 'blocked', blockedAt: new Date(), blockedUntil: body.blockedUntil ? new Date(body.blockedUntil) : null, blockedReason: `${body.reason}${body.comment ? `: ${body.comment}` : ''}`, blockedBy: actor.id, updatedAt: new Date() }).where(eq(playerProfiles.userId, id)).returning()
    if (body.revokeSessions ?? true) await deps.db.delete(session).where(eq(session.userId, id))
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'user.block', entityType: 'user', entityId: id, before: before[0], after: updated[0], reason: body.reason, requestId: request.id })
    return updated[0]
  })
  app.post('/api/v1/admin/users/:id/unblock', { schema: { params: AdminIdParamsSchema, body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 500 }) }, { additionalProperties: false }) } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id; const body = request.body as { reason: string }
    if (id === actor.id) throw new ApiError(409, 'ADMIN_SELF_ACTION_FORBIDDEN', 'Нельзя менять блокировку собственного аккаунта')
    const before = await deps.db.select().from(playerProfiles).where(eq(playerProfiles.userId, id)).limit(1)
    const updated = await deps.db.update(playerProfiles).set({ accountStatus: 'active', blockedAt: null, blockedUntil: null, blockedReason: null, blockedBy: null, updatedAt: new Date() }).where(eq(playerProfiles.userId, id)).returning()
    if (!updated[0]) throw new ApiError(404, 'USER_NOT_FOUND', 'Пользователь не найден')
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'user.unblock', entityType: 'user', entityId: id, before: before[0] ?? null, after: updated[0], reason: body.reason, requestId: request.id })
    return updated[0]
  })
  app.post('/api/v1/admin/users/:id/revoke-sessions', { schema: { params: AdminIdParamsSchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id
    if (id === actor.id) throw new ApiError(409, 'ADMIN_SELF_ACTION_FORBIDDEN', 'Нельзя отозвать собственные административные сессии')
    const deleted = await deps.db.delete(session).where(eq(session.userId, id)).returning({ id: session.id })
    await deps.db.insert(authEvents).values({ userId: id, eventName: 'sessions_revoked', result: 'success', requestId: request.id })
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'user.sessions.revoke', entityType: 'user', entityId: id, before: null, after: { revoked: deleted.length }, requestId: request.id })
    return { revoked: deleted.length }
  })
  app.post('/api/v1/admin/users/:id/notes', { schema: { params: AdminIdParamsSchema, body: AdminUserNoteBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id; const body = request.body as AdminUserNoteBody
    const note = (await deps.db.insert(adminUserNotes).values({ userId: id, text: body.text.trim(), createdBy: actor.id }).returning())[0]
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'user.note.create', entityType: 'user', entityId: id, before: null, after: { noteId: note.id }, requestId: request.id })
    return note
  })
  app.post('/api/v1/admin/users/:id/export', { schema: { params: AdminIdParamsSchema, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id; const key = requireIdempotencyKey(request)
    const inserted = await deps.db.insert(backgroundJobs).values({ type: 'user_export', idempotencyKey: key, createdBy: actor.id, payload: { userId: id } }).onConflictDoNothing().returning()
    const job = inserted[0] ?? (await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1))[0]
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'user.export.create', entityType: 'user', entityId: id, before: null, after: { jobId: job.id }, requestId: request.id })
    return reply.code(202).send({ job })
  })
}

const registerSystemRoutes = (app: FastifyInstance, deps: Deps) => {
  app.get('/api/v1/admin/dashboard', async (request, reply) => {
    const actor = await admin(request, reply, deps); const since24h = new Date(Date.now() - 86_400_000); const since7d = new Date(Date.now() - 7 * 86_400_000); const stale = new Date(Date.now() - deps.config.workerStaleAfterMs)
    const [active, counters, recentReports, recentChanges, recentRuns] = await Promise.all([
      deps.db.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1),
      deps.db.execute(sql`select
        (select count(*)::int from content_reports where status = 'open') "newReports",
        (select count(*)::int from content_quality_issues where status = 'open' and severity = 'critical') "criticalIssues",
        (select count(*)::int from background_jobs where status in ('queued','running')) "activeJobs",
        (select count(*)::int from background_jobs where status = 'running' and heartbeat_at < ${stale.toISOString()}::timestamptz) "stuckJobs",
        (select count(*)::int from pipeline_runs where status in ('review_required','partially_failed')) "pipelineReview",
        (select count(distinct user_id)::int from game_sessions where "startedAt" >= ${since24h.toISOString()}::timestamptz) "activeUsers24h",
        (select count(distinct user_id)::int from game_sessions where "startedAt" >= ${since7d.toISOString()}::timestamptz) "activeUsers7d",
        (select count(*)::int from game_sessions where "startedAt" >= ${since24h.toISOString()}::timestamptz) "sessionsStarted24h",
        (select count(*)::int from game_sessions where completed_at >= ${since24h.toISOString()}::timestamptz) "sessionsCompleted24h"`),
      deps.db.select().from(contentReports).where(eq(contentReports.status, 'open')).orderBy(desc(contentReports.createdAt)).limit(6),
      deps.db.select().from(contentWorkspaceChanges).orderBy(desc(contentWorkspaceChanges.updatedAt)).limit(8),
      deps.db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt)).limit(6),
    ])
    const revision = active[0]
    const counts = revision ? await deps.db.select({ mode: contentRevisionModes.mode, count: contentRevisionModes.itemsCount }).from(contentRevisionModes).where(eq(contentRevisionModes.revisionId, revision.id)) : []
    return { activeRevision: revision ? { id: revision.id, version: revision.version, createdAt: revision.createdAt, counts } : null, workspace: await workspaceSummary(deps.db, actor), counters: rows<Record<string, number>>(counters)[0], recentReports, recentChanges, recentRuns }
  })
  app.get('/api/v1/admin/events', { schema: { querystring: AdminEventsQuerySchema } }, async (request, reply) => {
    await admin(request, reply, deps); const query = request.query as AdminEventsQuery; const items = await loadAdminTimeline(deps.db, query); const limit = query.limit ?? 50
    return { items: items.slice(0, limit), nextCursor: items.length > limit ? items[limit - 1].occurredAt : null }
  })
  app.get('/api/v1/admin/game-sessions/:id/timeline', { schema: { params: AdminIdParamsSchema } }, async (request, reply) => {
    await admin(request, reply, deps); return { items: await loadAdminTimeline(deps.db, { gameSessionId: (request.params as { id: string }).id, limit: 200 } as AdminEventsQuery) }
  })
  app.post('/api/v1/admin/events/export', { schema: { body: AdminEventsQuerySchema, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const key = requireIdempotencyKey(request)
    const inserted = await deps.db.insert(backgroundJobs).values({ type: 'event_export', idempotencyKey: key, createdBy: actor.id, payload: request.body ?? {} }).onConflictDoNothing().returning()
    return reply.code(202).send({ job: inserted[0] ?? (await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1))[0] })
  })
  app.get('/api/v1/admin/jobs', async (request, reply) => { await admin(request, reply, deps); return { items: await deps.db.select().from(backgroundJobs).orderBy(desc(backgroundJobs.createdAt)).limit(200) } })
  app.get('/api/v1/admin/jobs/:id', { schema: { params: AdminIdParamsSchema } }, async (request, reply) => {
    await admin(request, reply, deps); const job = await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.id, (request.params as { id: string }).id)).limit(1)
    if (!job[0]) throw new ApiError(404, 'JOB_NOT_FOUND', 'Задача не найдена'); return job[0]
  })
  app.post('/api/v1/admin/jobs/:id/retry', { schema: { params: AdminIdParamsSchema, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id; const key = requireIdempotencyKey(request)
    const original = await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).limit(1)
    if (!original[0] || original[0].status !== 'failed') throw new ApiError(409, 'JOB_NOT_RETRYABLE', 'Задачу нельзя повторить')
    const job = await deps.db.insert(backgroundJobs).values({ type: original[0].type, idempotencyKey: key, createdBy: actor.id, pipelineRunId: original[0].pipelineRunId, payload: { ...asRecord(original[0].payload), retryOf: id } }).onConflictDoNothing().returning()
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'job.retry', entityType: 'background_job', entityId: id, before: original[0], after: job[0] ?? null, requestId: request.id })
    return reply.code(202).send({ job: job[0] ?? (await deps.db.select().from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1))[0] })
  })
  app.get('/api/v1/admin/audit-log', async (request, reply) => { await admin(request, reply, deps); return { items: await deps.db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(250) } })
  app.get('/api/v1/admin/health', async (request, reply) => {
    await admin(request, reply, deps); let database = true
    try { await deps.db.execute(sql`select 1`) } catch { database = false }
    const queued = await deps.db.select({ count: sql<number>`count(*)::int` }).from(backgroundJobs).where(sql`${backgroundJobs.status} in ('queued','running')`)
    return { status: database ? 'ok' : 'degraded', checks: { database, queueDepth: queued[0]?.count ?? 0, mediaRootConfigured: Boolean(deps.config.mediaRoot), enrichmentRootConfigured: Boolean(deps.config.enrichmentDataRoot) }, app: { version: deps.config.appVersion, gitSha: deps.config.gitSha } }
  })
  app.get('/api/v1/admin/promos', async (request, reply) => {
    await admin(request, reply, deps); return { items: await deps.db.select({ promo: promoCodes, redemptions: sql<number>`(select count(*)::int from promo_redemptions pr where pr.promo_id = ${promoCodes.id})` }).from(promoCodes).orderBy(desc(promoCodes.createdAt)) }
  })
  app.get('/api/v1/admin/settings', async (request, reply) => { await admin(request, reply, deps); return { items: await deps.db.select().from(appSettings).orderBy(asc(appSettings.key)) } })
  app.get('/api/v1/admin/quality-issues', async (request, reply) => {
    await admin(request, reply, deps)
    await deps.db.update(contentQualityIssues).set({ status: 'open', acceptedUntil: null, acceptedComment: null })
      .where(and(eq(contentQualityIssues.status, 'accepted'), lt(contentQualityIssues.acceptedUntil, new Date())))
    return { items: await deps.db.select().from(contentQualityIssues).where(sql`${contentQualityIssues.status} <> 'resolved'`).orderBy(desc(contentQualityIssues.createdAt)).limit(250) }
  })
  app.patch('/api/v1/admin/quality-issues/:id', { schema: { params: AdminIdParamsSchema, body: AdminQualityIssuePatchBodySchema } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id; const body = request.body as AdminQualityIssuePatchBody
    if (body.status === 'accepted' && !body.comment?.trim()) throw new ApiError(422, 'QUALITY_ACCEPT_COMMENT_REQUIRED', 'Укажите причину допустимого исключения')
    if (body.status === 'accepted' && body.acceptedUntil && new Date(body.acceptedUntil) <= new Date()) throw new ApiError(422, 'QUALITY_ACCEPT_UNTIL_INVALID', 'Срок исключения должен быть в будущем')
    const before = await deps.db.select().from(contentQualityIssues).where(eq(contentQualityIssues.id, id)).limit(1)
    if (!before[0]) throw new ApiError(404, 'QUALITY_ISSUE_NOT_FOUND', 'Проблема качества не найдена')
    const updated = await deps.db.update(contentQualityIssues).set({
      status: body.status,
      acceptedComment: body.status === 'accepted' ? body.comment!.trim() : null,
      acceptedUntil: body.status === 'accepted' && body.acceptedUntil ? new Date(body.acceptedUntil) : null,
    }).where(eq(contentQualityIssues.id, id)).returning()
    await deps.db.insert(auditLog).values({ actorUserId: actor.id, action: 'content_quality.acceptance', entityType: 'content_quality_issue', entityId: id, before: before[0], after: updated[0], reason: body.comment ?? undefined, requestId: request.id })
    return updated[0]
  })
  app.get('/api/v1/admin/daily-challenges', async (request, reply) => {
    await admin(request, reply, deps); const today = getMoscowDate()
    return { today, items: await deps.db.select({ challenge: dailyChallenges, titleRu: contentItemVersions.titleRu, itemId: contentItemVersions.itemId })
      .from(dailyChallenges).innerJoin(contentItemVersions, eq(contentItemVersions.id, dailyChallenges.answerItemVersionId))
      .where(gt(dailyChallenges.puzzleDate, today)).orderBy(asc(dailyChallenges.puzzleDate), asc(dailyChallenges.mode)).limit(250) }
  })
  app.post('/api/v1/admin/daily-challenges/:id/replace', { schema: { params: AdminIdParamsSchema, body: AdminDailyChallengeReplaceBodySchema, headers: idempotencyHeaders } }, async (request, reply) => {
    const actor = await admin(request, reply, deps); const id = (request.params as { id: string }).id; const body = request.body as AdminDailyChallengeReplaceBody; const today = getMoscowDate()
    return deps.db.transaction(async (tx) => {
      const challenge = (await tx.select().from(dailyChallenges).where(eq(dailyChallenges.id, id)).for('update').limit(1))[0]
      if (!challenge) throw new ApiError(404, 'DAILY_CHALLENGE_NOT_FOUND', 'Загадка не найдена')
      if (challenge.puzzleDate <= today) throw new ApiError(409, 'DAILY_CHALLENGE_CURRENT_LOCKED', 'Текущую или прошедшую загадку заменять нельзя')
      const started = await tx.select({ id: gameSessions.id }).from(gameSessions).where(eq(gameSessions.challengeId, id)).limit(1)
      if (started[0]) throw new ApiError(409, 'DAILY_CHALLENGE_ALREADY_STARTED', 'Для этой загадки уже есть игровая сессия')
      const replacement = (await tx.select({ id: contentItemVersions.id, itemId: contentItemVersions.itemId, mode: contentItemVersions.mode, revisionId: contentItemVersions.revisionId })
        .from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
        .where(and(eq(contentItemVersions.itemId, body.itemId), eq(contentItemVersions.mode, challenge.mode), eq(contentItemVersions.allowedInGame, true), eq(contentRevisions.status, 'active'))).limit(1))[0]
      if (!replacement) throw new ApiError(422, 'DAILY_REPLACEMENT_NOT_ELIGIBLE', 'Новая карточка должна быть разрешена в active revision и совпадать по режиму')
      if (replacement.id === challenge.answerItemVersionId) throw new ApiError(409, 'DAILY_REPLACEMENT_UNCHANGED', 'Эта карточка уже выбрана для загадки')
      const updated = (await tx.update(dailyChallenges).set({ revisionId: replacement.revisionId, answerItemVersionId: replacement.id }).where(eq(dailyChallenges.id, id)).returning())[0]
      await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'daily_challenge.replace_future', entityType: 'daily_challenge', entityId: id, before: challenge, after: updated, reason: body.reason, requestId: request.id })
      return { challenge: updated, previousItemVersionId: challenge.answerItemVersionId, itemId: replacement.itemId }
    })
  })
}

export const registerAdminRoutes = async (app: FastifyInstance, deps: Deps) => {
  registerContentRoutes(app, deps)
  registerReportRoutes(app, deps)
  registerPipelineRoutes(app, deps)
  registerIntegrationRoutes(app, deps)
  registerUserRoutes(app, deps)
  registerSystemRoutes(app, deps)
}

export const registerClientEventRoutes = async (app: FastifyInstance, deps: Deps) => {
  app.post('/api/v1/client-events/batch', { schema: { body: ClientEventsBatchBodySchema }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, bodyLimit: 64 * 1024 }, async (request) => {
    const actor = await getRequestUser(request, deps.auth, deps.db, true, deps.config); const body = request.body as ClientEventsBatchBody
    const cutoff = Date.now() + 5 * 60_000
    const values = body.events.map((event) => {
      const occurredAt = new Date(event.occurredAt)
      if (occurredAt.getTime() > cutoff || occurredAt.getTime() < Date.now() - 7 * 86_400_000) throw new ApiError(422, 'EVENT_TIME_INVALID', 'Время события вне допустимого диапазона')
      const properties = Object.fromEntries(Object.entries(event.properties ?? {}).filter(([key]) => !/(?:token|password|secret|authorization|cookie|api[_-]?key|session[_-]?id)/i.test(key)))
      return { ...event, occurredAt, userId: actor!.id, authSessionId: actor!.authSessionId, properties, gameSessionId: event.gameSessionId ?? null }
    })
    const inserted = await deps.db.insert(clientEvents).values(values).onConflictDoNothing().returning({ id: clientEvents.id })
    return { accepted: inserted.length, duplicates: values.length - inserted.length }
  })
}
