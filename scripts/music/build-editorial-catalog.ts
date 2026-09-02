import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DIFFICULTY_ORDER, compareTitles, isAllowedInRegularGame, musicDifficultyPool, poolFor } from '@shoditsa/game-core'
import type { TitleItem } from '@shoditsa/contracts'
import { validateContentPayload } from '../../apps/api/src/modules/admin/content-service.js'
import { releaseAliasesFor, type ReleaseContentItem } from '../../apps/api/src/modules/admin/release-content-loader.js'
import { EDITORIAL_MUSIC_COMPARISON_KEYS, buildEditorialMusicCatalog, buildEditorialMusicSearchIndex, prepareArtistCompatibility, type ArtistCompatibility, type EditorialMusicDocument, type EditorialMusicOverrides } from '../../apps/api/src/modules/admin/music-editorial-catalog.js'

const options = new Map(process.argv.slice(2).map((argument) => {
  const at = argument.indexOf('=')
  return [at < 0 ? argument : argument.slice(0, at), at < 0 ? 'true' : argument.slice(at + 1)]
}))
const sourcePath = resolve(options.get('--source') ?? 'data/music-editorial/music-artists-enriched.v0.2.0.json')
const compatibilityPath = resolve('data/music-editorial/compatibility.json')
const overridesPath = resolve('data/music-editorial/overrides.json')
const outputRoot = resolve(options.get('--output') ?? 'var/music-catalog-migration')
const write = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
const sourceRaw = await readFile(sourcePath)
const document = JSON.parse(sourceRaw.toString('utf8')) as EditorialMusicDocument
const checksum = createHash('sha256').update(sourceRaw).digest('hex')
const baselinePath = options.get('--prepare-compatibility-from')
if (baselinePath) {
  const existing = await readFile(compatibilityPath).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return false
  })
  if (existing) throw new Error('Compatibility map already exists; review it instead of regenerating IDs')
  const previous = JSON.parse(await readFile(resolve(baselinePath), 'utf8')) as TitleItem[]
  await write(compatibilityPath, prepareArtistCompatibility(document, previous))
}
const compatibility = JSON.parse(await readFile(compatibilityPath, 'utf8')) as Record<string, ArtistCompatibility>
const overrides = JSON.parse(await readFile(overridesPath, 'utf8')) as EditorialMusicOverrides
const items = buildEditorialMusicCatalog(document, checksum, compatibility, overrides)
const issues = items.flatMap((item) => validateContentPayload(item as unknown as Record<string, unknown>, 'music').map((issue) => ({ id: item.id, sourceId: item.musicCatalog?.sourceId, title: item.titleRu, ...issue })))
const selfComparisonIssues = items.flatMap((item) => {
  const hints = compareTitles(item, item)
  return [
    ...EDITORIAL_MUSIC_COMPARISON_KEYS.filter((key) => !hints.some((hint) => hint.key === key)).map((key) => ({ id: item.id, missingKey: key })),
    ...hints.filter((hint) => hint.status !== 'match' || hint.direction != null).map((hint) => ({ id: item.id, hint })),
  ]
})
const aliases = new Map<string, string[]>()
for (const item of items) for (const alias of releaseAliasesFor(item as ReleaseContentItem)) aliases.set(alias.normalizedAlias, [...(aliases.get(alias.normalizedAlias) ?? []), item.id])
const aliasCollisions = [...aliases].filter(([, ids]) => ids.length > 1).map(([alias, ids]) => ({ alias, ids }))
const albumPortraits = items.filter((item) => item.posterUrl?.includes('ab67616d')).map((item) => ({ id: item.id, sourceId: item.musicCatalog?.sourceId, title: item.titleRu }))
const report = {
  source: { file: sourcePath, sha256: checksum, dataset: document.dataset, version: document.version, declaredVerifiedAt: document.verified_at },
  count: items.length,
  allowed: items.filter(isAllowedInRegularGame).length,
  matchedLegacyIds: Object.values(compatibility).filter((entry) => entry.matchedLegacyId).length,
  difficultyCounts: Object.fromEntries(DIFFICULTY_ORDER.map((difficulty) => [difficulty, musicDifficultyPool(poolFor(items, 'music', 'all'), difficulty).length])),
  issues,
  selfComparisonIssues,
  aliasCollisions,
  albumPortraits,
  scope: 'Regular music only. Other modes and the separate kpop_artist family are not replaced.',
  verification: 'Schema, identity, conversion and gameplay checks only; not an independent factual audit of all artists.',
}
await write(resolve(outputRoot, 'source-artists.json'), document.artists)
await write(resolve(outputRoot, 'items.json'), items)
await write(resolve(outputRoot, 'preflight.json'), report)
console.log(JSON.stringify({ ...report, issues: issues.slice(0, 30), selfComparisonIssues: selfComparisonIssues.slice(0, 10) }, null, 2))
if (options.has('--write')) {
  if (issues.some((issue) => issue.level === 'error') || selfComparisonIssues.length || aliasCollisions.length || albumPortraits.length || report.allowed !== report.count || Object.values(report.difficultyCounts).some((count) => count < 10)) throw new Error('Editorial catalog preflight failed; runtime files were not changed')
  await write(resolve('public/data/music.generated.json'), items)
  await write(resolve('public/data/libraries/music/items.json'), items)
  await write(resolve('public/data/libraries/music/search-index.json'), buildEditorialMusicSearchIndex(items, new Date().toISOString()))
  await write(resolve('public/data/libraries/music/source.json'), { dataset: document.dataset, version: document.version, sourceSha256: checksum, sourceDeclaredVerifiedAt: document.verified_at, count: items.length, scope: 'regular-music', replacement: true, definitions: document.definitions })
}
