import {
  loadEditorLibrary,
  mergeEditorLibrary,
  serveLibraryAsset,
  publishLibraryMedia,
  validateNewAdmissions,
  sourceIdentity,
} from './editor-library.js'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { sql } from 'drizzle-orm'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '@shoditsa/config'
import type { Database } from '@shoditsa/database'
import type { EditableQuestion, SvoyakWorkspace, Catalog } from '@shoditsa/contracts/svoyak'
import { buildMix } from '@shoditsa/game-core/svoyak-mix'
import type { Auth } from '../auth/auth.js'
import { requireAdmin } from '../auth/session.js'
import { ApiError } from '../../lib/errors.js'
import { normalizeWorkspace, revisionCatalog } from './admin-content.js'

type Deps = { db: Database; auth: Auth; config: AppConfig }
const key = 'svoyak.editor.workspace.v1'
const text = (maxLength = 10000) => Type.String({ maxLength })
const media = Type.Object(
  {
    kind: Type.Union(['image', 'audio', 'video'].map((v) => Type.Literal(v))),
    url: text(2000),
    caption: text(500),
    phase: Type.Union([Type.Literal('question'), Type.Literal('answer')]),
  },
  { additionalProperties: false }
)
const question = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 160 }),
    hash: text(128),
    themeId: text(200),
    theme: text(300),
    topic: Type.String({ pattern: '^[a-z-]{1,40}$' }),
    packId: Type.Integer({ minimum: 1 }),
    packTitle: text(300),
    prompt: text(),
    answer: text(),
    aliases: Type.Array(text(500), { maxItems: 100 }),
    note: text(),
    source: text(2000),
    difficulty: Type.Integer({ minimum: 1, maximum: 5 }),
    age: Type.Union([0, 6, 12, 16, 18].map((v) => Type.Literal(v))),
    duplicateIds: Type.Array(text(160), { maxItems: 100 }),
    enabled: Type.Boolean(),
    sourceQuestionId: Type.Optional(text(160)),
    review: Type.Optional(
      Type.Object(
        {
          checks: Type.Record(Type.String(), Type.Boolean()),
          textOnlyAdaptation: Type.Boolean(),
          missingMediaResolved: Type.Boolean(),
        },
        { additionalProperties: false }
      )
    ),
    media: Type.Optional(Type.Array(media, { maxItems: 64 })),
  },
  { additionalProperties: false }
)
const versionBody = Type.Object({ version: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })
const conflict = () =>
  new ApiError(
    409,
    'WORKSPACE_CHANGED',
    'База или черновик изменились в другой вкладке. Сохраните свои правки отдельно и обновите страницу.'
  )

