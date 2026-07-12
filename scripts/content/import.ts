import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  contentAliases, contentItems, contentItemVersions, contentRevisionModes, contentRevisions,
  createDatabase, diagnosisVignettes,
} from '@shoditsa/database'
import { normalize } from '@shoditsa/game-core'
import { aliasesFor, arg, hasArg, loadLibraries } from './lib.js'

const loaded = await loadLibraries(arg('--source'))
const reportPath = resolve(arg('--report') ?? './data/import-manifest.json')
const report = { ...loaded.manifest, mode: hasArg('--apply') ? 'apply' : 'dry-run' }

if (!hasArg('--apply')) {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const config = loadConfig()
const { db, client } = createDatabase(config)
const version = `${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}-${loaded.manifest.checksumSha256.slice(0, 8)}`
let revisionId: string | undefined
try {
  const activeCounts = await db.select({ mode: contentRevisionModes.mode, count: contentRevisionModes.itemsCount })
    .from(contentRevisionModes).innerJoin(contentRevisions, eq(contentRevisions.id, contentRevisionModes.revisionId))
    .where(eq(contentRevisions.status, 'active'))
  if (!hasArg('--allow-count-drop')) {
    const incoming = new Map(loaded.libraries.map((library) => [library.mode, library.items.length]))
    for (const current of activeCounts) {
      if ((incoming.get(current.mode) ?? 0) < current.count * 0.95) throw new Error(`${current.mode} count dropped more than 5%; pass --allow-count-drop after review`)
    }
  }

  const existing = await db.select({ id: contentRevisions.id, status: contentRevisions.status }).from(contentRevisions)
    .where(eq(contentRevisions.checksumSha256, loaded.manifest.checksumSha256)).limit(1)
  if (existing[0]) throw new Error(`Revision for checksum already exists: ${existing[0].id} (${existing[0].status})`)
  const inserted = await db.insert(contentRevisions).values({ version, checksumSha256: loaded.manifest.checksumSha256, sourceManifest: loaded.manifest, status: 'importing' }).returning({ id: contentRevisions.id })
  revisionId = inserted[0].id

  await db.transaction(async (tx) => {
    for (const library of loaded.libraries) {
      await tx.insert(contentRevisionModes).values({ revisionId: revisionId!, mode: library.mode, itemsCount: library.items.length, sourceChecksum: library.checksum })
      for (let offset = 0; offset < library.items.length; offset += 200) {
        const chunk = library.items.slice(offset, offset + 200)
        await tx.insert(contentItems).values(chunk.map((item) => ({ id: item.id, mode: library.mode })))
          .onConflictDoUpdate({ target: contentItems.id, set: { mode: library.mode, updatedAt: new Date() } })
        const versions = await tx.insert(contentItemVersions).values(chunk.map((item, index) => ({
          itemId: item.id, revisionId: revisionId!, mode: library.mode, titleRu: item.titleRu,
          titleOriginal: item.titleOriginal ?? '', normalizedTitle: normalize(item.titleRu), year: item.year,
          endYear: item.endYear ?? null, popularityScore: Number.isFinite(item.popularityScore) ? item.popularityScore : 0, topRank: item.topRank ?? null,
          sortOrder: offset + index, allowedInGame: item.allowedInGame ?? true, contentStatus: item.contentStatus ?? null, payload: item,
        }))).returning({ id: contentItemVersions.id, itemId: contentItemVersions.itemId })
        const itemMap = new Map(chunk.map((item) => [item.id, item]))
        const aliases = versions.flatMap((row) => aliasesFor(itemMap.get(row.itemId)!).map((alias) => ({ itemVersionId: row.id, ...alias })))
        if (aliases.length) await tx.insert(contentAliases).values(aliases)
      }
    }
    const diagnosisVersions = await tx.select({ id: contentItemVersions.id, itemId: contentItemVersions.itemId }).from(contentItemVersions)
      .where(and(eq(contentItemVersions.revisionId, revisionId!), eq(contentItemVersions.mode, 'diagnosis')))
    const versionByItem = new Map(diagnosisVersions.map((row) => [row.itemId, row.id]))
    const vignetteRows = loaded.vignettes.flatMap((group) => group.caseVignettes.map((entry, sortOrder) => ({ id: entry.id, itemVersionId: versionByItem.get(group.diagnosisId)!, text: entry.text, sortOrder })))
    for (let offset = 0; offset < vignetteRows.length; offset += 500) await tx.insert(diagnosisVignettes).values(vignetteRows.slice(offset, offset + 500))
    await tx.update(contentRevisions).set({ status: 'ready' }).where(eq(contentRevisions.id, revisionId!))
  })
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify({ ...report, revisionId, version, status: 'ready' }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ revisionId, version, status: 'ready', totalItems: loaded.manifest.totalItems, counts: loaded.manifest.modes }, null, 2))
} catch (error) {
  if (revisionId) await db.update(contentRevisions).set({ status: 'failed', sourceManifest: sql`jsonb_set(${contentRevisions.sourceManifest}, '{error}', ${JSON.stringify(String(error))}::jsonb)` }).where(eq(contentRevisions.id, revisionId))
  throw error
} finally {
  await client.end()
}
