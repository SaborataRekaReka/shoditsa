import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  appSettings,
  auditLog,
  contentAliases,
  contentItemVersions,
  contentRevisionModes,
  contentRevisions,
  createDatabase,
  diagnosisVignettes,
} from '@shoditsa/database'
import type { ContentMode, TitleItem } from '@shoditsa/contracts'
import {
  contentDuplicateGroups,
  isAllowedInRegularGame,
  isPlayableGamePlotHint,
  isPromoGameItem,
  normalize,
  playablePlotHints,
} from '@shoditsa/game-core'
import { validateCatalogInvariants } from '../../apps/api/src/modules/admin/content-service.js'

type Json = Record<string, unknown>
type VersionRow = typeof contentItemVersions.$inferSelect
type Repair = {
  itemId: string
  mode: ContentMode
  reasons: string[]
  beforeAllowed: boolean
  afterAllowed: boolean
  beforeStatus: string | null
  afterStatus: string | null
  canonicalId: string | null
  hintVariants: number
}
type RepairPlan = {
  schemaVersion: 1
  generatedAt: string
  activeRevision: { id: string; version: string; checksum: string }
  repairs: Repair[]
  duplicateGroups: Array<{ canonicalId: string; duplicateIds: string[]; allIds: string[] }>
  publicationImpact: {
    removedFromRegularPool: Array<{ id: string; mode: ContentMode; title: string; reason: string[] }>
    addedToRegularPool: Array<{ id: string; mode: ContentMode; title: string }>
    retainedAnswersViaCanonical: Array<{ removedId: string; canonicalId: string }>
  }
  countsBefore: Record<string, number>
  countsAfter: Record<string, number>
  resultingPayloads: Record<string, Json>
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
const reportPath = resolve(arg('--report') ?? './var/catalog-repair-plan.json')
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const chunks = <T,>(values: T[], size: number) => Array.from(
  { length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, (index + 1) * size),
)
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const uniqueComments = (values: unknown[]) => {
  const result = new Map<string, unknown>()
  for (const value of values) {
    const entry = object(value)
    const key = String(entry.contentHash ?? entry.sourceId ?? entry.key ?? normalize(String(entry.text ?? ''))).trim()
    if (key && !result.has(key)) result.set(key, value)
  }
  return [...result.values()]
}
const completeHintText = (value: unknown) => {
  const original = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!original) return ''
  if (!/(?:\.\.\.|…)\s*$/.test(original)) return original
  const withoutEllipsis = original.replace(/(?:\.\.\.|…)\s*$/, '').trim()
  const completeSentences = [...withoutEllipsis.matchAll(/[.!?](?:\s|$)/g)]
  const lastComplete = completeSentences.at(-1)
  if (lastComplete && lastComplete.index != null && lastComplete.index >= 40) {
    return withoutEllipsis.slice(0, lastComplete.index + 1).trim()
  }
  return `${withoutEllipsis.replace(/[,;:–—-]\s*$/, '').trim()}.`
}
const replacementHint = (payload: Json) => {
  const item = payload as TitleItem
  const values = [
    ...(Array.isArray(payload.plotHintVariants) ? payload.plotHintVariants : []),
    payload.description,
    payload.shortDescription,
    payload.plotHint,
  ]
  for (const value of values) {
    const candidate = completeHintText(value)
    if (isPlayableGamePlotHint({ ...item, plotHint: candidate })) return candidate
  }
  return null
}
const MANUAL_HINT_REPAIRS: Record<string, string> = {
  kp_44457: 'Датский принц встречает призрак умершего отца и узнаёт о преступлении, после чего месть превращает королевский двор в трагедию.',
  kp_251734: 'В конце 1970-х дружная шахтёрская семья переживает повседневные радости и испытания, которые постепенно меняют её привычную жизнь.',
  kp_79844: 'Пионеры 1920-х годов находят старинное морское оружие с зашифрованным посланием и вступают в противостояние с бандитами.',
  kp_501717: 'В XVII веке церковные реформы патриарха Никона сталкивают власть, духовенство и убеждённых противников преобразований.',
  kp_743445: 'Детектив возвращается на суровые северные острова и расследует преступления в тесном сообществе, где почти все знают друг друга.',
  kp_84342: 'Военная драма рассказывает о бойцах, которых отправляли на самые опасные участки фронта, где они добывали шанс вернуться в обычные части.',
  shiki_20583: 'Невысокий школьник вступает в команду Карасуно и вместе с бывшим соперником учится побеждать более опытных противников на площадке.',
}
const allowedFor = (mode: ContentMode, payload: Json) => {
  if (mode === 'danetki') return payload.allowedInGame === true && ['test', 'ready'].includes(String(payload.contentStatus ?? ''))
  return isAllowedInRegularGame(payload as TitleItem)
}
const countAllowed = (rows: VersionRow[], payloads: Map<string, Json>) => {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    if (allowedFor(row.mode, payloads.get(row.itemId) ?? object(row.payload))) {
      counts[row.mode] = (counts[row.mode] ?? 0) + 1
    }
  }
  return counts
}
const chooseCanonical = (items: TitleItem[]) => [...items].sort((left, right) => {
  const score = (item: TitleItem) => (
    (isPromoGameItem(item) ? 0 : 10_000)
    + (item.id === item.canonicalId || item.id === item.canonicalGameId ? 2_000 : 0)
    + (/_\d+$/.test(item.id) ? 0 : 500)
    + (/^(?:kp_|tgdb_|music:|shikimori)/.test(item.id) ? 100 : 0)
    + Math.min(99, Math.max(0, Number(item.popularityScore) || 0))
  )
  return score(right) - score(left) || left.id.localeCompare(right.id)
})[0]