export function registerSvoyakAdminRoutes(app: FastifyInstance, deps: Deps) {
  app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      await requireAdmin(request, deps.auth, deps.db, deps.config)
      if (
        !['GET', 'HEAD'].includes(request.method) &&
        (!request.headers.origin || !deps.config.trustedOrigins.includes(request.headers.origin))
      )
        throw new ApiError(403, 'ORIGIN_REJECTED', 'Откройте редактор на сайте')
    })
    const active = async (db: Pick<Database, 'execute'> = deps.db) => {
      const revisions = await db.execute(sql`select id,catalog from svoyak_content_revisions where status='active'`)
      if (!revisions[0]) throw new ApiError(503, 'BANK_UNAVAILABLE', 'Активная база вопросов не найдена')
      return { id: String(revisions[0].id), catalog: revisions[0].catalog as Catalog }
    }
    const state = async () => {
      return deps.db.transaction(
        async (tx) => {
          const current = await active(tx)
          const rows = await tx.execute(sql`select value,version from app_settings where key=${key}`)
          const saved = rows[0]?.value as SvoyakWorkspace | null
          const version = Number(rows[0]?.version ?? 0)
          const library = await loadEditorLibrary(tx, deps.db)
          const versioned = saved
            ? saved.questions
            : (
                await tx.execute(
                  sql`select payload,approved from svoyak_questions where revision_id=${current.id} order by id`
                )
              ).map((r) => ({ ...(r.payload as EditableQuestion), enabled: Boolean(r.approved) }))
          const questions = mergeEditorLibrary(library, versioned)
          const baseCatalog = saved?.catalog ?? current.catalog
          const packs = new Map((library?.packs ?? []).map((p) => [p.id, p]))
          for (const p of baseCatalog.packs) packs.set(p.id, p)
          for (const q of questions)
            if (!packs.has(q.packId))
              packs.set(q.packId, { id: q.packId, title: q.packTitle, total: 0, playable: 0, topics: [] })
          const topics = new Map((library?.topics ?? []).map((t) => [t.id, t]))
          for (const t of baseCatalog.topics) topics.set(t.id, t)
          const labels: Record<string, string> = {
            games: 'Игры',
            anime: 'Аниме',
            food: 'Еда',
            art: 'Искусство',
            people: 'Люди',
          }
          for (const q of questions)
            if (!topics.has(q.topic))
              topics.set(q.topic, { id: q.topic, label: labels[q.topic] ?? q.topic, playable: 0 })
          const catalog = {
            ...baseCatalog,
            total: questions.length,
            packs: [...packs.values()],
            topics: [...topics.values()],
          }
          const revisions = await tx.execute(
            sql`select id,status,created_at,catalog->>'total' as count from svoyak_content_revisions order by created_at desc limit 30`
          )
          return {
            activeRevision: current.id,
            draft: Boolean(saved),
            workspace: { version, baseRevision: saved?.baseRevision ?? current.id, catalog, questions },
            sources: library
              ? Object.fromEntries(
                  Object.entries(library.sources).map(([id, s]) => [
                    id,
                    { ...s, history: [], evidence: [], edition: null, originalAtoms: [] },
                  ])
                )
              : undefined,
            library: library ? { summary: library.summary, importedAt: library.importedAt } : undefined,
            revisions: revisions.map((r) => ({
              id: String(r.id),
              status: String(r.status),
              createdAt: String(r.created_at),
              count: Number(r.count),
            })),
          }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' }
      )
    }
    const lock = async (tx: Pick<Database, 'execute'>, version: number) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('svoyak-content-activation'))`)
      const rows = await tx.execute(sql`select version,value from app_settings where key=${key} for update`)
      if (Number(rows[0]?.version ?? 0) !== version) throw conflict()
      return rows[0]?.value as SvoyakWorkspace | null
    }
    const write = async (
      tx: Pick<Database, 'execute'>,
      value: SvoyakWorkspace | null,
      version: number,
      actor: string
    ) => {
      await tx.execute(
        sql`insert into app_settings(key,value,version,updated_by) values(${key},${JSON.stringify(value)}::jsonb,${version + 1},${actor}) on conflict(key) do update set value=excluded.value,version=excluded.version,updated_by=excluded.updated_by,"updatedAt"=now()`
      )
    }
    const audit = async (
      tx: Pick<Database, 'execute'>,
      actor: string,
      action: string,
      entity: string,
      requestId: string
    ) => {
      await tx.execute(
        sql`insert into audit_log(actor_user_id,action,entity_type,entity_id,reason,result,request_id) values(${actor},${action},'svoyak_content_revision',${entity},'Редактор своей игры','success',${requestId})`
      )
    }
    scope.get('/api/v1/admin/svoyak', state)
    scope.get('/api/v1/admin/svoyak/library/source/:id', async (request) => {
      const library = await loadEditorLibrary(deps.db),
        source = library?.sources[sourceIdentity((request.params as { id: string }).id)]
      if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'Исходник не найден')
      return source
    })
    scope.get(
      '/api/v1/admin/svoyak/library/media/:sha',
      { schema: { params: Type.Object({ sha: Type.String({ pattern: '^[a-f0-9]{64}$' }) }) } },
      async (request, reply) =>
        serveLibraryAsset(
          request,
          reply,
          await loadEditorLibrary(deps.db),
          (request.params as { sha: string }).sha,
          deps.config
        )
    )
    scope.put(
      '/api/v1/admin/svoyak/workspace',
      {
        bodyLimit: 18 * 1024 * 1024,
        schema: {
          body: Type.Object(
            {
              version: Type.Integer({ minimum: 0 }),
              baseRevision: text(100),
              questions: Type.Array(question, { maxItems: 20000 }),
              catalog: Type.Object(
                {
                  revision: text(100),
                  localOnly: Type.Boolean(),
                  total: Type.Integer(),
                  playable: Type.Integer(),
                  packs: Type.Array(
                    Type.Object(
                      {
                        id: Type.Integer({ minimum: 1 }),
                        title: text(300),
                        total: Type.Integer(),
                        playable: Type.Integer(),
                        topics: Type.Array(text(40)),
                      },
                      { additionalProperties: false }
                    ),
                    { maxItems: 2000 }
                  ),
                  topics: Type.Array(
                    Type.Object(
                      { id: Type.String({ pattern: '^[a-z-]{1,40}$' }), label: text(200), playable: Type.Integer() },
                      { additionalProperties: false }
                    ),
                    { maxItems: 100 }
                  ),
                },
                { additionalProperties: false }
              ),
            },
            { additionalProperties: false }
          ),
        },
      },
      async (request) => {
        const actor = await requireAdmin(request, deps.auth, deps.db, deps.config),
          body = normalizeWorkspace(request.body as SvoyakWorkspace)
        await deps.db.transaction(async (tx) => {
          await lock(tx, body.version)
          if ((await active(tx)).id !== body.baseRevision) throw conflict()
          await write(tx, body, body.version, actor.id)
          await audit(tx, actor.id, 'svoyak.workspace.save', body.baseRevision, request.id)
        })
        return state()
      }
    )
    scope.post('/api/v1/admin/svoyak/publish', { schema: { body: versionBody } }, async (request) => {
      const actor = await requireAdmin(request, deps.auth, deps.db, deps.config),
        { version } = request.body as { version: number }
      await deps.db.transaction(async (tx) => {
        const draft = await lock(tx, version)
        if (!draft) throw new ApiError(409, 'DRAFT_REQUIRED', 'Сначала сохраните черновик')
        if ((await active(tx)).id !== draft.baseRevision) throw conflict()
        const value = normalizeWorkspace(draft),
          id = 'editor-' + randomUUID()
        const questions = value.questions.filter((q) => q.enabled)
        // Verify that a normal default game can still be assembled, including duplicate checks.
        try {
          buildMix(
            { catalog: value.catalog, questions },
            [
              {
                id: 'preview',
                name: 'Проверка',
                avatar: 'cat',
                role: 'player',
                ready: true,
                preferences: { topics: [] },
                score: 0,
              },
            ],
            { rounds: 1, themesPerRound: 3, secondsPerQuestion: 30, age: 18 },
            id
          )
        } catch (error) {
          throw new ApiError(
            422,
            'BANK_NOT_PLAYABLE',
            error instanceof Error ? error.message : 'Недостаточно полных тем'
          )
        }
        const library = await loadEditorLibrary(tx)
        const approved = await tx.execute(
          sql`select payload from svoyak_questions where revision_id=${draft.baseRevision} and approved=true`
        )
        validateNewAdmissions(
          value.questions,
          approved.map((r) => r.payload as EditableQuestion),
          library
        )
        await publishLibraryMedia(value.questions, library, deps.config)
        value.questions = normalizeWorkspace(value).questions
        const catalog = revisionCatalog(value, id)
        await tx.execute(
          sql`insert into svoyak_content_revisions(id,status,catalog,provenance) values(${id},'ready',${JSON.stringify(catalog)}::jsonb,${JSON.stringify({ source: 'admin', actorId: actor.id, baseRevision: draft.baseRevision })}::jsonb)`
        )
        await tx.execute(
          sql`insert into svoyak_questions(revision_id,id,content_hash,payload,approved) select ${id},q->>'id',q->>'hash',q-'enabled',(q->>'enabled')::boolean from jsonb_array_elements(${JSON.stringify(value.questions)}::jsonb) q`
        )
        await tx.execute(sql`update svoyak_content_revisions set status='retired' where status='active'`)
        await tx.execute(sql`update svoyak_content_revisions set status='active' where id=${id}`)
        await write(tx, null, version, actor.id)
        await audit(tx, actor.id, 'svoyak.release', id, request.id)
      })
      return state()
    })
    scope.post('/api/v1/admin/svoyak/discard', { schema: { body: versionBody } }, async (request) => {
      const actor = await requireAdmin(request, deps.auth, deps.db, deps.config),
        { version } = request.body as { version: number }
      await deps.db.transaction(async (tx) => {
        await lock(tx, version)
        await write(tx, null, version, actor.id)
        await audit(tx, actor.id, 'svoyak.workspace.discard', key, request.id)
      })
      return state()
    })
    scope.post(
      '/api/v1/admin/svoyak/media',
      {
        bodyLimit: 29 * 1024 * 1024,
        schema: {
          body: Type.Object(
            { base64: Type.String({ maxLength: 28 * 1024 * 1024 }), contentType: text(100) },
            { additionalProperties: false }
          ),
        },
      },
      async (request, reply) => {
        const actor = await requireAdmin(request, deps.auth, deps.db, deps.config),
          body = request.body as { base64: string; contentType: string }
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64) || body.base64.length % 4)
          throw new ApiError(422, 'MEDIA_INVALID', 'Файл повреждён')
        let data = Buffer.from(body.base64, 'base64'),
          extension = '',
          kind = ''
        if (!data.length || data.length > 18 * 1024 * 1024)
          throw new ApiError(413, 'MEDIA_TOO_LARGE', 'Максимальный размер файла — 18 МБ')
        if (['image/jpeg', 'image/png', 'image/webp'].includes(body.contentType)) {
          try {
            data = await sharp(data, { limitInputPixels: 40_000_000 })
              .rotate()
              .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 90 })
              .toBuffer()
          } catch {
            throw new ApiError(422, 'MEDIA_INVALID', 'Не удалось прочитать изображение')
          }
          extension = 'webp'
          kind = 'image'
        } else if (
          body.contentType === 'audio/mpeg' &&
          (data.subarray(0, 3).toString() === 'ID3' || (data[0] === 255 && (data[1] & 224) === 224))
        ) {
          extension = 'mp3'
          kind = 'audio'
        } else if (
          ['audio/wav', 'audio/x-wav'].includes(body.contentType) &&
          data.subarray(0, 4).toString() === 'RIFF' &&
          data.subarray(8, 12).toString() === 'WAVE'
        ) {
          extension = 'wav'
          kind = 'audio'
        } else if (body.contentType === 'audio/ogg' && data.subarray(0, 4).toString() === 'OggS') {
          extension = 'ogg'
          kind = 'audio'
        } else if (body.contentType === 'video/mp4' && data.subarray(4, 8).toString() === 'ftyp') {
          extension = 'mp4'
          kind = 'video'
        } else if (
          ['video/webm', 'audio/webm'].includes(body.contentType) &&
          data.subarray(0, 4).toString('hex') === '1a45dfa3'
        ) {
          extension = 'webm'
          kind = body.contentType.startsWith('audio') ? 'audio' : 'video'
        } else throw new ApiError(422, 'MEDIA_FORMAT', 'Поддерживаются JPEG, PNG, WebP, MP3, WAV, OGG, MP4 и WebM')
        const digest = createHash('sha256').update(data).digest('hex'),
          directory = join(deps.config.mediaRoot, 'svoyak', digest.slice(0, 2))
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, `${digest}.${extension}`), data, { flag: 'wx' }).catch(
          (e: NodeJS.ErrnoException) => {
            if (e.code !== 'EEXIST') throw e
          }
        )
        const url = `${deps.config.publicMediaBaseUrl.replace(/\/$/, '')}/svoyak/${digest.slice(0, 2)}/${digest}.${extension}`
        await audit(deps.db, actor.id, 'svoyak.media.upload', digest, request.id)
        return reply.code(201).send({ url, kind, bytes: data.length })
      }
    )
  })
}
