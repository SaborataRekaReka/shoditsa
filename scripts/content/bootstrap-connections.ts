import { and, eq, inArray } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  appSettings,
  connectionsSchedule,
  contentItemVersions,
  contentRevisions,
  createDatabase,
  playerProfiles,
} from '@shoditsa/database'
import { activateContentRevision } from '../../apps/api/src/modules/admin/content-service.js'
import { loadReleaseLibraries } from '../../apps/api/src/modules/admin/release-content-loader.js'
import { buildReleaseContentRevision } from '../../apps/api/src/modules/admin/release-content-service.js'

const config = loadConfig()
const { db, client } = createDatabase(config)
const requestId = `deploy:connections-bootstrap:${config.gitSha}`
const arg = (name: string) => {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const moscowDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

try {
  const release = await loadReleaseLibraries(config.contentReleaseRoot)
  const library = release.libraries.find((entry) => entry.mode === 'connections')
  if (!library || library.items.length !== 10) {
    throw new Error(`Expected exactly 10 bundled connections rounds, received ${library?.items.length ?? 0}`)
  }
  const bundledIds = library.items.map((item) => item.id)
  const configuredAdminId = config.adminUserIds[0]
  const databaseAdmin = configuredAdminId ? null : (await db.select({ id: playerProfiles.userId }).from(playerProfiles)
    .where(eq(playerProfiles.role, 'admin')).limit(1))[0]
  const actorId = configuredAdminId ?? databaseAdmin?.id ?? null

  let active = (await db.select({ id: contentRevisions.id }).from(contentRevisions)
    .where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!active) throw new Error('Active content revision is required before bootstrapping connections')

  const availableVersions = async (revisionId: string) => db.select({
    id: contentItemVersions.id,
    itemId: contentItemVersions.itemId,
    payload: contentItemVersions.payload,
  }).from(contentItemVersions).where(and(
    eq(contentItemVersions.revisionId, revisionId),
    eq(contentItemVersions.mode, 'connections'),
    eq(contentItemVersions.allowedInGame, true),
    eq(contentItemVersions.contentStatus, 'ready'),
    inArray(contentItemVersions.itemId, bundledIds),
  ))

  let versions = await availableVersions(active.id)
  if (versions.length !== bundledIds.length) {
    if (!actorId) throw new Error('An admin user is required to activate the connections content revision')
    const built = await buildReleaseContentRevision(db, { id: actorId }, config.contentReleaseRoot, config.gitSha, requestId)
    if (built.status !== 'active') {
      if (!['ready', 'retired'].includes(built.status)) {
        throw new Error(`Connections content revision is not activatable: ${built.status}`)
      }
      await activateContentRevision(
        db,
        { id: actorId },
        built.revisionId,
        requestId,
        'Автоматическое подключение десяти стартовых раундов «Связей»',
      )
    }
    active = (await db.select({ id: contentRevisions.id }).from(contentRevisions)
      .where(eq(contentRevisions.status, 'active')).limit(1))[0]
    versions = await availableVersions(active.id)
  }
  if (versions.length !== bundledIds.length) {
    throw new Error(`Connections bootstrap verification failed: ${versions.length}/${bundledIds.length}`)
  }

  const versionByItemId = new Map(versions.map((version) => [version.itemId, version]))
  const startDate = arg('--start') ?? config.connectionsLaunchDate ?? moscowDate()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error(`Invalid connections start date: ${startDate}`)
  for (const [index, itemId] of bundledIds.entries()) {
    const puzzleDate = addDays(startDate, index)
    const itemVersionId = versionByItemId.get(itemId)!.id
    await db.insert(connectionsSchedule).values({
      puzzleDate,
      itemVersionId,
      scheduledBy: actorId,
    }).onConflictDoNothing()
    const scheduled = (await db.select({
      itemVersionId: connectionsSchedule.itemVersionId,
      itemId: contentItemVersions.itemId,
      cancelledAt: connectionsSchedule.cancelledAt,
    }).from(connectionsSchedule)
      .innerJoin(contentItemVersions, eq(contentItemVersions.id, connectionsSchedule.itemVersionId))
      .where(eq(connectionsSchedule.puzzleDate, puzzleDate)).limit(1))[0]
    if (!scheduled || scheduled.itemId !== itemId || scheduled.cancelledAt) {
      throw new Error(`Connections schedule conflict on ${puzzleDate}`)
    }
  }
  await db.insert(appSettings).values({
    key: 'connections_launch_date',
    value: startDate,
    updatedBy: actorId,
  }).onConflictDoUpdate({
    target: appSettings.key,
    set: {
      value: startDate,
      version: 2,
      updatedBy: actorId,
      updatedAt: new Date(),
    },
  })
  console.log(JSON.stringify({
    activeRevisionId: active.id,
    rounds: versions.length,
    startDate,
    endDate: addDays(startDate, versions.length - 1),
  }, null, 2))
} finally {
  await client.end()
}
