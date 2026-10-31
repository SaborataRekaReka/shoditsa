import { sourceIdentity, REVIEW_CHECKS } from '../src/modules/svoyak/editor-library.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { createDatabase, user, playerProfiles } from '@shoditsa/database'
import type { Auth } from '../src/modules/auth/auth.js'
import type { SvoyakAdminState, SvoyakLibrarySnapshot, EditableQuestion } from '@shoditsa/contracts/svoyak'
import type { Bank } from '@shoditsa/game-core/svoyak-bank'
import { RoomService } from '@shoditsa/game-core/svoyak'
import { registerSvoyakAdminRoutes } from '../src/modules/svoyak/admin-routes.js'
import { normalizeWorkspace } from '../src/modules/svoyak/admin-content.js'
import { sendError } from '../src/lib/errors.js'

const origin = 'http://localhost:5193',
  actor = randomUUID(),
  outsider = randomUUID()
const config = {
  ...loadConfig(),
  databasePoolMax: 1,
  adminUserIds: [actor],
  adminEmails: ['breneize@yandex.ru'],
  trustedOrigins: [origin],
  mediaRoot: '.tmp/editor-media',
}
const { db, client } = createDatabase(config),
  app = Fastify()
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = headers.get('cookie')
      return id && ([actor, outsider] as string[]).includes(id)
        ? { user: { id, email: 'breneize@yandex.ru', name: 'Editor test' }, session: { id: randomUUID() } }
        : null
    },
  },
} as unknown as Auth
const headers = { origin, cookie: actor }
let release: Bank
async function state() {
  const response = await app.inject({ url: '/api/v1/admin/svoyak', headers })
  expect(response.statusCode, response.body).toBe(200)
  return response.json() as SvoyakAdminState
}
async function save(value: SvoyakAdminState['workspace']) {
  return app.inject({ method: 'PUT', url: '/api/v1/admin/svoyak/workspace', headers, payload: value })
}

