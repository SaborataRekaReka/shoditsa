import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, relative as relativePath, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import type { TitleItem } from '@shoditsa/contracts'
import { contentItemVersions, contentRevisions, createDatabase } from '@shoditsa/database'
import { arg, hasArg } from './lib.js'

const config = loadConfig()
const targetRoot = resolve(arg('--target') ?? config.mediaRoot)
const sourceRoot = resolve(arg('--source') ?? config.contentReleaseRoot)
const apply = hasArg('--apply')
const localOnly = hasArg('--local-only')
const { db, client } = createDatabase(config)

const mimeExtension = (contentType: string | null, url: string) => {
  const fromUrl = extname(new URL(url, 'http://local').pathname).toLocaleLowerCase('en-US')
  if (/^\.(webp|png|jpe?g|gif|avif)$/.test(fromUrl)) return fromUrl === '.jpeg' ? '.jpg' : fromUrl
  if (contentType?.includes('png')) return '.png'
  if (contentType?.includes('webp')) return '.webp'
  if (contentType?.includes('avif')) return '.avif'
  return '.jpg'
}

const migrateUrl = async (url: string, mode: string, itemId: string, kind: string) => {
  if (url.startsWith('/media/')) return { url, source: url, bytes: 0, checksum: null }
  const local = url.replace(/^\.\//, '')
  if (local.startsWith('data/libraries/')) {
    const source = resolve(sourceRoot, local.slice('data/libraries/'.length))
    if (relativePath(sourceRoot, source).startsWith('..')) throw new Error(`Media path escapes source root: ${url}`)
    const bytes = await readFile(source)
    const peopleMatch = local.match(/^data\/libraries\/people\/img\/(.+)$/)
    const relative = peopleMatch ? `people/${peopleMatch[1]}` : `content/${mode}/${local.replace(/^data\/libraries\/[^/]+\/img\//, '')}`
    const destination = resolve(targetRoot, relative)
    if (apply) { await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes) }
    return { url: `/media/${relative.replaceAll('\\', '/')}`, source, bytes: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex') }
  }
  if (!/^https?:\/\//.test(url)) return { url, source: url, bytes: 0, checksum: null, warning: 'unsupported URL' }
  if (localOnly) return { url, source: url, bytes: 0, checksum: null, skipped: 'remote URL' }
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'ShoditsaMediaMigration/1.0' } })
  if (!response.ok) return { url, source: url, bytes: 0, checksum: null, warning: `HTTP ${response.status}` }
  const bytes = Buffer.from(await response.arrayBuffer())
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const extension = mimeExtension(response.headers.get('content-type'), url)
  const safeItem = itemId.replace(/[^a-zA-Z0-9:_-]/g, '_')
  const relative = kind === 'photoUrl' ? `people/${checksum.slice(0, 2)}/${checksum.slice(0, 12)}${extension}` : `content/${mode}/${safeItem}/${kind}-${checksum.slice(0, 12)}${extension}`
  const destination = resolve(targetRoot, relative)
  if (apply) { await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes) }
  return { url: `/media/${relative}`, source: url, bytes: bytes.length, checksum }
}

const walk = async (value: unknown, mode: string, itemId: string, path: string[], manifest: unknown[]): Promise<unknown> => {
  if (Array.isArray(value)) return Promise.all(value.map((entry, index) => walk(entry, mode, itemId, [...path, String(index)], manifest)))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && ['posterUrl', 'headerUrl', 'backdropUrl', 'photoUrl'].includes(key)) {
      const migrated = await migrateUrl(child, mode, itemId, key); manifest.push({ itemId, field: [...path, key].join('.'), ...migrated }); result[key] = migrated.url
    } else if (key === 'screenshots' && Array.isArray(child)) {
      const migrated = await Promise.all(child.map((url, index) => typeof url === 'string' ? migrateUrl(url, mode, itemId, `screenshot-${index}`) : null))
      migrated.filter(Boolean).forEach((entry, index) => manifest.push({ itemId, field: [...path, key, String(index)].join('.'), ...entry })); result[key] = migrated.map((entry, index) => entry?.url ?? child[index])
    } else result[key] = await walk(child, mode, itemId, [...path, key], manifest)
  }
  return result
}

try {
  const revision = await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!revision[0]) throw new Error('No active content revision')
  const rows = await db.select({ id: contentItemVersions.id, itemId: contentItemVersions.itemId, mode: contentItemVersions.mode, payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.revisionId, revision[0].id))
  const manifest: unknown[] = []
  const updates: Array<{ id: string; payload: TitleItem }> = []
  for (const [index, row] of rows.entries()) {
    const payload = await walk(row.payload, row.mode, row.itemId, [], manifest) as TitleItem
    if (JSON.stringify(payload) !== JSON.stringify(row.payload)) updates.push({ id: row.id, payload })
    if ((index + 1) % 100 === 0) console.log(`Processed ${index + 1}/${rows.length}`)
  }
  const report = { revisionId: revision[0].id, apply, localOnly, sourceRoot, targetRoot, entries: manifest.length, changedItems: updates.length, files: manifest }
  const reportPath = resolve(arg('--report') ?? './data/media-migration-report.json')
  await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  if (apply && updates.length) {
    await db.transaction(async (tx) => {
      for (const update of updates) {
        await tx.update(contentItemVersions).set({ payload: update.payload }).where(and(eq(contentItemVersions.id, update.id), eq(contentItemVersions.revisionId, revision[0].id)))
      }
    })
  }
  console.log(`Media ${apply ? 'migration' : 'dry-run'} complete: ${manifest.length} references, ${updates.length} item payloads changed`)
} finally { await client.end() }
