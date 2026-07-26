import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  appSettings,
  auditLog,
  contentAliases,
  contentItems,
  contentItemVersions,
  contentRevisionModes,
  contentRevisions,
  contentWorkspaceChanges,
  contentWorkspaces,
  createDatabase,
  diagnosisVignettes,
} from '@shoditsa/database'
import { normalizeTitle } from './enrichment-lib.mjs'
import {
  buildGameCatalogUpgrade,
  gameAliasesFor,
  summarizeGameCatalog,
} from './production-sync.mjs'

type Json = Record<string, unknown>
type VersionRow = typeof contentItemVersions.$inferSelect
type GameSummary = ReturnType<typeof summarizeGameCatalog>
type Plan = {
  schemaVersion: 1
  generatedAt: string
  apiRequests: 0
  activeRevision: {
    id: string
    version: string
    checksum: string
  }
  localSource: {
    path: string
    items: number
    checksum: string
  }
  before: GameSummary
  after: GameSummary
  checks: ReturnType<typeof qualityChecks>
  redirects: Array<{ duplicateId: string; canonicalId: string }>
  manualRepairs: string[]
  studioRepairs: string[]
  exclusions: Array<{ itemId: string; reason: string }>
  target: {
    games: Json[]
    localItems: Json[]
    gameChecksum: string
    localChecksum: string
    revisionChecksum: string
  }
}

const args = process.argv.slice(2)
const hasArg = (name: string) => args.includes(name)
const arg = (name: string) => {
  const direct = args.find((value) => value.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const apply = hasArg('--apply')
const activate = hasArg('--activate')
const planPath = resolve(arg('--plan') ?? './var/game-production-sync-plan.json')
const resultPath = resolve(arg('--result') ?? `${planPath}.result.json`)
const localLibraryPath = resolve(arg('--local-library') ?? './public/data/libraries/games/items.json')

const object = (value: unknown): Json => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
)
const chunks = <T,>(values: T[], size: number) => Array.from(
  { length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, (index + 1) * size),
)
const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Json)
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([key, entry]) => [key, canonicalJson(entry)]))
  }
  return value
}
const digest = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(canonicalJson(value)))
  .digest('hex')
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const finite = (value: unknown, fallback = 0) => (
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : fallback
)
const integer = (value: unknown) => (
  value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value))
    ? Number(value)
    : null
)
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const allowedInRegularGame = (payload: Json) => (
  payload.allowedInGame === true
  && payload.dailyEligible === true
  && text(payload.canonicalGameId) === text(payload.id)
  && !['blocked', 'review', 'duplicate', 'promo_pack'].includes(text(payload.contentStatus))
  && !text(payload.id).startsWith('promo:')
)

const config = loadConfig()
const { db, client } = createDatabase(config)

const activeRevision = async () => {
  const rows = await db.select({
    id: contentRevisions.id,
    version: contentRevisions.version,
    checksum: contentRevisions.checksumSha256,
    sourceManifest: contentRevisions.sourceManifest,
  }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!rows[0]) throw new Error('Active content revision was not found')
  return rows[0]
}

const persistedVersionSnapshot = (row: VersionRow) => ({
  itemId: row.itemId,
  mode: row.mode,
  titleRu: row.titleRu,
  titleOriginal: row.titleOriginal,
  normalizedTitle: row.normalizedTitle,
  year: row.year,
  endYear: row.endYear,
  popularityScore: row.popularityScore,
  topRank: row.topRank,
  sortOrder: row.sortOrder,
  allowedInGame: row.allowedInGame,
  contentStatus: row.contentStatus,
  payload: row.payload,
})

const activeGamePayload = (row: VersionRow): Json => ({
  ...object(row.payload),
  allowedInGame: row.allowedInGame,
  dailyEligible: row.allowedInGame,
  topRank: row.topRank ?? object(row.payload).topRank ?? null,
  contentStatus: row.contentStatus ?? object(row.payload).contentStatus ?? null,
})

