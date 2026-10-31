import { createReadStream } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AppConfig } from '@shoditsa/config'
import type { Database } from '@shoditsa/database'
import type { EditableQuestion, SvoyakLibrarySnapshot } from '@shoditsa/contracts/svoyak'
import { ApiError } from '../../lib/errors.js'

export const LIBRARY_KEY = 'svoyak.editor.library.v1'
export const sourceIdentity = (id: string) => id.replace(/^(\d+):[a-f0-9]{8,64}:/, '$1:')
export const REVIEW_CHECKS = [
  'facts',
  'clarity',
  'style',
  'answers',
  'category',
  'safety',
  'duplicates',
  'media',
] as const
type Query = Pick<Database, 'execute'>
const cache = new WeakMap<Query, { version: number; value: SvoyakLibrarySnapshot }>()
export async function loadEditorLibrary(db: Query, cacheKey: Query = db) {
  const versions = await db.execute(sql`select version from app_settings where key=${LIBRARY_KEY}`)
  if (!versions[0]) return null
  const version = Number(versions[0].version),
    previous = cache.get(cacheKey)
  if (previous?.version === version) return previous.value
  const rows = await db.execute(sql`select value from app_settings where key=${LIBRARY_KEY}`)
  const value = (rows[0]?.value ?? null) as SvoyakLibrarySnapshot | null
  if (value) cache.set(cacheKey, { version, value })
  return value
}

/** Original source records never overwrite a saved production or editorial version. */
export function mergeEditorLibrary(library: SvoyakLibrarySnapshot | null, questions: EditableQuestion[]) {
  const entries = new Map<string, EditableQuestion>()
  for (const q of library?.questions ?? []) entries.set(sourceIdentity(q.id), { ...q, enabled: false })
  for (const q of questions) entries.set(sourceIdentity(q.id), q)
  return [...entries.values()]
}

const admissionFingerprint = (q: EditableQuestion) =>
  JSON.stringify([
    q.prompt,
    q.answer,
    q.aliases,
    q.themeId,
    q.theme,
    q.topic,
    q.note,
    q.difficulty,
    q.age,
    q.duplicateIds,
    q.media ?? [],
  ])
export function validateNewAdmissions(
  questions: EditableQuestion[],
  previouslyEnabled: EditableQuestion[],
  library: SvoyakLibrarySnapshot | null
) {
  const old = new Map(previouslyEnabled.map((q) => [sourceIdentity(q.id), q]))
  for (const q of questions) {
    const previous = old.get(sourceIdentity(q.id))
    if (!q.enabled || (previous && admissionFingerprint(previous) === admissionFingerprint(q))) continue
    const source = library?.sources[sourceIdentity(q.sourceQuestionId ?? q.id)]
    if (!source) continue
    if (!REVIEW_CHECKS.every((check) => q.review?.checks[check]))
      throw new ApiError(422, 'REVIEW_REQUIRED', 'Пройдите все восемь проверок допуска: ' + q.id)
    if (
      source.media.length &&
      !q.media?.length &&
      (!q.review?.textOnlyAdaptation || q.prompt === source.originalPrompt)
    )
      throw new ApiError(
        422,
        'MEDIA_ADAPTATION_REQUIRED',
        'Для вопроса без исходных медиа нужна самостоятельная текстовая версия: ' + q.id
      )
    if (source.media.some((m) => m.status !== 'available') && !q.review?.missingMediaResolved)
      throw new ApiError(422, 'MEDIA_REVIEW_REQUIRED', 'Подтвердите замену недоступных исходных медиа: ' + q.id)
  }
}

export const editorLibraryRoot = (config: AppConfig) =>
  resolve(process.env.SVOYAK_LIBRARY_ROOT || join(config.mediaRoot, '..', 'svoyak-library'))
export function libraryAsset(library: SvoyakLibrarySnapshot | null, sha: string, config: AppConfig) {
  const asset = library?.assets[sha]
  if (
    asset &&
    !/^(image\/(jpeg|png|webp|gif|bmp)|audio\/(mpeg|wav|x-wav|ogg|flac|mp4|webm)|video\/(mp4|webm|quicktime))$/.test(
      asset.mime
    )
  )
    throw new ApiError(422, 'MEDIA_FORMAT', 'Unsupported media format')
  if (
    !asset ||
    !/^(image\/(jpeg|png|webp|gif|bmp)|audio\/(mpeg|wav|x-wav|ogg|flac|mp4|webm)|video\/(mp4|webm|quicktime))$/.test(
      asset.mime
    ) ||
    !/^[a-f0-9]{64}$/.test(sha) ||
    !new RegExp(`^[a-f0-9]{2}/${sha}\\.[a-z0-9]{1,8}$`).test(asset.path)
  )
    throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Исходный файл не найден')
  return { ...asset, file: join(editorLibraryRoot(config), 'assets', asset.path) }
}

/** Ranges are required for seeking in audio/video. The route is admin-authenticated. */
export async function serveLibraryAsset(
  request: FastifyRequest,
  reply: FastifyReply,
  library: SvoyakLibrarySnapshot | null,
  sha: string,
  config: AppConfig
) {
  const asset = libraryAsset(library, sha, config),
    info = await stat(asset.file).catch(() => null)
  if (!info?.isFile() || info.size !== asset.bytes)
    throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Исходный файл пока не загружен на сервер')
  reply
    .header('Accept-Ranges', 'bytes')
    .header('Content-Type', asset.mime)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, no-store')
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range)
    const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, info.size - Number(match[2])) : NaN
    const end = match?.[1] && match[2] ? Math.min(info.size - 1, Number(match[2])) : info.size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= info.size || end < start)
      return reply.header('Content-Range', `bytes */${info.size}`).code(416).send()
    reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${info.size}`)
      .header('Content-Length', end - start + 1)
    return reply.send(createReadStream(asset.file, { start, end }))
  }
  reply.header('Content-Length', info.size)
  return reply.send(createReadStream(asset.file))
}

/** Only explicitly admitted media are copied into the public game media namespace. */
export async function publishLibraryMedia(
  questions: EditableQuestion[],
  library: SvoyakLibrarySnapshot | null,
  config: AppConfig
) {
  for (const q of questions) {
    if (!q.enabled) continue
    for (const media of q.media ?? []) {
      const sha = /^\/api\/v1\/admin\/svoyak\/library\/media\/([a-f0-9]{64})$/.exec(media.url)?.[1]
      if (!sha) continue
      const asset = libraryAsset(library, sha, config),
        target = join(config.mediaRoot, 'svoyak', 'released', asset.path)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(asset.file, target).catch(() => {
        throw new ApiError(422, 'MEDIA_NOT_FOUND', 'Сначала загрузите исходный файл: ' + q.id)
      })
      media.url = `${config.publicMediaBaseUrl.replace(/\/$/, '')}/svoyak/released/${asset.path}`
    }
  }
}
