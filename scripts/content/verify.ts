import { and, asc, eq } from 'drizzle-orm'
import { isDeepStrictEqual } from 'node:util'
import { loadConfig } from '@shoditsa/config'
import { contentItemVersions, contentRevisions, createDatabase } from '@shoditsa/database'
import { loadLibraries } from './lib.js'

const source = await loadLibraries()
const { db, client } = createDatabase(loadConfig())
try {
  const revision = await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!revision[0]) throw new Error('No active revision')
  for (const library of source.libraries) {
    const rows = await db.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, revision[0].id), eq(contentItemVersions.mode, library.mode),
    )).orderBy(asc(contentItemVersions.sortOrder))
    if (rows.length !== library.items.length) throw new Error(`${library.mode}: DB count ${rows.length} != source ${library.items.length}`)
    const sampleIndexes = Array.from({ length: Math.min(20, rows.length) }, (_, index) => Math.floor(index * (rows.length - 1) / Math.max(1, Math.min(20, rows.length) - 1)))
    for (const index of sampleIndexes) if (!isDeepStrictEqual(rows[index].payload, library.items[index])) throw new Error(`${library.mode}: semantic mismatch at source index ${index}`)
    console.log(`${library.mode}: ${rows.length} rows, ${sampleIndexes.length} samples match`)
  }
} finally { await client.end() }