const gameMaterial = (payload: Json, sortOrder: number) => ({
  itemId: text(payload.id),
  mode: 'game' as const,
  titleRu: text(payload.titleRu),
  titleOriginal: text(payload.titleOriginal),
  normalizedTitle: normalizeTitle(text(payload.titleRu) || text(payload.titleOriginal)),
  year: integer(payload.year),
  endYear: null,
  // The PostgreSQL driver serializes `real` values through their shortest
  // decimal representation. Persist a bounded decimal score so a read-back
  // produces the same value used by the revision checksum.
  popularityScore: Number(finite(payload.popularityScore ?? payload.recognitionScore).toFixed(4)),
  topRank: integer(payload.topRank),
  sortOrder,
  allowedInGame: allowedInRegularGame(payload),
  contentStatus: text(payload.contentStatus) || null,
  payload,
})

const orderedRevisionMaterial = (
  currentRows: VersionRow[],
  games: Json[],
) => {
  const material = [
    ...currentRows.filter((row) => row.mode !== 'game').map(persistedVersionSnapshot),
    ...games.map(gameMaterial),
  ]
  return material.sort((left, right) => (
    left.mode.localeCompare(right.mode)
    || left.sortOrder - right.sortOrder
    || left.itemId.localeCompare(right.itemId, 'en-US')
  ))
}

const filled = (summary: GameSummary, field: keyof GameSummary['optional']) => (
  summary.optional[field].filled
)

const qualityChecks = (before: GameSummary, after: GameSummary) => {
  const checks = {
    activePoolWasExpected: [998, 1000].includes(before.allowed),
    targetPoolIsExact: after.allowed === 1000,
    targetPoolDidNotShrink: after.allowed >= before.allowed,
    ranksAreExact: (
      after.ranks.filled === 1000
      && after.ranks.unique === 1000
      && after.ranks.min === 1
      && after.ranks.max === 1000
    ),
    requiredCoverageComplete: Object.values(after.required).every((coverage) => coverage.missing === 0),
    displayedAvailabilityComplete: after.displayed.complete.missing === 0,
    optionalCoverageDidNotRegress: Object.keys(after.optional).every((field) => (
      filled(after, field as keyof GameSummary['optional'])
      >= filled(before, field as keyof GameSummary['optional'])
    )),
    russianDescriptionsDidNotRegress: (
      after.language.russianDescriptions >= before.language.russianDescriptions
    ),
    russianHintsDidNotRegress: after.language.russianHints >= before.language.russianHints,
    noTextPlaceholders: (
      after.defects.redactedDescriptions === 0
      && after.defects.redactedShortDescriptions === 0
      && after.defects.serviceMarkers === 0
      && after.defects.mojibake === 0
    ),
    noInvalidAllowedMedia: after.defects.invalidAllowedMedia.length === 0,
    noDuplicatePlayableTitleYears: after.defects.duplicateTitleYears.length === 0,
    noDuplicatePlayableSteamIds: after.defects.duplicateSteamIds.length === 0,
  }
  return {
    ...checks,
    passed: Object.values(checks).every(Boolean),
  }
}

const assertPlanQuality = (checks: ReturnType<typeof qualityChecks>) => {
  const failed = Object.entries(checks)
    .filter(([key, value]) => key !== 'passed' && value !== true)
    .map(([key]) => key)
  if (failed.length) throw new Error(`Game quality gates failed: ${failed.join(', ')}`)
}

const readLocalGames = async () => {
  const sourceText = await readFile(localLibraryPath, 'utf8')
  const games = JSON.parse(sourceText) as Json[]
  if (!Array.isArray(games)) throw new Error('Local game library must be a JSON array')
  if (new Set(games.map((item) => text(item.id))).size !== games.length) {
    throw new Error('Local game library contains duplicate IDs')
  }
  return { games, checksum: digest(games) }
}

