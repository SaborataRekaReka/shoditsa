import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { createDatabase } from '@shoditsa/database'
import type { Bank } from '@shoditsa/game-core/svoyak-bank'

const option = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length+3)
const apply = process.argv.includes('--apply'), activate = process.argv.includes('--activate')
const file = resolve(option('source') ?? 'data/svoyak/release-v1.json')
const release = JSON.parse(await readFile(file,'utf8')) as Bank & { provenance: Record<string,unknown> }
const revision = createHash('sha256').update(JSON.stringify(release.questions)).digest('hex').slice(0,24)
if (release.catalog.revision !== revision || release.catalog.localOnly || release.questions.length < 15 || !release.provenance.ownerSelectedEditorialBaseAt) throw new Error('Invalid or unapproved release manifest')
const ids = new Set<string>()
for (const question of release.questions) {
  if (ids.has(question.id) || !question.hash || !question.prompt?.trim() || !question.answer?.trim() || !question.themeId || !question.topic || ![0,6,12,16,18].includes(question.age)) throw new Error(`Invalid question: ${question.id}`)
  ids.add(question.id)
}
console.log(JSON.stringify({ revision, approvedQuestions:ids.size, playableQuestions:release.catalog.playable, apply, activate }))
if (apply) {
  const { db,client } = createDatabase(loadConfig())
  try {
    const actorId = option('actor-id')
    if (!actorId || !/^[a-f0-9-]{36}$/i.test(actorId)) throw new Error('--actor-id is required')
    const actor = await db.execute(sql`select user_id from player_profiles where user_id=${actorId} and role='admin'`)
    if (!actor.length) throw new Error('Release actor must be an existing administrator')
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('svoyak-content-activation'))`)
      const existing = await tx.execute(sql`select id from svoyak_content_revisions where id=${revision}`)
      if (!existing.length) {
        await tx.execute(sql`insert into svoyak_content_revisions(id,status,catalog,provenance) values(${revision},'ready',${JSON.stringify(release.catalog)}::jsonb,${JSON.stringify({...release.provenance,actorId})}::jsonb)`)
        await tx.execute(sql`insert into svoyak_questions(revision_id,id,content_hash,payload) select ${revision},q->>'id',q->>'hash',q from jsonb_array_elements(${JSON.stringify(release.questions)}::jsonb) as q`)
      }
      const count = await tx.execute(sql`select count(*)::int as count from svoyak_questions where revision_id=${revision} and approved=true`)
      if (Number(count[0].count) !== ids.size) throw new Error('Existing release is incomplete or contains revoked questions')
      if (activate) {
        await tx.execute(sql`update svoyak_content_revisions set status='retired' where status='active' and id<>${revision}`)
        const activated = await tx.execute(sql`update svoyak_content_revisions set status='active' where id=${revision} and status in ('ready','retired','active') returning id`)
        if (!activated.length) throw new Error('A withdrawn release cannot be reactivated')
      }
      await tx.execute(sql`insert into audit_log(actor_user_id,action,entity_type,entity_id,reason,result,request_id) values(${actorId},'svoyak.release','svoyak_content_revision',${revision},'Owner requested the reviewed editorial base on 2026-10-23','success',${'svoyak-release-'+revision})`)
    })
    console.log(JSON.stringify({ status:'ok', revision, active:activate, approvedQuestions:ids.size }))
  } finally { await client.end() }
}
