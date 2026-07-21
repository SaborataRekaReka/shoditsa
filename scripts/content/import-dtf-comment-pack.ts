#!/usr/bin/env tsx
/**
 * Import the DTF comment special into the active Shoditsa content revision.
 *
 * The script never rewrites canonical game cards. It resolves each answer against
 * the active catalog and stores comment clues only in content_pack_entries.prompt_payload.
 *
 * Usage:
 *   npm run content:import:dtf-comments-pack
 *
 * Publish the pack instead of keeping it draft:
 *   ... --publish
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  contentItemVersions,
  contentPackEntries,
  contentPacks,
  contentRevisions,
  createDatabase,
} from '@shoditsa/database'

type AnswerRef = {
  mode: 'game'
  titleRu: string
  titleOriginal: string
  year: number
  legacyReleaseYears: number[]
  steamAppIds: number[]
  aliases: string[]
  resolutionOrder: string[]
}

type ProgressiveHint = {
  key: string
  unlockAfterAttempts: number
  type: string
  text: string
  spoilerRisk: 'low' | 'medium' | 'high'
  sourceId?: string
  clueStrength: number
  topics?: string[]
}

type PackItem = {
  id: string
  gameId: string
  order: number
  answerRef: AnswerRef
  progressiveHints: ProgressiveHint[]
}

type PackDocument = {
  schemaVersion: number
  pack: {
    id: string
    slug: string
    title: string
    subtitle?: string
    description: string
    itemCount: number
    recommendedMaxAttempts: number
    accessModel: 'free' | 'club' | 'purchase'
    publicationStatus: string
    rightsStatus: string
    uiCopy: {
      prompt: string
      disclaimer: string
      [key: string]: string
    }
    experience?: Record<string, unknown>
    playSets?: unknown[]
  }
  items: PackItem[]
}

type CatalogRow = {
  itemVersionId: string
  itemId: string
  titleRu: string
  titleOriginal: string
  year: number | null
  allowedInGame: boolean
  contentStatus: string | null
  popularityScore: number
  payload: Record<string, unknown>
}

type Resolution = {
  item: PackItem
  status: 'resolved' | 'unresolved'
  method: 'steamAppId' | 'normalizedTitleAndYear' | 'normalizedTitle' | null
  itemId: string | null
  itemVersionId: string | null
  matchedTitle: string | null
  matchedYear: number | null
}

const args = process.argv.slice(2)
const hasFlag = (name: string) => args.includes(`--${name}`)
const argValue = (name: string, fallback: string) => {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback
}

const sourcePath = resolve(process.cwd(), argValue('source', 'data/promo/dtf-game-comments-25-v1.json'))
const reportPath = resolve(process.cwd(), argValue('report', 'var/dtf-game-comments-25-import-report.json'))
// The special enriches canonical catalog games only. Missing matches are
// reported and never materialized as duplicate cards.
const publish = hasFlag('publish')

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/&/g, ' and ')
  .replace(/['’`]/g, '')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const uniqueStrings = (values: unknown[]) => [...new Set(
  values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean),
)]

const numericSteamIds = (value: unknown) => (
  (Array.isArray(value) ? value : [value])
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0)
)

const namesForRow = (row: CatalogRow) => {
  const payload = asRecord(row.payload)
  return uniqueStrings([
    row.titleRu,
    row.titleOriginal,
    payload.titleRu,
    payload.titleOriginal,
    payload.alternativeTitles,
    payload.aliases,
  ])
}

const steamIdsForRow = (row: CatalogRow) => {
  const payload = asRecord(row.payload)
  return [...new Set([
    ...numericSteamIds(payload.steamAppId),
    ...numericSteamIds(payload.steamAppIds),
  ])]
}

const candidateScore = (row: CatalogRow) => (
  (row.contentStatus === 'promo_pack' ? 0 : 100_000)
  + (row.allowedInGame ? 10_000 : 0)
  + Math.round(Number(row.popularityScore || 0))
)

const chooseBest = (rows: CatalogRow[]) => (
  [...rows].sort((left, right) => candidateScore(right) - candidateScore(left))[0] ?? null
)

const resolveItem = (item: PackItem, rows: CatalogRow[]): Resolution => {
  const ref = item.answerRef
  const refSteam = new Set(ref.steamAppIds.map(Number))
  const refNames = uniqueStrings([
    ref.titleRu,
    ref.titleOriginal,
    ref.aliases,
  ]).map(normalize).filter(Boolean)
  const allowedYears = new Set([ref.year, ...(ref.legacyReleaseYears ?? [])].map(Number))

  if (refSteam.size > 0) {
    const candidates = rows.filter((row) => steamIdsForRow(row).some((id) => refSteam.has(id)))
    const match = chooseBest(candidates)
    if (match) return {
      item,
      status: 'resolved',
      method: 'steamAppId',
      itemId: match.itemId,
      itemVersionId: match.itemVersionId,
      matchedTitle: match.titleRu || match.titleOriginal,
      matchedYear: match.year,
    }
  }

  const titleYearCandidates = rows.filter((row) => (
    row.year !== null
    && allowedYears.has(Number(row.year))
    && namesForRow(row).map(normalize).some((name) => refNames.includes(name))
  ))
  const titleYearMatch = chooseBest(titleYearCandidates)
  if (titleYearMatch) return {
    item,
    status: 'resolved',
    method: 'normalizedTitleAndYear',
    itemId: titleYearMatch.itemId,
    itemVersionId: titleYearMatch.itemVersionId,
    matchedTitle: titleYearMatch.titleRu || titleYearMatch.titleOriginal,
    matchedYear: titleYearMatch.year,
  }

  // Title-only matching is deliberately restricted to cards with a missing year
  // or an allowed year. This avoids binding a remake to the original edition.
  const titleCandidates = rows.filter((row) => (
    (row.year === null || allowedYears.has(Number(row.year)))
    && namesForRow(row).map(normalize).some((name) => refNames.includes(name))
  ))
  const titleMatch = chooseBest(titleCandidates)
  if (titleMatch) return {
    item,
    status: 'resolved',
    method: 'normalizedTitle',
    itemId: titleMatch.itemId,
    itemVersionId: titleMatch.itemVersionId,
    matchedTitle: titleMatch.titleRu || titleMatch.titleOriginal,
    matchedYear: titleMatch.year,
  }

  return {
    item,
    status: 'unresolved',
    method: null,
    itemId: null,
    itemVersionId: null,
    matchedTitle: null,
    matchedYear: null,
  }
}

const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const main = async () => {
  const document = JSON.parse(await readFile(sourcePath, 'utf8')) as PackDocument
  if (document.schemaVersion !== 1) throw new Error(`Unsupported schemaVersion: ${document.schemaVersion}`)
  if (document.items.length !== document.pack.itemCount) {
    throw new Error(`Pack declares ${document.pack.itemCount} items, got ${document.items.length}`)
  }

  const config = loadConfig()
  const { db, client } = createDatabase(config)

  try {
    const revisionRows = await db.select({ id: contentRevisions.id })
      .from(contentRevisions)
      .where(eq(contentRevisions.status, 'active'))
      .limit(1)
    const revisionId = revisionRows[0]?.id
    if (!revisionId) throw new Error('Active content revision is required')

    const rows = await db.select({
      itemVersionId: contentItemVersions.id,
      itemId: contentItemVersions.itemId,
      titleRu: contentItemVersions.titleRu,
      titleOriginal: contentItemVersions.titleOriginal,
      year: contentItemVersions.year,
      allowedInGame: contentItemVersions.allowedInGame,
      contentStatus: contentItemVersions.contentStatus,
      popularityScore: contentItemVersions.popularityScore,
      payload: contentItemVersions.payload,
    }).from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, revisionId),
      eq(contentItemVersions.mode, 'game'),
    )) as CatalogRow[]

    const resolutions = document.items
      .sort((left, right) => left.order - right.order)
      .map((item) => resolveItem(item, rows))

    const canonicalIds = resolutions
      .filter((entry) => entry.status === 'resolved')
      .map((entry) => entry.itemId)
      .filter((value): value is string => Boolean(value))
    const duplicateCanonicalBindings = [...new Set(
      canonicalIds.filter((value, index) => canonicalIds.indexOf(value) !== index),
    )]

    const unresolved = resolutions.filter((entry) => entry.status === 'unresolved')
    const baseReport = {
      generatedAt: new Date().toISOString(),
      sourcePath,
      packId: document.pack.id,
      revisionId,
      publish,
      counts: {
        requested: document.items.length,
        resolved: resolutions.length - unresolved.length,
        unresolved: unresolved.length,
      },
      duplicateCanonicalBindings,
      missingGames: unresolved.map(({ item }) => ({
        gameId: item.gameId,
        titleRu: item.answerRef.titleRu,
        titleOriginal: item.answerRef.titleOriginal,
        year: item.answerRef.year,
        steamAppIds: item.answerRef.steamAppIds,
        aliases: item.answerRef.aliases,
      })),
      resolutions: resolutions.map((entry) => ({
        gameId: entry.item.gameId,
        packItemId: entry.item.id,
        status: entry.status,
        method: entry.method,
        itemId: entry.itemId,
        itemVersionId: entry.itemVersionId,
        matchedTitle: entry.matchedTitle,
        matchedYear: entry.matchedYear,
      })),
    }

    if (duplicateCanonicalBindings.length > 0) {
      await writeJson(reportPath, { ...baseReport, imported: false, error: 'DUPLICATE_CANONICAL_BINDING' })
      throw new Error(`Several pack items resolved to the same catalog card: ${duplicateCanonicalBindings.join(', ')}`)
    }

    if (unresolved.length > 0) {
      await writeJson(reportPath, {
        ...baseReport,
        imported: false,
        nextStep: 'Import the missing games into the canonical game catalog, activate that revision, then rerun this importer.',
      })
      console.error(`Import stopped: ${unresolved.length} game(s) are absent from the active catalog.`)
      console.error(`Resolution report: ${reportPath}`)
      process.exitCode = 2
      return
    }

    const resolvedByGameId = new Map(resolutions.map((entry) => [entry.item.gameId, entry]))
    const importableItems = document.items.filter((item) => Boolean(resolvedByGameId.get(item.gameId)?.itemId))
    if (importableItems.length === 0) {
      await writeJson(reportPath, { ...baseReport, imported: false, error: 'NO_EXISTING_CATALOG_MATCHES' })
      throw new Error('No pack games match existing cards in the active catalog')
    }
    const resolvedSubtitle = document.pack.subtitle ?? `Спецпоказ DTF · ${importableItems.length} игр`

    await db.transaction(async (tx) => {
      const packStatus = publish ? 'published' : 'draft'
      await tx.insert(contentPacks).values({
        id: document.pack.id,
        slug: document.pack.slug,
        mode: 'game',
        title: document.pack.title,
        subtitle: resolvedSubtitle,
        description: document.pack.description,
        status: packStatus,
        accessModel: document.pack.accessModel,
        productId: null,
        includedInClub: true,
        previewItems: importableItems.length,
        manifestVersion: document.schemaVersion,
        metadata: {
          source: sourcePath,
          integrationStrategy: 'content_pack_sidecar_enrichment',
          recommendedMaxAttempts: document.pack.recommendedMaxAttempts,
          publicationStatus: document.pack.publicationStatus,
          rightsStatus: document.pack.rightsStatus,
          experience: document.pack.experience ?? {},
          playSets: document.pack.playSets ?? [],
          uiCopy: document.pack.uiCopy,
        },
      }).onConflictDoUpdate({
        target: contentPacks.id,
        set: {
          slug: document.pack.slug,
          title: document.pack.title,
          subtitle: resolvedSubtitle,
          description: document.pack.description,
          status: packStatus,
          accessModel: document.pack.accessModel,
          productId: null,
          includedInClub: true,
          previewItems: importableItems.length,
          manifestVersion: document.schemaVersion,
          metadata: {
            source: sourcePath,
            integrationStrategy: 'content_pack_sidecar_enrichment',
            recommendedMaxAttempts: document.pack.recommendedMaxAttempts,
            publicationStatus: document.pack.publicationStatus,
            rightsStatus: document.pack.rightsStatus,
            experience: document.pack.experience ?? {},
            playSets: document.pack.playSets ?? [],
            uiCopy: document.pack.uiCopy,
          },
          updatedAt: new Date(),
        },
      })

      await tx.delete(contentPackEntries).where(eq(contentPackEntries.packId, document.pack.id))

      await tx.insert(contentPackEntries).values(importableItems.map((item, index) => {
        const resolution = resolvedByGameId.get(item.gameId)
        if (!resolution?.itemId) throw new Error(`No answer item binding for ${item.gameId}`)
        return {
          packId: document.pack.id,
          position: index + 1,
          answerItemId: resolution.itemId,
          promptPayload: {
            schemaVersion: 1,
            sourceOrder: item.order,
            prompt: document.pack.uiCopy.prompt,
            disclaimer: document.pack.uiCopy.disclaimer,
            recommendedMaxAttempts: document.pack.recommendedMaxAttempts,
            rightsStatus: document.pack.rightsStatus,
            progressiveHints: item.progressiveHints,
          },
        }
      }))
    })

    const finalResolutions = document.items.map((item) => {
      const entry = resolvedByGameId.get(item.gameId)!
      return {
        gameId: item.gameId,
        packItemId: item.id,
        status: entry.status,
        method: entry.method,
        itemId: entry.itemId,
        itemVersionId: entry.itemVersionId,
        matchedTitle: entry.matchedTitle,
        matchedYear: entry.matchedYear,
      }
    })
    await writeJson(reportPath, {
      ...baseReport,
      imported: true,
      status: publish ? 'published' : 'draft',
      counts: {
        requested: document.items.length,
        enrichedExisting: importableItems.length,
        skippedMissing: unresolved.length,
      },
      resolutions: finalResolutions,
    })
    console.log(JSON.stringify({
      imported: document.pack.id,
      status: publish ? 'published' : 'draft',
      entries: importableItems.length,
      skippedMissing: unresolved.length,
      reportPath,
    }))
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