const buildPlan = async (): Promise<Plan> => {
  const revision = await activeRevision()
  const rows = await db.select().from(contentItemVersions)
    .where(eq(contentItemVersions.revisionId, revision.id))
  const activeGames = rows
    .filter((row) => row.mode === 'game')
    .map(activeGamePayload)
  const local = await readLocalGames()

  if (activeGames.length < 1000 || activeGames.length > 2500) {
    throw new Error(`Expected between 1000 and 2500 active game rows, found ${activeGames.length}`)
  }
  if (![2270, 2272].includes(local.games.length)) {
    throw new Error(`Expected 2270 or 2272 local game rows, found ${local.games.length}`)
  }

  const upgrade = buildGameCatalogUpgrade({
    activeGames,
    localGames: local.games,
    auditedAt: new Date().toISOString(),
  })
  const before = summarizeGameCatalog(activeGames)
  const after = upgrade.summary
  const checks = qualityChecks(before, after)
  if (!checks.passed) {
    console.error(JSON.stringify({ before, after, checks }, null, 2))
  }
  assertPlanQuality(checks)
  const revisionMaterial = orderedRevisionMaterial(rows, upgrade.items)

  return {
    schemaVersion: 1,
    generatedAt: upgrade.auditedAt,
    apiRequests: 0,
    activeRevision: {
      id: revision.id,
      version: revision.version,
      checksum: revision.checksum,
    },
    localSource: {
      path: localLibraryPath,
      items: local.games.length,
      checksum: local.checksum,
    },
    before,
    after,
    checks,
    redirects: upgrade.redirects,
    manualRepairs: upgrade.manualRepairs,
    studioRepairs: upgrade.studioRepairs,
    exclusions: upgrade.exclusions,
    target: {
      games: upgrade.items,
      localItems: upgrade.localItems,
      gameChecksum: digest(upgrade.items),
      localChecksum: digest(upgrade.localItems),
      revisionChecksum: digest(revisionMaterial),
    },
  }
}

const verifyPlanAgainstCurrentState = async (plan: Plan) => {
  if (
    plan.schemaVersion !== 1
    || plan.apiRequests !== 0
    || !Array.isArray(plan.target?.games)
    || !Array.isArray(plan.target?.localItems)
  ) {
    throw new Error('Unsupported game production sync plan')
  }
  assertPlanQuality(plan.checks)

  const revision = await activeRevision()
  if (revision.id !== plan.activeRevision.id || revision.checksum !== plan.activeRevision.checksum) {
    throw new Error('Active revision changed after the game sync plan was generated')
  }
  const rows = await db.select().from(contentItemVersions)
    .where(eq(contentItemVersions.revisionId, revision.id))
  const activeGames = rows
    .filter((row) => row.mode === 'game')
    .map(activeGamePayload)
  const local = await readLocalGames()
  if (local.checksum !== plan.localSource.checksum) {
    throw new Error('Local game library changed after the game sync plan was generated')
  }

  const upgrade = buildGameCatalogUpgrade({
    activeGames,
    localGames: local.games,
    auditedAt: plan.generatedAt,
  })
  const checks = qualityChecks(summarizeGameCatalog(activeGames), upgrade.summary)
  assertPlanQuality(checks)
  if (
    digest(upgrade.items) !== plan.target.gameChecksum
    || digest(upgrade.localItems) !== plan.target.localChecksum
    || digest(orderedRevisionMaterial(rows, upgrade.items)) !== plan.target.revisionChecksum
  ) {
    throw new Error('Recomputed target differs from the reviewed game sync plan')
  }

  return { revision, rows, upgrade }
}

const cloneAliasesAndVignettes = async (revisionId: string) => {
  const aliases = await db.select({
    oldVersionId: contentAliases.itemVersionId,
    itemId: contentItemVersions.itemId,
    mode: contentItemVersions.mode,
    alias: contentAliases.alias,
    normalizedAlias: contentAliases.normalizedAlias,
    kind: contentAliases.kind,
  }).from(contentAliases).innerJoin(
    contentItemVersions,
    eq(contentItemVersions.id, contentAliases.itemVersionId),
  ).where(eq(contentItemVersions.revisionId, revisionId))
  const vignettes = await db.select({
    id: diagnosisVignettes.id,
    oldVersionId: diagnosisVignettes.itemVersionId,
    itemId: contentItemVersions.itemId,
    text: diagnosisVignettes.text,
    sortOrder: diagnosisVignettes.sortOrder,
  }).from(diagnosisVignettes).innerJoin(
    contentItemVersions,
    eq(contentItemVersions.id, diagnosisVignettes.itemVersionId),
  ).where(eq(contentItemVersions.revisionId, revisionId))
  return { aliases, vignettes }
}