const config = loadConfig()
const { db, client } = createDatabase(config)

const loadActive = async () => {
  const revision = (await db.select({
    id: contentRevisions.id,
    version: contentRevisions.version,
    checksum: contentRevisions.checksumSha256,
    sourceManifest: contentRevisions.sourceManifest,
  }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!revision) throw new Error('Active content revision was not found')
  const rows = await db.select().from(contentItemVersions)
    .where(eq(contentItemVersions.revisionId, revision.id))
  return { revision, rows }
}

const buildPlan = async (): Promise<RepairPlan> => {
  const { revision, rows } = await loadActive()
  const before = new Map(rows.map((row) => [row.itemId, object(row.payload)]))
  const after = new Map(rows.map((row) => [row.itemId, { ...object(row.payload) }]))
  const reasons = new Map<string, Set<string>>()
  const mark = (itemId: string, reason: string) => {
    reasons.set(itemId, new Set([...(reasons.get(itemId) ?? []), reason]))
  }
  for (const row of rows) {
    const payload = after.get(row.itemId)!
    if (!row.allowedInGame && payload.allowedInGame !== false) {
      payload.allowedInGame = false
      mark(row.itemId, 'aligned_payload_with_effective_pool')
    }
    if (row.mode === 'music' && Number.isFinite(Number(payload.year))) {
      if (!Number.isFinite(Number(payload.activityStartYear))) {
        payload.activityStartYear = Number(payload.year)
      }
      delete payload.year
      mark(row.itemId, 'migrated_legacy_music_year')
    }
  }

  const titleItems = rows
    .filter((row) => row.mode !== 'danetki')
    .map((row) => after.get(row.itemId) as TitleItem)
  const duplicateGroups: RepairPlan['duplicateGroups'] = []
  const canonicalForDuplicate = new Map<string, string>()
  for (const group of contentDuplicateGroups(titleItems)) {
    const groupRows = group.map((item) => rows.find((row) => row.itemId === item.id)!).filter(Boolean)
    if (groupRows.filter((row) => row.allowedInGame).length < 2) continue
    const canonical = chooseCanonical(group)
    const duplicateIds = group.map((item) => item.id).filter((id) => id !== canonical.id).sort()
    duplicateGroups.push({ canonicalId: canonical.id, duplicateIds, allIds: group.map((item) => item.id).sort() })

    const canonicalPayload = after.get(canonical.id)!
    const hints = group.flatMap((item) => playablePlotHints(item))
    const primaryHint = String(canonicalPayload.plotHint ?? '').trim()
    const variants = [...new Map(hints.map((hint) => [normalize(hint), hint])).values()]
      .filter((hint) => normalize(hint) !== normalize(primaryHint))
    canonicalPayload.plotHintVariants = variants
    const comments = group.flatMap((item) => Array.isArray(item.comments) ? item.comments : [])
    if (comments.length) canonicalPayload.comments = uniqueComments(comments)
    canonicalPayload.allowedInGame = true
    if (String(canonicalPayload.contentStatus ?? '') === 'review') canonicalPayload.contentStatus = null
    mark(canonical.id, 'canonicalized_duplicate_group')

    for (const duplicateId of duplicateIds) {
      const payload = after.get(duplicateId)!
      payload.allowedInGame = false
      payload.canonicalId = canonical.id
      payload.contentStatus = isPromoGameItem(payload as TitleItem) ? 'promo_pack' : 'duplicate'
      mark(duplicateId, 'merged_into_canonical')
      canonicalForDuplicate.set(duplicateId, canonical.id)
    }
  }

  for (const row of rows) {
    const payload = after.get(row.itemId)!
    if (isPromoGameItem(payload as TitleItem)) {
      if (payload.allowedInGame !== false) mark(row.itemId, 'promo_is_special_pack_only')
      payload.allowedInGame = false
      payload.contentStatus = 'promo_pack'
    }
    if (String(payload.contentStatus ?? '') === 'review' && row.allowedInGame) {
      payload.contentStatus = null
      mark(row.itemId, 'cleared_stale_review_status')
    }
    if (row.itemId === 'kp_4569') {
      payload.plotHint = 'Служебный роман превращается для успешного специалиста в борьбу за карьеру, репутацию и право доказать правду.'
      mark(row.itemId, 'replaced_short_plot_hint')
    }
    const manualHint = MANUAL_HINT_REPAIRS[row.itemId]
    if (manualHint) {
      payload.plotHint = manualHint
      mark(row.itemId, 'replaced_answer_leaking_plot_hint')
    }
    if (
      row.mode !== 'danetki'
      && payload.allowedInGame !== false
      && !isPromoGameItem(payload as TitleItem)
      && !['blocked', 'duplicate', 'promo_pack'].includes(String(payload.contentStatus ?? ''))
      && playablePlotHints(payload as TitleItem).length === 0
    ) {
      const replacement = replacementHint(payload)
      if (replacement) {
        payload.plotHint = replacement
        payload.plotHintVariants = playablePlotHints({ ...payload, plotHint: replacement } as TitleItem)
          .filter((hint) => normalize(hint) !== normalize(replacement))
        mark(row.itemId, 'repaired_unplayable_plot_hint')
      } else {
        payload.allowedInGame = false
        mark(row.itemId, 'disabled_unrepairable_plot_hint')
      }
    }
  }

  const invariantIssues = validateCatalogInvariants(rows
    .filter((row) => row.mode !== 'danetki')
    .map((row) => after.get(row.itemId) as TitleItem))
  if (invariantIssues.length) {
    throw new Error(`Repair plan still violates catalog invariants: ${JSON.stringify(invariantIssues.slice(0, 25))}`)
  }

  const repairs: Repair[] = []
  for (const row of rows) {
    const beforePayload = before.get(row.itemId)!
    const afterPayload = after.get(row.itemId)!
    if (JSON.stringify(beforePayload) === JSON.stringify(afterPayload)) continue
    repairs.push({
      itemId: row.itemId,
      mode: row.mode,
      reasons: [...(reasons.get(row.itemId) ?? [])].sort(),
      beforeAllowed: row.allowedInGame,
      afterAllowed: allowedFor(row.mode, afterPayload),
      beforeStatus: row.contentStatus,
      afterStatus: String(afterPayload.contentStatus ?? '').trim() || null,
      canonicalId: String(afterPayload.canonicalId ?? '').trim() || null,
      hintVariants: Array.isArray(afterPayload.plotHintVariants) ? afterPayload.plotHintVariants.length : 0,
    })
  }

  const removedFromRegularPool = repairs.filter((repair) => repair.beforeAllowed && !repair.afterAllowed).map((repair) => ({
    id: repair.itemId,
    mode: repair.mode,
    title: String(after.get(repair.itemId)?.titleRu ?? ''),
    reason: repair.reasons,
  }))
  const addedToRegularPool = repairs.filter((repair) => !repair.beforeAllowed && repair.afterAllowed).map((repair) => ({
    id: repair.itemId,
    mode: repair.mode,
    title: String(after.get(repair.itemId)?.titleRu ?? ''),
  }))

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    activeRevision: { id: revision.id, version: revision.version, checksum: revision.checksum },
    repairs,
    duplicateGroups,
    publicationImpact: {
      removedFromRegularPool,
      addedToRegularPool,
      retainedAnswersViaCanonical: removedFromRegularPool.flatMap((entry) => {
        const canonicalId = canonicalForDuplicate.get(entry.id)
        return canonicalId ? [{ removedId: entry.id, canonicalId }] : []
      }),
    },
    countsBefore: countAllowed(rows, before),
    countsAfter: countAllowed(rows, after),
    resultingPayloads: Object.fromEntries(repairs.map((repair) => [repair.itemId, after.get(repair.itemId)!])),
  }
}

