import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { createDatabase } from '@shoditsa/database'
import type { SvoyakLibrarySnapshot } from '@shoditsa/contracts/svoyak'

const option = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3)
const root = resolve(option('root') ?? '.tmp/full-library-20261031'),
  actor = option('actor-id')
if (!actor || !/^[a-f0-9-]{36}$/i.test(actor)) throw Error('--actor-id is required')
const snapshot = JSON.parse(await readFile(join(root, 'library.json'), 'utf8')) as SvoyakLibrarySnapshot
if (
  snapshot.version !== 1 ||
  snapshot.questions.length !== snapshot.summary.total ||
  new Set(snapshot.questions.map((q) => q.id)).size !== snapshot.questions.length ||
  snapshot.questions.some((q) => q.enabled) ||
  Object.keys(snapshot.sources).length !== snapshot.questions.length
)
  throw Error('Invalid editor-only snapshot')
for (const [sha, asset] of Object.entries(snapshot.assets)) {
  if (!/^[a-f0-9]{64}$/.test(sha) || !new RegExp(`^[a-f0-9]{2}/${sha}\\.[a-z0-9]{1,8}$`).test(asset.path))
    throw Error('Invalid asset path')
  const file = await stat(join(root, 'assets', asset.path))
  if (!file.isFile() || file.size !== asset.bytes) throw Error('Missing asset ' + sha)
  if (
    createHash('sha256')
      .update(await readFile(join(root, 'assets', asset.path)))
      .digest('hex') !== sha
  )
    throw Error('Asset checksum mismatch ' + sha)
}
const { db, client } = createDatabase(loadConfig())
try {
  await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`select user_id from player_profiles where user_id=${actor} and role='admin'`)
    if (!rows.length) throw Error('Existing administrator required')
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('svoyak-content-activation'))`)
    const existing = await tx.execute(
      sql`select value from app_settings where key='svoyak.editor.library.v1' for update`
    )
    if (existing.length) {
      const old = existing[0].value as SvoyakLibrarySnapshot
      if (old.importedAt === snapshot.importedAt) {
        console.log('Editor snapshot already imported')
        return
      }
      throw Error('Existing source snapshot is immutable; reconcile a new source edition explicitly')
    }
    await tx.execute(
      sql`insert into app_settings(key,value,version,updated_by) values('svoyak.editor.library.v1',${JSON.stringify(snapshot)}::jsonb,1,${actor})`
    )
    await tx.execute(
      sql`insert into audit_log(actor_user_id,action,entity_type,entity_id,reason,result,request_id) values(${actor},'svoyak.library.import','svoyak_editor_library',${snapshot.importedAt},'Owner requested the complete library including media and unapproved questions','success',${'svoyak-library-' + snapshot.importedAt})`
    )
  })
  console.log(JSON.stringify({ status: 'ok', ...snapshot.summary, activeRevisionChanged: false }))
} finally {
  await client.end()
}
