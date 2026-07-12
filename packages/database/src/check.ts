import { sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { appSettings, contentRevisionModes, contentRevisions, createDatabase } from './index.js'

const config = loadConfig()
const { db, client } = createDatabase(config)
try {
  await db.execute(sql`select 1`)
  const active = await db.select({ id: contentRevisions.id, version: contentRevisions.version })
    .from(contentRevisions).where(sql`${contentRevisions.status} = 'active'`).limit(1)
  const counts = active[0]
    ? await db.select({ mode: contentRevisionModes.mode, count: contentRevisionModes.itemsCount }).from(contentRevisionModes).where(sql`${contentRevisionModes.revisionId} = ${active[0].id}`)
    : []
  const settings = await db.select({ key: appSettings.key }).from(appSettings)
  console.log(JSON.stringify({ database: 'ok', activeRevision: active[0] ?? null, counts, settings: settings.length }, null, 2))
} finally {
  await client.end()
}