const applyPlan = async (plan: RepairPlan) => {
  const { revision, rows } = await loadActive()
  if (plan.schemaVersion !== 1 || revision.id !== plan.activeRevision.id || revision.checksum !== plan.activeRevision.checksum) {
    throw new Error('Active revision changed after the repair plan was generated')
  }
  const payloadByItem = new Map(rows.map((row) => [row.itemId, object(row.payload)]))
  for (const [itemId, payload] of Object.entries(plan.resultingPayloads)) {
    if (!payloadByItem.has(itemId)) throw new Error(`Planned item is missing: ${itemId}`)
    payloadByItem.set(itemId, payload)
  }
  const aliases = await db.select({
    oldVersionId: contentAliases.itemVersionId,
    alias: contentAliases.alias,
    normalizedAlias: contentAliases.normalizedAlias,
    kind: contentAliases.kind,
  }).from(contentAliases).innerJoin(contentItemVersions, eq(contentItemVersions.id, contentAliases.itemVersionId))
    .where(eq(contentItemVersions.revisionId, revision.id))
  const vignettes = await db.select({
    id: diagnosisVignettes.id,
    oldVersionId: diagnosisVignettes.itemVersionId,
    text: diagnosisVignettes.text,
    sortOrder: diagnosisVignettes.sortOrder,
  }).from(diagnosisVignettes).innerJoin(contentItemVersions, eq(contentItemVersions.id, diagnosisVignettes.itemVersionId))
    .where(eq(contentItemVersions.revisionId, revision.id))

  const generatedAt = new Date().toISOString()
  const orderedPayloads = [...rows]
    .sort((left, right) => left.mode.localeCompare(right.mode) || left.sortOrder - right.sortOrder)
    .map((row) => payloadByItem.get(row.itemId)!)
  const checksum = digest(orderedPayloads)
  const version = `${generatedAt.replace(/[-:.]/g, '')}-catalog-root-repair-${checksum.slice(0, 8)}`
  const newRevisionId = await db.transaction(async (tx) => {
    const insertedRevision = (await tx.insert(contentRevisions).values({
      version,
      checksumSha256: checksum,
      sourceManifest: {
        ...object(revision.sourceManifest),
        parentRevisionId: revision.id,
        catalogRootRepair: {
          generatedAt,
          repairs: plan.repairs.length,
          duplicateGroups: plan.duplicateGroups.length,
          reportDigest: digest({ repairs: plan.repairs, publicationImpact: plan.publicationImpact }),
        },
      },
      status: 'importing',
    }).returning({ id: contentRevisions.id }))[0]

    const newVersionIdByOld = new Map<string, string>()
    for (const batch of chunks(rows, 200)) {
      const inserted = await tx.insert(contentItemVersions).values(batch.map((row) => {
        const payload = payloadByItem.get(row.itemId)!
        return {
          itemId: row.itemId,
          revisionId: insertedRevision.id,
          mode: row.mode,
          titleRu: String(payload.titleRu ?? row.titleRu),
          titleOriginal: String(payload.titleOriginal ?? row.titleOriginal),
          normalizedTitle: normalize(String(payload.titleRu ?? row.titleRu)),
          year: Number.isInteger(payload.year) ? Number(payload.year) : null,
          endYear: Number.isInteger(payload.endYear) ? Number(payload.endYear) : null,
          popularityScore: Number.isFinite(Number(payload.popularityScore)) ? Number(payload.popularityScore) : 0,
          topRank: Number.isInteger(payload.topRank) ? Number(payload.topRank) : null,
          sortOrder: row.sortOrder,
          allowedInGame: allowedFor(row.mode, payload),
          contentStatus: String(payload.contentStatus ?? '').trim() || null,
          payload,
        }
      })).returning({ id: contentItemVersions.id, itemId: contentItemVersions.itemId })
      const oldIdByItem = new Map(batch.map((row) => [row.itemId, row.id]))
      for (const insertedRow of inserted) newVersionIdByOld.set(oldIdByItem.get(insertedRow.itemId)!, insertedRow.id)
    }
    for (const batch of chunks(aliases, 500)) {
      await tx.insert(contentAliases).values(batch.map((row) => ({
        itemVersionId: newVersionIdByOld.get(row.oldVersionId)!,
        alias: row.alias,
        normalizedAlias: row.normalizedAlias,
        kind: row.kind,
      })))
    }
    for (const batch of chunks(vignettes, 500)) {
      await tx.insert(diagnosisVignettes).values(batch.map((row) => ({
        id: `${insertedRevision.id.slice(0, 8)}:${row.id}`,
        itemVersionId: newVersionIdByOld.get(row.oldVersionId)!,
        text: row.text,
        sortOrder: row.sortOrder,
      })))
    }
    const modes = [...new Set(rows.map((row) => row.mode))]
    await tx.insert(contentRevisionModes).values(modes.map((mode) => {
      const modeRows = rows.filter((row) => row.mode === mode)
      return {
        revisionId: insertedRevision.id,
        mode,
        itemsCount: modeRows.length,
        sourceChecksum: digest(modeRows.map((row) => payloadByItem.get(row.itemId))),
      }
    }))
    await tx.update(contentRevisions).set({ status: 'ready' }).where(eq(contentRevisions.id, insertedRevision.id))
    return insertedRevision.id
  })

  const verification = await db.select().from(contentItemVersions)
    .where(eq(contentItemVersions.revisionId, newRevisionId))
  if (verification.length !== rows.length) throw new Error('Cloned revision item count does not match the active revision')
  const verificationIssues = validateCatalogInvariants(verification
    .filter((row) => row.mode !== 'danetki')
    .map((row) => row.payload as TitleItem))
  if (verificationIssues.length) throw new Error(`Cloned revision violates catalog invariants: ${JSON.stringify(verificationIssues.slice(0, 25))}`)

  if (activate) {
    await db.transaction(async (tx) => {
      const current = (await tx.select({ id: contentRevisions.id }).from(contentRevisions)
        .where(eq(contentRevisions.status, 'active')).for('update').limit(1))[0]
      if (current?.id !== revision.id) throw new Error('Active revision changed before activation')
      await tx.update(contentRevisions).set({ status: 'retired' }).where(eq(contentRevisions.id, revision.id))
      await tx.update(contentRevisions).set({ status: 'active', activatedAt: new Date() }).where(eq(contentRevisions.id, newRevisionId))
      await tx.insert(appSettings).values({ key: 'active_content_revision_id', value: newRevisionId })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: sql`${JSON.stringify(newRevisionId)}::jsonb`, version: sql`${appSettings.version} + 1`, updatedAt: new Date() },
        })
      await tx.insert(auditLog).values({
        action: 'content.catalog.root_repair',
        entityType: 'content_revision',
        entityId: newRevisionId,
        before: { revisionId: revision.id, counts: plan.countsBefore },
        after: { revisionId: newRevisionId, counts: plan.countsAfter, publicationImpact: plan.publicationImpact },
        reason: 'Canonicalize duplicate identities and enforce root publication invariants',
        requestId: `catalog-root-repair:${newRevisionId}`,
      })
    })
  }

  return {
    previousRevisionId: revision.id,
    newRevisionId,
    activated: activate,
    items: verification.length,
    repairs: plan.repairs.length,
    publicationImpact: plan.publicationImpact,
  }
}

try {
  await mkdir(dirname(reportPath), { recursive: true })
  if (!apply) {
    const plan = await buildPlan()
    await writeFile(reportPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({
      reportPath,
      activeRevision: plan.activeRevision,
      repairs: plan.repairs.length,
      duplicateGroups: plan.duplicateGroups,
      countsBefore: plan.countsBefore,
      countsAfter: plan.countsAfter,
      publicationImpact: plan.publicationImpact,
    }, null, 2))
  } else {
    const plan = JSON.parse(await (await import('node:fs/promises')).readFile(reportPath, 'utf8')) as RepairPlan
    console.log(JSON.stringify(await applyPlan(plan), null, 2))
  }
} finally {
  await client.end()
}
