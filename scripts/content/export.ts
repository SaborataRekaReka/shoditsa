import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { and, asc, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { contentItemVersions, contentRevisionModes, contentRevisions, createDatabase } from '@shoditsa/database'
import { arg } from './lib.js'

const output = resolve(arg('--output') ?? './tmp/export')
const { db, client } = createDatabase(loadConfig())
try {
  const requested = arg('--revision')
  const revision = await db.select({ id: contentRevisions.id, version: contentRevisions.version, checksum: contentRevisions.checksumSha256 })
    .from(contentRevisions).where(requested ? eq(contentRevisions.id, requested) : eq(contentRevisions.status, 'active')).limit(1)
  if (!revision[0]) throw new Error('Revision not found')
  await mkdir(output, { recursive: true })
  const modes = await db.select().from(contentRevisionModes).where(eq(contentRevisionModes.revisionId, revision[0].id))
  for (const mode of modes) {
    const rows = await db.select({ payload: contentItemVersions.payload }).from(contentItemVersions)
      .where(and(eq(contentItemVersions.revisionId, revision[0].id), eq(contentItemVersions.mode, mode.mode))).orderBy(asc(contentItemVersions.sortOrder))
    await writeFile(resolve(output, `${mode.mode}.json`), `${JSON.stringify(rows.map((row) => row.payload), null, 2)}\n`, 'utf8')
  }
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify({ revision: revision[0], modes }, null, 2)}\n`, 'utf8')
  console.log(`Exported ${revision[0].id} to ${output}`)
} finally { await client.end() }
