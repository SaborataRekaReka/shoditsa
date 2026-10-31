import { readFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { createDatabase } from '@shoditsa/database'
import type { EditableQuestion, SvoyakWorkspace } from '@shoditsa/contracts/svoyak'
import { buildMix } from '@shoditsa/game-core/svoyak-mix'
import { normalizeWorkspace, revisionCatalog } from '../../apps/api/src/modules/svoyak/admin-content.js'
import { loadEditorLibrary, validateNewAdmissions, publishLibraryMedia, sourceIdentity, libraryAsset, REVIEW_CHECKS } from '../../apps/api/src/modules/svoyak/editor-library.js'

const option = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3)
const file = option('workspace'), actor = option('actor-id')
if (!file || !actor) throw Error('--workspace and --actor-id required')
const input = JSON.parse(await readFile(file, 'utf8')) as SvoyakWorkspace
const config = loadConfig(), { db, client } = createDatabase(config)
try {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('svoyak-content-activation'))`)
    const admin = await tx.execute(sql`select user_id from player_profiles where user_id=${actor} and role='admin'`)
    if (!admin.length) throw Error('Existing administrator required')
    const active = await tx.execute(sql`select id from svoyak_content_revisions where status='active'`)
    const saved = await tx.execute(sql`select value,version from app_settings where key='svoyak.editor.workspace.v1' for update`)
    if (active[0]?.id !== input.baseRevision || Number(saved[0]?.version) !== input.version) throw Error('Concurrent active revision or workspace changed')
    const previous = saved[0].value as SvoyakWorkspace
    // Admission flags are the only permitted edits to the owner's current draft.
    const content = (q: EditableQuestion) => { const { enabled, review, ...rest } = q; return JSON.stringify(rest) }
    if (previous.questions.length !== input.questions.length || previous.questions.some((q, i) => content(q) !== content(input.questions[i]))) throw Error('Draft content changed')
    const library = await loadEditorLibrary(tx)
    if (!library) throw Error('Private reviewed library required')
    const pinned = new Map(library.questions.map(q => [sourceIdentity(q.id), q]))
    const fields = ['prompt','answer','aliases','themeId','theme','topic','note','difficulty','age','duplicateIds','media'] as const
    const verified = new Set<string>()
    for (const q of input.questions.filter(q => q.enabled)) {
      const source = library.sources[sourceIdentity(q.id)], original = pinned.get(sourceIdentity(q.id))
      if (!source || !original || source.reviewStatus !== 'approved' || source.blockers.length || !REVIEW_CHECKS.every(k => source.checks[k])) throw Error('Question lacks pinned completed review: ' + q.id)
      if (fields.some(k => JSON.stringify(q[k] ?? []) !== JSON.stringify(original[k] ?? []))) throw Error('Question differs from reviewed content: ' + q.id)
      for (const m of q.media ?? []) {
        const sha = m.url.split('/').at(-1)!
        if (verified.has(sha)) continue
        const asset = libraryAsset(library, sha, config)
        if (!asset || createHash('sha256').update(await readFile(asset.file)).digest('hex') !== sha) throw Error('Media checksum mismatch')
        verified.add(sha)
      }
    }
    const value = normalizeWorkspace(input), enabled = value.questions.filter(q => q.enabled)
    const old = await tx.execute(sql`select payload from svoyak_questions where revision_id=${input.baseRevision} and approved`)
    validateNewAdmissions(value.questions, old.map(r => r.payload as EditableQuestion), library)
    const player = { id: 'release-validation', name: 'Проверка', avatar: 'cat' as const, role: 'player' as const, ready: true, score: 0, preferences: { topics: [] as string[] } }
    for (const topic of [null, ...value.catalog.topics.filter(t => t.playable).map(t => t.id)]) {
      buildMix({ catalog: value.catalog, questions: enabled }, [{ ...player, preferences: { topics: topic ? [topic] : [] } }], { rounds: 1, themesPerRound: topic ? 1 : 3, secondsPerQuestion: 30, age: 18 }, topic ?? 'all')
    }
    await publishLibraryMedia(value.questions, library, config)
    const final = normalizeWorkspace(value), id = 'editor-' + randomUUID(), catalog = revisionCatalog(final, id)
    await tx.execute(sql`insert into svoyak_content_revisions(id,status,catalog,provenance) values(${id},'ready',${JSON.stringify(catalog)}::jsonb,${JSON.stringify({ source: 'reviewed-library', actorId: actor, baseRevision: input.baseRevision, checks: 'Pinned completed editorial reviews and media SHA256 revalidated', reviewed: enabled.length, mediaFiles: verified.size })}::jsonb)`)
    await tx.execute(sql`insert into svoyak_questions(revision_id,id,content_hash,payload,approved) select ${id},q->>'id',q->>'hash',q-'enabled',(q->>'enabled')::boolean from jsonb_array_elements(${JSON.stringify(final.questions)}::jsonb) q`)
    await tx.execute(sql`update svoyak_content_revisions set status='retired' where status='active'`)
    await tx.execute(sql`update svoyak_content_revisions set status='active' where id=${id}`)
    await tx.execute(sql`update app_settings set value='null'::jsonb,version=version+1,updated_by=${actor},"updatedAt"=now() where key='svoyak.editor.workspace.v1'`)
    await tx.execute(sql`insert into audit_log(actor_user_id,action,entity_type,entity_id,reason,result,request_id) values(${actor},'svoyak.release','svoyak_content_revision',${id},'Owner requested publication of every completed reviewed question, including media and category selection','success',${'svoyak-reviewed-' + id})`)
    console.log(JSON.stringify({ revision: id, approved: enabled.length, playable: catalog.playable, withMedia: enabled.filter(q => q.media?.length).length, topics: catalog.topics.filter(t => t.playable).length }))
  })
} finally { await client.end() }