const applyPlan = async (plan: Plan) => {
  const { revision, rows, upgrade } = await verifyPlanAgainstCurrentState(plan)
  const inherited = await cloneAliasesAndVignettes(revision.id)
  const modes = await db.select().from(contentRevisionModes)
    .where(eq(contentRevisionModes.revisionId, revision.id))
  const materials = orderedRevisionMaterial(rows, upgrade.items)
  const checksum = digest(materials)
  if (checksum !== plan.target.revisionChecksum) throw new Error('Target revision checksum is not stable')

  const planDigest = digest({
    activeRevision: plan.activeRevision,
    localSource: plan.localSource,
    redirects: plan.redirects,
    manualRepairs: plan.manualRepairs,
    studioRepairs: plan.studioRepairs,
    exclusions: plan.exclusions,
    gameChecksum: plan.target.gameChecksum,
    localChecksum: plan.target.localChecksum,
    checks: plan.checks,
  })
  const version = `${plan.generatedAt.replace(/[-:.]/g, '')}-game-catalog-upgrade-${checksum.slice(0, 8)}`
  const matches = await db.select({
    id: contentRevisions.id,
    status: contentRevisions.status,
    sourceManifest: contentRevisions.sourceManifest,
  }).from(contentRevisions).where(eq(contentRevisions.checksumSha256, checksum)).limit(1)
  const matchingRevision = matches[0]
  if (matchingRevision) {
    const metadata = object(object(matchingRevision.sourceManifest).gameCatalogUpgrade)
    if (
      matchingRevision.status !== 'ready'
      || object(matchingRevision.sourceManifest).parentRevisionId !== revision.id
      || metadata.planDigest !== planDigest
    ) {
      throw new Error(`Checksum ${checksum} already belongs to an incompatible revision`)
    }
  }

  const newRevisionId = matchingRevision?.id ?? await db.transaction(async (tx) => {
    const insertedRevision = (await tx.insert(contentRevisions).values({
      version,
      checksumSha256: checksum,
      sourceManifest: {
        ...object(revision.sourceManifest),
        parentRevisionId: revision.id,
        gameCatalogUpgrade: {
          generatedAt: plan.generatedAt,
          source: 'active_revision_plus_repository_catalog',
          apiRequests: 0,
          before: plan.before,
          after: plan.after,
          checks: plan.checks,
          redirects: plan.redirects,
          manualRepairs: plan.manualRepairs,
          studioRepairs: plan.studioRepairs,
          exclusions: plan.exclusions,
          localSourceChecksum: plan.localSource.checksum,
          targetGameChecksum: plan.target.gameChecksum,
          targetLocalChecksum: plan.target.localChecksum,
          planDigest,
        },
      },
      status: 'importing',
    }).returning({ id: contentRevisions.id }))[0]

    const gameIds = upgrade.items.map((item) => text(item.id))
    for (const batch of chunks(gameIds, 500)) {
      const existing = await tx.select({ id: contentItems.id, mode: contentItems.mode })
        .from(contentItems).where(inArray(contentItems.id, batch))
      const wrongMode = existing.find((item) => item.mode !== 'game')
      if (wrongMode) throw new Error(`Game ID already belongs to ${wrongMode.mode}: ${wrongMode.id}`)
      const existingIds = new Set(existing.map((item) => item.id))
      const missing = batch.filter((id) => !existingIds.has(id))
      if (missing.length) {
        await tx.insert(contentItems).values(missing.map((id) => ({ id, mode: 'game' as const })))
      }
    }

    const insertedVersionByItem = new Map<string, string>()
    for (const batch of chunks(materials, 200)) {
      const inserted = await tx.insert(contentItemVersions).values(batch.map((material) => ({
        itemId: material.itemId,
        revisionId: insertedRevision.id,
        mode: material.mode,
        titleRu: material.titleRu,
        titleOriginal: material.titleOriginal,
        normalizedTitle: material.normalizedTitle,
        year: material.year,
        endYear: material.endYear,
        popularityScore: material.popularityScore,
        topRank: material.topRank,
        sortOrder: material.sortOrder,
        allowedInGame: material.allowedInGame,
        contentStatus: material.contentStatus,
        payload: material.payload,
      }))).returning({ id: contentItemVersions.id, itemId: contentItemVersions.itemId })
      for (const insertedRow of inserted) insertedVersionByItem.set(insertedRow.itemId, insertedRow.id)
    }

    const inheritedAliases = inherited.aliases.filter((row) => row.mode !== 'game')
    for (const batch of chunks(inheritedAliases, 500)) {
      await tx.insert(contentAliases).values(batch.map((row) => ({
        itemVersionId: insertedVersionByItem.get(row.itemId)!,
        alias: row.alias,
        normalizedAlias: row.normalizedAlias,
        kind: row.kind,
      })))
    }
    const gameAliases = upgrade.items.flatMap((item) => (
      gameAliasesFor(item, normalizeTitle).map((alias) => ({
        itemVersionId: insertedVersionByItem.get(text(item.id))!,
        ...alias,
      }))
    ))
    for (const batch of chunks(gameAliases, 500)) await tx.insert(contentAliases).values(batch)

    for (const batch of chunks(inherited.vignettes, 500)) {
      await tx.insert(diagnosisVignettes).values(batch.map((row) => ({
        id: `${insertedRevision.id.slice(0, 8)}:${row.id}`,
        itemVersionId: insertedVersionByItem.get(row.itemId)!,
        text: row.text,
        sortOrder: row.sortOrder,
      })))
    }

    await tx.insert(contentRevisionModes).values(modes.map((mode) => {
      if (mode.mode !== 'game') {
        const modeRows = materials.filter((row) => row.mode === mode.mode)
        return {
          revisionId: insertedRevision.id,
          mode: mode.mode,
          itemsCount: modeRows.length,
          sourceChecksum: mode.sourceChecksum,
        }
      }
      return {
        revisionId: insertedRevision.id,
        mode: 'game' as const,
        itemsCount: upgrade.items.length,
        sourceChecksum: plan.target.gameChecksum,
      }
    }))
    await tx.update(contentRevisions).set({ status: 'ready' })
      .where(eq(contentRevisions.id, insertedRevision.id))
    return insertedRevision.id
  })

  const verification = await db.select().from(contentItemVersions)
    .where(eq(contentItemVersions.revisionId, newRevisionId))
  if (verification.length !== materials.length) {
    throw new Error(`Ready revision has ${verification.length} rows; expected ${materials.length}`)
  }
  const verificationChecksum = digest(verification.map(persistedVersionSnapshot).sort((left, right) => (
    left.mode.localeCompare(right.mode)
    || left.sortOrder - right.sortOrder
    || left.itemId.localeCompare(right.itemId, 'en-US')
  )))
  if (verificationChecksum !== checksum) {
    const expectedByItem = new Map(materials.map((material) => [material.itemId, material]))
    const mismatches = verification.flatMap((row) => {
      const expected = expectedByItem.get(row.itemId)
      const actual = persistedVersionSnapshot(row)
      if (!expected) return [{ itemId: row.itemId, fields: ['missing_expected_material'] }]
      const fields = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
        .filter((field) => digest(expected[field as keyof typeof expected]) !== digest(actual[field as keyof typeof actual]))
      if (!fields.length) return []
      const payloadKeys = fields.includes('payload')
        ? [...new Set([
            ...Object.keys(object(expected.payload)),
            ...Object.keys(object(actual.payload)),
          ])].filter((field) => (
            digest(object(expected.payload)[field]) !== digest(object(actual.payload)[field])
          ))
        : []
      return [{
        itemId: row.itemId,
        fields,
        payloadKeys,
        values: Object.fromEntries(fields.filter((field) => field !== 'payload').map((field) => [
          field,
          {
            expected: expected[field as keyof typeof expected],
            actual: actual[field as keyof typeof actual],
          },
        ])),
      }]
    })
    console.error(JSON.stringify({
      expectedChecksum: checksum,
      actualChecksum: verificationChecksum,
      mismatchCount: mismatches.length,
      mismatches: mismatches.slice(0, 30),
    }, null, 2))
    throw new Error('Ready revision checksum verification failed')
  }

  const verificationByItem = new Map(verification.map((row) => [row.itemId, row]))
  for (const original of rows.filter((row) => row.mode !== 'game')) {
    const cloned = verificationByItem.get(original.itemId)
    if (!cloned || !same(persistedVersionSnapshot(cloned), persistedVersionSnapshot(original))) {
      throw new Error(`Non-game item changed during scoped clone: ${original.itemId}`)
    }
  }

  const verifiedGames = verification
    .filter((row) => row.mode === 'game')
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((row) => object(row.payload))
  const summary = summarizeGameCatalog(verifiedGames)
  const checks = qualityChecks(plan.before, summary)
  assertPlanQuality(checks)
  if (digest(verifiedGames) !== plan.target.gameChecksum) {
    throw new Error('Ready revision game payloads differ from the plan')
  }
  const aliases = await db.select({
    itemId: contentItemVersions.itemId,
    mode: contentItemVersions.mode,
  }).from(contentAliases).innerJoin(
    contentItemVersions,
    eq(contentItemVersions.id, contentAliases.itemVersionId),
  ).where(eq(contentItemVersions.revisionId, newRevisionId))
  const expectedNonGameAliases = inherited.aliases.filter((row) => row.mode !== 'game').length
  const expectedGameAliases = upgrade.items.reduce((total, item) => total + gameAliasesFor(item, normalizeTitle).length, 0)
  if (aliases.length !== expectedNonGameAliases + expectedGameAliases) {
    throw new Error('Ready revision alias count differs from the exact expected count')
  }
  const gamesWithAliases = new Set(aliases.filter((row) => row.mode === 'game').map((row) => row.itemId))
  if (gamesWithAliases.size !== upgrade.items.length) {
    throw new Error('At least one game card has no searchable alias')
  }
  const vignettes = await db.select({ id: diagnosisVignettes.id }).from(diagnosisVignettes).innerJoin(
    contentItemVersions,
    eq(contentItemVersions.id, diagnosisVignettes.itemVersionId),
  ).where(eq(contentItemVersions.revisionId, newRevisionId))
  if (vignettes.length !== inherited.vignettes.length) {
    throw new Error('Diagnosis vignette count changed during scoped clone')
  }

  const modePostcheck = [...new Set(materials.map((row) => row.mode))].map((mode) => ({
    mode,
    expectedItems: materials.filter((row) => row.mode === mode).length,
    actualItems: verification.filter((row) => row.mode === mode).length,
    expectedAllowed: materials.filter((row) => row.mode === mode && row.allowedInGame).length,
    actualAllowed: verification.filter((row) => row.mode === mode && row.allowedInGame).length,
  }))
  if (modePostcheck.some((mode) => (
    mode.expectedItems !== mode.actualItems || mode.expectedAllowed !== mode.actualAllowed
  ))) {
    throw new Error(`Ready revision mode counts failed: ${JSON.stringify(modePostcheck)}`)
  }

  const postcheck = {
    totalItems: verification.length,
    totalGames: verifiedGames.length,
    allowedGames: summary.allowed,
    excludedGames: summary.excluded,
    aliases: aliases.length,
    gameAliases: aliases.filter((row) => row.mode === 'game').length,
    vignettes: vignettes.length,
    apiRequests: 0,
    summary,
    checks,
    modes: modePostcheck,
  }

  if (activate) {
    await db.transaction(async (tx) => {
      const current = (await tx.select({ id: contentRevisions.id }).from(contentRevisions)
        .where(eq(contentRevisions.status, 'active')).for('update').limit(1))[0]
      if (current?.id !== revision.id) throw new Error('Active revision changed before activation')
      const target = (await tx.select({ status: contentRevisions.status }).from(contentRevisions)
        .where(eq(contentRevisions.id, newRevisionId)).for('update').limit(1))[0]
      if (target?.status !== 'ready') throw new Error('Target revision is not ready for activation')
      const workspace = (await tx.select().from(contentWorkspaces)
        .where(sql`${contentWorkspaces.status} in ('open','building','ready')`)
        .for('update')
        .limit(1))[0]
      if (workspace && workspace.baseRevisionId !== newRevisionId) {
        const pendingChanges = (await tx.select({ count: sql<number>`count(*)::int` })
          .from(contentWorkspaceChanges)
          .where(eq(contentWorkspaceChanges.workspaceId, workspace.id)))[0]?.count ?? 0
        if (pendingChanges > 0) {
          throw new Error(`Content workspace ${workspace.id} has ${pendingChanges} pending change(s)`)
        }
        await tx.update(contentWorkspaces)
          .set({ status: 'abandoned', lockedAt: null, updatedAt: new Date() })
          .where(eq(contentWorkspaces.id, workspace.id))
        await tx.insert(contentWorkspaces).values({
          baseRevisionId: newRevisionId,
          createdBy: config.adminUserIds[0],
        })
      } else if (!workspace) {
        await tx.insert(contentWorkspaces).values({
          baseRevisionId: newRevisionId,
          createdBy: config.adminUserIds[0],
        })
      }
      await tx.update(contentRevisions).set({ status: 'retired' }).where(eq(contentRevisions.id, revision.id))
      await tx.update(contentRevisions).set({ status: 'active', activatedAt: new Date() })
        .where(eq(contentRevisions.id, newRevisionId))
      await tx.insert(appSettings).values({
        key: 'active_content_revision_id',
        value: newRevisionId,
        updatedBy: config.adminUserIds[0],
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: sql`${JSON.stringify(newRevisionId)}::jsonb`,
          version: sql`${appSettings.version} + 1`,
          updatedBy: config.adminUserIds[0],
          updatedAt: new Date(),
        },
      })
      await tx.insert(auditLog).values({
        actorUserId: config.adminUserIds[0],
        action: 'content.game.catalog_upgrade',
        entityType: 'content_revision',
        entityId: newRevisionId,
        before: { revisionId: revision.id, summary: plan.before },
        after: { revisionId: newRevisionId, summary, checks, postcheck },
        reason: 'Merge the verified active game catalog with richer repository metadata without external API requests',
        requestId: `game-catalog-upgrade:${newRevisionId}`,
      })
    })
  }

  return {
    previousRevisionId: revision.id,
    newRevisionId,
    activated: activate,
    apiRequests: 0,
    postcheck,
  }
}

try {
  await mkdir(dirname(planPath), { recursive: true })
  if (!apply) {
    const plan = await buildPlan()
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({
      planPath,
      activeRevision: plan.activeRevision,
      localSource: plan.localSource,
      apiRequests: plan.apiRequests,
      redirects: plan.redirects.length,
      manualRepairs: plan.manualRepairs.length,
      studioRepairs: plan.studioRepairs.length,
      exclusions: plan.exclusions.length,
      before: plan.before,
      after: plan.after,
      checks: plan.checks,
      target: {
        games: plan.target.games.length,
        localItems: plan.target.localItems.length,
        gameChecksum: plan.target.gameChecksum,
        localChecksum: plan.target.localChecksum,
        revisionChecksum: plan.target.revisionChecksum,
      },
    }, null, 2))
  } else {
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as Plan
    const result = await applyPlan(plan)
    await mkdir(dirname(resultPath), { recursive: true })
    await writeFile(resultPath, `${JSON.stringify({
      ...result,
      appliedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ ...result, resultPath }, null, 2))
  }
} finally {
  await client.end()
}