describe('Svoyak editor with isolated PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(config.databaseUrl)
    if (config.production || url.hostname !== '127.0.0.1' || url.pathname !== '/svoyak_editor_test')
      throw Error('Only isolated svoyak_editor_test is allowed')
    await db.execute(sql`truncate svoyak_content_revisions cascade`)
    await db.execute(
      sql`delete from app_settings where key in ('svoyak.editor.workspace.v1','svoyak.editor.library.v1')`
    )
    await db
      .insert(user)
      .values([actor, outsider].map((id) => ({ id, email: id + '@example.test', name: 'Editor QA' })))
    await db.insert(playerProfiles).values({ userId: actor, role: 'admin' })
    release = JSON.parse(await readFile('data/svoyak/release-v1.json', 'utf8'))
    await db.execute(
      sql`insert into svoyak_content_revisions(id,status,catalog,provenance) values(${release.catalog.revision},'active',${JSON.stringify(release.catalog)}::jsonb,'{}')`
    )
    await db.execute(
      sql`insert into svoyak_questions(revision_id,id,content_hash,payload) select ${release.catalog.revision},q->>'id',q->>'hash',q from jsonb_array_elements(${JSON.stringify(release.questions)}::jsonb) q`
    )
    app.setErrorHandler((error, request, reply) => {
      if (!(error as { statusCode?: number }).statusCode)
        console.error((error as { cause?: { message?: string } }).cause?.message ?? (error as Error).message)
      return sendError(request, reply, error)
    })
    registerSvoyakAdminRoutes(app, { db, auth, config })
    await app.ready()
  }, 120000)
  afterAll(async () => {
    await app.close()
    await client.end()
  })
  it('guards all editor routes, answers and uploads against guests, non-admins and foreign origins', async () => {
    for (const route of ['/api/v1/admin/svoyak', '/api/v1/admin/svoyak/media']) {
      const method = route.endsWith('media') ? 'POST' : 'GET',
        payload = method === 'POST' ? { base64: 'aGVsbG8=', contentType: 'image/png' } : undefined
      expect((await app.inject({ method, url: route, payload })).statusCode).toBe(401)
      expect(
        (await app.inject({ method, url: route, headers: { ...headers, cookie: outsider }, payload })).statusCode
      ).toBe(403)
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/admin/svoyak/discard',
          headers: { ...headers, origin: 'https://other.test' },
          payload: { version: 0 },
        })
      ).statusCode
    ).toBe(403)
  })
  it('saves and reloads a draft, rejects stale writes and preserves the immutable active release', async () => {
    const before = await state(),
      workspace = structuredClone(before.workspace)
    workspace.questions[0].prompt = 'Новая формулировка для проверки'
    workspace.questions[0].media = [
      { kind: 'audio', url: 'https://example.test/question.mp3', caption: 'Запись', phase: 'question' },
      { kind: 'image', url: 'https://example.test/answer.webp', caption: 'Ответ', phase: 'answer' },
    ]
    const response = await save(workspace)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().workspace.version).toBe(1)
    expect((await state()).workspace.questions[0].prompt).toBe(workspace.questions[0].prompt)
    expect((await save(workspace)).statusCode).toBe(409)
    const old = await db.execute(
      sql`select payload from svoyak_questions where revision_id=${release.catalog.revision} and id=${workspace.questions[0].id}`
    )
    expect((old[0].payload as { prompt: string }).prompt).not.toBe(workspace.questions[0].prompt)
    expect(response.json().workspace.questions[0].hash).not.toBe(workspace.questions[0].hash)
  })
  it('publishes a separate revision atomically with matching hashes and catalog counts', async () => {
    const before = await state(),
      response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/svoyak/publish',
        headers,
        payload: { version: before.workspace.version },
      })
    expect(response.statusCode, response.body).toBe(200)
    const after = response.json() as SvoyakAdminState
    expect(after.draft).toBe(false)
    expect(after.activeRevision).not.toBe(before.activeRevision)
    expect(after.workspace.catalog.revision).toBe(after.activeRevision)
    const rows = await db.execute(sql`select id,status from svoyak_content_revisions`)
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1)
    expect(rows.find((r) => r.id === before.activeRevision)?.status).toBe('retired')
    const broken = await db.execute(
      sql`select id from svoyak_questions where revision_id=${after.activeRevision} and content_hash<>payload->>'hash'`
    )
    expect(broken).toHaveLength(0)
    expect(after.workspace.catalog.total).toBe(after.workspace.questions.length)
  })
  it('rejects unsafe media and unplayable publication without retiring the active release', async () => {
    const before = await state(),
      work = structuredClone(before.workspace)
    work.questions[0].media = [{ kind: 'image', url: 'javascript:alert(1)', caption: '', phase: 'question' }]
    expect((await save(work)).statusCode).toBe(422)
    work.questions[0].media = []
    work.questions.forEach((q) => (q.enabled = false))
    const saved = await save(work)
    expect(saved.statusCode, saved.body).toBe(200)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/svoyak/publish',
      headers,
      payload: { version: saved.json().workspace.version },
    })
    expect(response.statusCode).toBe(422)
    expect((await state()).activeRevision).toBe(before.activeRevision)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/admin/svoyak/media',
          headers,
          payload: { base64: 'aGVsbG8=', contentType: 'video/mp4' },
        })
      ).statusCode
    ).toBe(422)
    const discarded = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/svoyak/discard',
      headers,
      payload: { version: saved.json().workspace.version },
    })
    expect(discarded.statusCode).toBe(200)
    expect(discarded.json().draft).toBe(false)
  })
  it('rebuilds counts for disabled questions and refuses duplicate IDs', async () => {
    const work = (await state()).workspace
    work.questions[0].enabled = false
    const normalized = normalizeWorkspace(work)
    expect(normalized.catalog.total).toBe(work.questions.length)
    expect(normalized.catalog.playable).toBeLessThan(work.questions.length)
    work.questions.push(work.questions[0])
    expect(() => normalizeWorkspace(work)).toThrow('ID вопроса повторяется')
  })
  it('uploads a real image, manages packs and questions and keeps removed questions in the prior release', async () => {
    const image = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#8275bc' } })
      .png()
      .toBuffer()
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/svoyak/media',
      headers,
      payload: { base64: image.toString('base64'), contentType: 'image/png' },
    })
    expect(uploaded.statusCode, uploaded.body).toBe(201)
    expect(uploaded.json().kind).toBe('image')
    expect(uploaded.json().url).toMatch(/\/svoyak\/.+\.webp$/)
    const before = await state(),
      work = structuredClone(before.workspace),
      removed = work.questions.pop()!
    work.catalog.packs.push({ id: 999999, title: 'Новый пак', total: 0, playable: 0, topics: [] })
    work.questions.push({
      ...structuredClone(work.questions[0]),
      id: 'manual:' + randomUUID(),
      packId: 999999,
      packTitle: 'Новый пак',
      enabled: false,
      media: [{ kind: 'image', url: uploaded.json().url, caption: 'Тестовое изображение', phase: 'question' }],
    })
    work.catalog.packs[0].title = 'Переименованный пак'
    const saved = await save(work)
    expect(saved.statusCode, saved.body).toBe(200)
    const after = saved.json() as SvoyakAdminState
    expect(after.workspace.questions.find((q) => q.packId === 999999)?.packTitle).toBe('Новый пак')
    expect(after.workspace.questions.find((q) => q.packId === work.catalog.packs[0].id)?.packTitle).toBe(
      'Переименованный пак'
    )
    expect(after.workspace.questions.some((q) => q.id === removed.id)).toBe(false)
    expect(
      await db.execute(
        sql`select id from svoyak_questions where revision_id=${before.activeRevision} and id=${removed.id}`
      )
    ).toHaveLength(1)
  })
  it('does not leak answer media or answer keys to players before resolution', async () => {
    const questions = structuredClone(release.questions)
    for (const q of questions)
      q.media = [
        { kind: 'image', url: 'https://example.test/public.webp', caption: '', phase: 'question' },
        { kind: 'video', url: 'https://example.test/secret.mp4', caption: '', phase: 'answer' },
      ]
    const rooms = new Map<string, any>()
    const service = new RoomService(
      {
        get: (code) => rooms.get(code),
        save: (room) => {
          rooms.set(room.code, structuredClone(room))
        },
      },
      { load: async () => ({ catalog: release.catalog, questions }), validate: async () => {} }
    )
    try {
      const h = await service.create({
          name: 'Ведущий',
          avatar: 'cat',
          settings: { rounds: 1, themesPerRound: 1, secondsPerQuestion: 30, age: 18 },
        }),
        p1 = await service.join(h.room.code, { name: 'Один', avatar: 'fox' }),
        p2 = await service.join(h.room.code, { name: 'Два', avatar: 'frog' })
      const command = (who: typeof h.credentials, c: any) => service.command(who.code, who.token, c, randomUUID())
      await command(p1.credentials, { type: 'ready', ready: true })
      await command(p2.credentials, { type: 'ready', ready: true })
      await command(h.credentials, { type: 'prepare' })
      const started = await command(h.credentials, { type: 'start' })
      await command(h.credentials, { type: 'choose', questionId: started.board[0].questions[0].id })
      const hidden = await service.get(h.room.code, p1.credentials.token)
      expect(hidden.current?.media).toHaveLength(1)
      expect(hidden.current?.answer).toBeUndefined()
      expect(JSON.stringify(hidden)).not.toContain('secret.mp4')
      await command(h.credentials, { type: 'reveal' })
      await command(h.credentials, { type: 'judge', correct: null })
      const revealed = await service.get(h.room.code, p1.credentials.token)
      expect(revealed.current?.media).toHaveLength(2)
      expect(revealed.current?.answer).toBeDefined()
    } finally {
      service.dispose()
    }
  })

  it('merges all source questions without activation and serves protected media with ranges', async () => {
    const before = await state(),
      image = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#88bbaa' } })
        .png()
        .toBuffer()
    const sha = createHash('sha256').update(image).digest('hex'),
      path = sha.slice(0, 2) + '/' + sha + '.png'
    await mkdir('.tmp/svoyak-library/assets/' + sha.slice(0, 2), { recursive: true })
    await writeFile('.tmp/svoyak-library/assets/' + path, image)
    const question: EditableQuestion = {
      ...before.workspace.questions[0],
      id: '15161:aaaaaaaaaaaa:r99:t1:q1',
      hash: 'source-hash',
      prompt: 'Исходный вопрос с медиа',
      answer: 'Исходный ответ',
      enabled: false,
      media: [{ kind: 'image', phase: 'question', url: '/api/v1/admin/svoyak/library/media/' + sha, caption: '' }],
    }
    const library: SvoyakLibrarySnapshot = {
      version: 1,
      importedAt: new Date().toISOString(),
      summary: { total: 1, packs: 1, withMedia: 1, unavailableMedia: 0, assets: 1, bytes: image.length },
      questions: [question],
      packs: before.workspace.catalog.packs,
      topics: before.workspace.catalog.topics,
      assets: { [sha]: { path, mime: 'image/png', bytes: image.length } },
      sources: {
        [sourceIdentity(question.id)]: {
          id: question.id,
          originalPrompt: question.prompt,
          originalAnswer: question.answer,
          originalHash: 'source-hash',
          reviewStatus: 'needs_review',
          blockers: ['review_required'],
          checks: {},
          evidence: [{ note: 'Источники сохранены' }],
          revision: 1,
          genre: 'humour',
          mediaPolicy: 'all',
          format: 'standard',
          media: [
            { ...question.media![0], reference: 'source.png', status: 'available', issues: [], review: 'pending' },
          ],
          originalMedia: [],
          originalAtoms: [],
          history: [{ action: 'source-review' }],
          edition: null,
          reviewNote: 'Авторская подача сохраняется',
        },
      },
    }
    library.sources[sourceIdentity(question.id)].originalMedia = library.sources[sourceIdentity(question.id)].media
    await db.execute(
      sql`insert into app_settings(key,value,version) values('svoyak.editor.library.v1',${JSON.stringify(library)}::jsonb,1)`
    )
    const after = await state()
    expect(after.workspace.questions).toHaveLength(before.workspace.questions.length + 1)
    expect(after.workspace.questions.find((q) => q.id === question.id)?.enabled).toBe(false)
    expect(after.activeRevision).toBe(before.activeRevision)
    expect(after.sources?.[sourceIdentity(question.id)].history).toEqual([])
    const detail = await app.inject({
      url: '/api/v1/admin/svoyak/library/source/' + encodeURIComponent(question.id),
      headers,
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().history).toHaveLength(1)
    const url = question.media![0].url
    expect((await app.inject({ url })).statusCode).toBe(401)
    const full = await app.inject({ url, headers })
    expect(full.statusCode).toBe(200)
    expect(full.rawPayload.equals(image)).toBe(true)
    const range = await app.inject({ url, headers: { ...headers, range: 'bytes=0-9' } })
    expect(range.statusCode).toBe(206)
    expect(range.rawPayload.equals(image.subarray(0, 10))).toBe(true)
    expect(range.headers['content-range']).toBe(`bytes 0-9/${image.length}`)
    expect((await app.inject({ method: 'HEAD', url, headers: { cookie: actor } })).statusCode).toBe(200)
    expect((await app.inject({ url, headers: { ...headers, range: 'bytes=999999-' } })).statusCode).toBe(416)
  })
  it('keeps incomplete disabled cards and requires eight checks before public media admission', async () => {
    const before = await state(),
      work = structuredClone(before.workspace),
      question = work.questions.find((q) => q.id.includes(':r99:'))!
    question.prompt = ''
    question.answer = ''
    let saved = await save(work)
    expect(saved.statusCode, saved.body).toBe(200)
    const incomplete = saved.json() as SvoyakAdminState,
      edited = incomplete.workspace.questions.find((q) => q.id === question.id)!
    edited.prompt = 'Проверенный вопрос с изображением'
    edited.answer = 'Проверенный ответ'
    edited.enabled = true
    saved = await save(incomplete.workspace)
    expect(saved.statusCode, saved.body).toBe(200)
    let publish = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/svoyak/publish',
      headers,
      payload: { version: saved.json().workspace.version },
    })
    expect(publish.statusCode, publish.body).toBe(422)
    expect(publish.json().error.code).toBe('REVIEW_REQUIRED')
    expect((await state()).activeRevision).toBe(before.activeRevision)
    const reviewed = saved.json() as SvoyakAdminState
    reviewed.workspace.questions.find((q) => q.id === question.id)!.review = {
      checks: Object.fromEntries(REVIEW_CHECKS.map((key) => [key, true])),
      textOnlyAdaptation: false,
      missingMediaResolved: false,
    }
    saved = await save(reviewed.workspace)
    expect(saved.statusCode, saved.body).toBe(200)
    publish = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/svoyak/publish',
      headers,
      payload: { version: saved.json().workspace.version },
    })
    expect(publish.statusCode, publish.body).toBe(200)
    const published = (publish.json() as SvoyakAdminState).workspace.questions.find((q) => q.id === question.id)!
    expect(published.media?.[0].url).toMatch(/\/svoyak\/released\//)
    const active = await db.execute(
      sql`select payload from svoyak_questions where revision_id=${publish.json().activeRevision} and id=${question.id}`
    )
    expect((active[0].payload as EditableQuestion).media?.[0].url).not.toContain('/admin/')
  })
})
