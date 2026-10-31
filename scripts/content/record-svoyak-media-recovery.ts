import { readFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { createDatabase } from '@shoditsa/database'
import type { SvoyakMediaRecoveryReport, SvoyakLibrarySnapshot } from '@shoditsa/contracts/svoyak'

const option = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3)
const file = option('report'),
  actor = option('actor-id')
if (!file || !actor || !/^[a-f0-9-]{36}$/i.test(actor)) throw Error('--report and --actor-id are required')
const report = JSON.parse(await readFile(file, 'utf8')) as SvoyakMediaRecoveryReport
if (
  report.version !== 1 ||
  report.items.length !== report.summary.total ||
  new Set(report.items.map((i) => i.id)).size !== report.items.length ||
  report.summary.recovered !== report.items.filter((i) => i.status === 'recovered').length ||
  report.summary.unresolved !== report.items.filter((i) => i.status === 'unresolved').length ||
  !Number.isFinite(Date.parse(report.checkedAt))
)
  throw Error('Invalid recovery report')
// This records failed recovery attempts only; successful assets need their own verified media import.
if (report.summary.recovered) throw Error('Recovered files must be verified and imported before recording completion')
const { db, client } = createDatabase(loadConfig())
try {
  await db.transaction(async (tx) => {
    const admin = await tx.execute(sql`select user_id from player_profiles where user_id=${actor} and role='admin'`)
    if (!admin.length) throw Error('Existing administrator required')
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('svoyak-content-activation'))`)
    const libraryRows = await tx.execute(sql`select value from app_settings where key='svoyak.editor.library.v1'`)
    const library = libraryRows[0]?.value as SvoyakLibrarySnapshot | undefined
    if (!library) throw Error('Full editorial library required')
    for (const item of report.items) {
      const source = library.sources[item.identity],
        media = source?.media[item.mediaIndex]
      if (
        !source ||
        source.id !== item.questionId ||
        !media ||
        media.reference !== item.reference ||
        media.status === 'available' ||
        !item.reason ||
        !item.attempts ||
        !Number.isFinite(Date.parse(item.checkedAt))
      )
        throw Error('Recovery item does not match the missing source reference: ' + item.id)
      if (
        report.contextualizedAt &&
        (!item.context?.inferenceOnly ||
          item.context.exactOriginalKnown !== false ||
          item.context.answerKey !== source.originalAnswer ||
          !item.context.expectedContent ||
          !item.context.unknowns)
      )
        throw Error('Invalid context inference ' + item.id)
    }
    const previous = await tx.execute(
      sql`select version,value from app_settings where key='svoyak.editor.media-recovery.v1' for update`
    )
    if (
      (previous[0]?.value as SvoyakMediaRecoveryReport | undefined)?.checkedAt === report.checkedAt &&
      (previous[0]?.value as SvoyakMediaRecoveryReport | undefined)?.contextualizedAt === report.contextualizedAt
    ) {
      console.log('Recovery report already recorded')
      return
    }
    const version = Number(previous[0]?.version ?? 0) + 1
    await tx.execute(
      sql`insert into app_settings(key,value,version,updated_by) values('svoyak.editor.media-recovery.v1',${JSON.stringify(report)}::jsonb,${version},${actor}) on conflict(key) do update set value=excluded.value,version=excluded.version,updated_by=excluded.updated_by,"updatedAt"=now()`
    )
    await tx.execute(
      sql`insert into audit_log(actor_user_id,action,entity_type,entity_id,"before","after",reason,result,request_id) values(${actor},'svoyak.media.recovery','svoyak_editor_library',${report.checkedAt},${JSON.stringify(previous[0]?.value ?? null)}::jsonb,${JSON.stringify(report.summary)}::jsonb,'Owner requested a retry of missing original media URLs','success',${'svoyak-recovery-' + report.checkedAt})`
    )
  })
  console.log(JSON.stringify({ status: 'ok', ...report.summary, activeRevisionChanged: false }))
} finally {
  await client.end()
}
