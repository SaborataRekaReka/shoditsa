import { and, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { contentItemVersions, contentRevisions, createDatabase, playerProfiles } from '@shoditsa/database'
import { activateContentRevision, contentPayloadsEqual } from '../../apps/api/src/modules/admin/content-service.js'
import { loadReleaseLibraries } from '../../apps/api/src/modules/admin/release-content-loader.js'
import { buildReleaseContentRevision } from '../../apps/api/src/modules/admin/release-content-service.js'

const EXPECTED_QUESTIONS = 200
const config = loadConfig()
const { db, client } = createDatabase(config)
const requestId = `deploy:territory-bootstrap:${config.gitSha}`
const shouldActivate = process.argv.includes('--activate')

try {
  const release = await loadReleaseLibraries(config.contentReleaseRoot)
  const library = release.libraries.find((entry) => entry.mode === 'territory')
  if (!library || library.items.length !== EXPECTED_QUESTIONS) {
    throw new Error(`Expected exactly ${EXPECTED_QUESTIONS} bundled territory questions, received ${library?.items.length ?? 0}`)
  }
  const bundledIds = library.items.map((item) => item.id)
  const bundledById = new Map(library.items.map((item) => [item.id, item]))

  const availableVersions = async (revisionId: string) => db.select({
    itemId: contentItemVersions.itemId,
    payload: contentItemVersions.payload,
  })
    .from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, revisionId),
      eq(contentItemVersions.mode, 'territory'),
      eq(contentItemVersions.allowedInGame, true),
      eq(contentItemVersions.contentStatus, 'ready'),
    ))
  const matchesBundledLibrary = (versions: Awaited<ReturnType<typeof availableVersions>>) =>
    versions.length === EXPECTED_QUESTIONS
      && versions.every((version) => {
        const bundled = bundledById.get(version.itemId)
        return bundled !== undefined && contentPayloadsEqual(version.payload, bundled)
      })

  const currentActive = (await db.select({ id: contentRevisions.id }).from(contentRevisions)
    .where(eq(contentRevisions.status, 'active')).limit(1))[0]
  const currentVersions = currentActive ? await availableVersions(currentActive.id) : []
  if (matchesBundledLibrary(currentVersions)) {
    console.log(JSON.stringify({
      activeRevisionId: currentActive!.id,
      questions: currentVersions.length,
      activated: false,
      existing: true,
    }, null, 2))
    process.exitCode = 0
  } else {

    const configuredAdminId = config.adminUserIds[0]
    const databaseAdmin = configuredAdminId
      ? null
      : (await db.select({ id: playerProfiles.userId }).from(playerProfiles)
        .where(eq(playerProfiles.role, 'admin')).limit(1))[0]
    const actorId = configuredAdminId ?? databaseAdmin?.id ?? null
    if (!actorId) throw new Error('An admin user is required to build the territory release-content revision')

    const built = await buildReleaseContentRevision(
      db,
      { id: actorId },
      config.contentReleaseRoot,
      config.gitSha,
      requestId,
    )
    if (!['ready', 'active', 'retired'].includes(built.status)) {
      throw new Error(`Territory content revision is not ready: ${built.status}`)
    }

    if (built.status !== 'active' && shouldActivate) {
      await activateContentRevision(
        db,
        { id: actorId },
        built.revisionId,
        requestId,
        `Подключение ${EXPECTED_QUESTIONS} проверенных вопросов режима «Захват»`,
      )
    }

    const active = (await db.select({ id: contentRevisions.id }).from(contentRevisions)
      .where(eq(contentRevisions.status, 'active')).limit(1))[0]
    const activatedVersions = active ? await availableVersions(active.id) : []
    if (shouldActivate && !matchesBundledLibrary(activatedVersions)) {
      throw new Error(`Territory bootstrap verification failed: active payload does not exactly match the ${EXPECTED_QUESTIONS}-question release library`)
    }

    console.log(JSON.stringify({
      revisionId: built.revisionId,
      status: built.status,
      existing: built.existing,
      questions: library.items.length,
      activated: shouldActivate && matchesBundledLibrary(activatedVersions),
      activeRevisionId: active?.id ?? null,
      note: shouldActivate
        ? 'The territory release-content revision is active and verified.'
        : 'Revision prepared only. Pass --activate after review.',
    }, null, 2))
  }
} finally {
  await client.end()
}
