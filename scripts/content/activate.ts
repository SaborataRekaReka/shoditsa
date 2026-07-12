import { desc, eq, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { appSettings, contentRevisions, createDatabase } from '@shoditsa/database'
import { arg } from './lib.js'

const { db, client } = createDatabase(loadConfig())
try {
  const revisionId = arg('--revision') ?? (process.argv.includes('--latest-ready')
    ? (await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'ready')).orderBy(desc(contentRevisions.createdAt)).limit(1))[0]?.id
    : undefined)
  if (!revisionId) throw new Error('--revision <uuid> or --latest-ready is required')
  await db.transaction(async (tx) => {
    const target = await tx.select({ status: contentRevisions.status }).from(contentRevisions).where(eq(contentRevisions.id, revisionId)).limit(1)
    if (!target[0] || !['ready', 'active'].includes(target[0].status)) throw new Error('Revision must exist and be ready')
    await tx.update(contentRevisions).set({ status: 'retired' }).where(eq(contentRevisions.status, 'active'))
    await tx.update(contentRevisions).set({ status: 'active', activatedAt: new Date() }).where(eq(contentRevisions.id, revisionId))
    await tx.insert(appSettings).values({ key: 'active_content_revision_id', value: revisionId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`${JSON.stringify(revisionId)}::jsonb`, version: sql`${appSettings.version} + 1`, updatedAt: new Date() } })
  })
  console.log(`Activated content revision ${revisionId}`)
} finally { await client.end() }
