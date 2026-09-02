import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { loadConfig } from '@shoditsa/config'
import { createDatabase } from '@shoditsa/database'
import { activateContentRevision, contentPayloadsEqual } from '../../apps/api/src/modules/admin/content-service.js'
import { buildEditorialMusicCatalog, type ArtistCompatibility, type EditorialMusicDocument, type EditorialMusicOverrides } from '../../apps/api/src/modules/admin/music-editorial-catalog.js'
import { inspectMusicCatalogReplacement, stageMusicCatalogReplacement } from '../../apps/api/src/modules/admin/music-catalog-replacement.js'
import { arg, hasArg } from './lib.js'
import type { TitleItem } from '@shoditsa/contracts'

const apply = hasArg('--apply')
const activate = hasArg('--activate')
const actorId = arg('--actor-id') ?? ''
const expectedRevision = arg('--expected-active') ?? ''
if (activate && !apply) throw new Error('--activate requires --apply')
if (apply && (!actorId || !expectedRevision)) throw new Error('--apply requires an existing --actor-id and reviewed --expected-active UUID')
const config = loadConfig()
const reportPath = resolve(arg('--report') ?? 'var/music-catalog-migration/replacement-plan.json')
const raw = await readFile(resolve('data/music-editorial/music-artists-enriched.v0.2.0.json'))
const source = JSON.parse(raw.toString('utf8')) as EditorialMusicDocument
const compatibility = JSON.parse(await readFile('data/music-editorial/compatibility.json', 'utf8')) as Record<string, ArtistCompatibility>
const overrides = JSON.parse(await readFile('data/music-editorial/overrides.json', 'utf8')) as EditorialMusicOverrides
const items = buildEditorialMusicCatalog(source, createHash('sha256').update(raw).digest('hex'), compatibility, overrides)
const released = JSON.parse(await readFile(resolve(arg('--release-root') ?? config.contentReleaseRoot, 'music/items.json'), 'utf8')) as TitleItem[]
if (released.length !== items.length || !items.every((item, index) => contentPayloadsEqual(item as unknown as Record<string, unknown>, released[index] as unknown as Record<string, unknown>))) throw new Error('Release library differs from the mapped editorial source; rebuild it before replacement')
const { db, client } = createDatabase(config)
try {
  const result = apply ? await stageMusicCatalogReplacement(db, items, expectedRevision, actorId)
    : { plan: await inspectMusicCatalogReplacement(db, items) }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  const activation = activate && 'revisionId' in result && !result.plan.unchanged
    ? await activateContentRevision(db, { id: actorId }, result.revisionId, `music-replacement:${result.revisionId}`, 'Switch regular music exclusively to the supplied editorial catalog; retain previous revisions and sessions') : null
  if (activation) await writeFile(reportPath, `${JSON.stringify({ ...result, activation }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...result, plan: { ...result.plan, removedIds: result.plan.removedIds.length, addedIds: result.plan.addedIds.length }, activation, reportPath }, null, 2))
} finally { await client.end() }
