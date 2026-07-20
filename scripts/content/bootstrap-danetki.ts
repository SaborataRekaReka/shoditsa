import { and, eq, inArray } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { contentItemVersions, contentRevisions, createDatabase, playerProfiles } from '@shoditsa/database'
import { activateContentRevision } from '../../apps/api/src/modules/admin/content-service.js'
import { loadReleaseLibraries } from '../../apps/api/src/modules/admin/release-content-loader.js'
import { buildReleaseContentRevision } from '../../apps/api/src/modules/admin/release-content-service.js'

const config = loadConfig()
const { db, client } = createDatabase(config)
const requestId = `deploy:danetki-bootstrap:${config.gitSha}`

try {
  const release = await loadReleaseLibraries(config.contentReleaseRoot)
  const danetki = release.libraries.find((library) => library.mode === 'danetki')
  if (!danetki || danetki.items.length !== 5) {
    throw new Error(`Expected exactly 5 bundled danetki, received ${danetki?.items.length ?? 0}`)
  }
  const bundledIds = danetki.items.map((item) => item.id)
  const active = (await db.select({ id: contentRevisions.id }).from(contentRevisions)
    .where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!active) throw new Error('Active content revision is required before bootstrapping danetki')

  const availableIds = async (revisionId: string) => (await db.select({ itemId: contentItemVersions.itemId })
    .from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, revisionId),
      eq(contentItemVersions.mode, 'danetki'),
      eq(contentItemVersions.allowedInGame, true),
      inArray(contentItemVersions.contentStatus, ['test', 'ready']),
      inArray(contentItemVersions.itemId, bundledIds),
    ))).map((row) => row.itemId)

  const currentIds = await availableIds(active.id)
  if (currentIds.length === bundledIds.length) {
    console.log(`Danetki content is already active: ${currentIds.length}/${bundledIds.length}`)
    process.exitCode = 0
  } else {
    const configuredAdminId = config.adminUserIds[0]
    const databaseAdmin = configuredAdminId ? null : (await db.select({ id: playerProfiles.userId }).from(playerProfiles)
      .where(eq(playerProfiles.role, 'admin')).limit(1))[0]
    const actorId = configuredAdminId ?? databaseAdmin?.id
    if (!actorId) throw new Error('An admin user is required to activate the danetki content revision')

    const built = await buildReleaseContentRevision(db, { id: actorId }, config.contentReleaseRoot, config.gitSha, requestId)
    if (built.status !== 'active') {
      if (!['ready', 'retired'].includes(built.status)) throw new Error(`Danetki content revision is not activatable: ${built.status}`)
      await activateContentRevision(db, { id: actorId }, built.revisionId, requestId, 'Автоматическое подключение пяти стартовых данеток')
    }

    const activated = (await db.select({ id: contentRevisions.id }).from(contentRevisions)
      .where(eq(contentRevisions.status, 'active')).limit(1))[0]
    const activatedIds = activated ? await availableIds(activated.id) : []
    if (activatedIds.length !== bundledIds.length) {
      throw new Error(`Danetki bootstrap verification failed: ${activatedIds.length}/${bundledIds.length}`)
    }
    console.log(`Danetki content activated: ${activatedIds.length}/${bundledIds.length}`)
  }
} finally {
  await client.end()
}
