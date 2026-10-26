import { createHash } from 'node:crypto'
import { and, eq, ne } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { contentItemVersions, contentRevisions, createDatabase, playerProfiles } from '@shoditsa/database'
import { activateContentRevision } from '../../apps/api/src/modules/admin/content-service.js'
import { loadReleaseLibraries } from '../../apps/api/src/modules/admin/release-content-loader.js'
import { buildReleaseContentRevision } from '../../apps/api/src/modules/admin/release-content-service.js'
import { readWordPack } from '../../apps/api/src/modules/word/runtime.js'

const config = loadConfig()
const { db, client } = createDatabase(config)
const requestId = `deploy:word:${config.gitSha}`
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
try {
  const library = (await loadReleaseLibraries(config.contentReleaseRoot)).libraries.find(library => library.mode === 'word')!
  if (library.items.length !== 180) throw new Error('Expected 180 bundled semantic words')
  for (const item of library.items) {
    const pack = await readWordPack(String(item.semanticDatasetHash))
    const word = pack.resolveWord(item.titleRu)
    if (!word || !pack.targetKeys.includes(String(item.semanticWordKey)) || pack.rank(String(item.semanticWordKey), word.index) !== 1) throw new Error(`Unusable answer ${item.id}`)
  }
  const active = (await db.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!active) throw new Error('An active revision is required')
  const actorId = config.adminUserIds[0] ?? (await db.select({ id: playerProfiles.userId }).from(playerProfiles).where(eq(playerProfiles.role, 'admin')).limit(1))[0]?.id
  if (!actorId) throw new Error('An existing administrator is required')
  const otherContent = async (revisionId: string) => db.select({ itemId: contentItemVersions.itemId, payload: contentItemVersions.payload, allowedInGame: contentItemVersions.allowedInGame, contentStatus: contentItemVersions.contentStatus }).from(contentItemVersions).where(and(eq(contentItemVersions.revisionId, revisionId), ne(contentItemVersions.mode, 'word'))).orderBy(contentItemVersions.itemId)
  const before = await otherContent(active.id)
  // The existing overlay engine receives just the new mode. Other catalogs are
  // copied from the live revision, including unpublished editorial corrections.
  const result = await buildReleaseContentRevision(db, { id: actorId }, config.contentReleaseRoot, config.gitSha, requestId, ['word'])
  const after = await otherContent(result.revisionId)
  if (fingerprint(before) !== fingerprint(after)) throw new Error('Refusing activation: another catalog would change')
  const words = await db.select().from(contentItemVersions).where(and(eq(contentItemVersions.revisionId, result.revisionId), eq(contentItemVersions.mode, 'word'), eq(contentItemVersions.allowedInGame, true)))
  if (words.length !== 180) throw new Error('Prepared revision does not contain 180 playable words')
  if (result.status !== 'active') await activateContentRevision(db, { id: actorId }, result.revisionId, requestId, 'Подключение проверенного словаря «Слово по смыслу» с сохранением остальных каталогов')
  console.log(JSON.stringify({ revisionId: result.revisionId, previousRevisionId: active.id, words: words.length, preservedOtherItems: before.length, otherContentSha256: fingerprint(before), gitSha: config.gitSha }))
} finally { await client.end() }
