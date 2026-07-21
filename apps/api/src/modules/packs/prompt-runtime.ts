/**
 * Generic runtime adapter for comment-backed content packs.
 *
 * Suggested location:
 *   apps/api/src/modules/packs/prompt-runtime.ts
 *
 * It reads the sidecar prompt from content_pack_entries.prompt_payload and returns
 * the same progressiveHints/promoPrompt shape already consumed by ServerGame.
 */

import { and, eq } from 'drizzle-orm'
import {
  contentPackEntries,
  contentPacks,
  type Database,
} from '@shoditsa/database'

type ReadDatabase = Pick<Database, 'select'>

type PackSessionLike = {
  packId: string | null
  packPosition: number | null
  attemptsCount: number
}

type StoredProgressiveHint = {
  key?: unknown
  unlockAfterAttempts?: unknown
  type?: unknown
  text?: unknown
  spoilerRisk?: unknown
  sourceId?: unknown
  clueStrength?: unknown
  topics?: unknown
}

type StoredPrompt = {
  prompt?: unknown
  disclaimer?: unknown
  recommendedMaxAttempts?: unknown
  progressiveHints?: unknown
}

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)

const asInteger = (value: unknown, fallback: number) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

const cleanText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()

const clampAttempts = (value: unknown) => Math.min(10, Math.max(1, asInteger(value, 10)))

const normalizeHint = (value: unknown): StoredProgressiveHint | null => {
  const row = asRecord(value)
  if (!row) return null
  const key = cleanText(row.key)
  const text = cleanText(row.text)
  const unlockAfterAttempts = Math.max(0, asInteger(row.unlockAfterAttempts, 0))
  if (!key || !text) return null
  return {
    key,
    text,
    unlockAfterAttempts,
    type: cleanText(row.type) || 'pack_comment',
    spoilerRisk: cleanText(row.spoilerRisk) || 'low',
    sourceId: cleanText(row.sourceId) || null,
    clueStrength: asInteger(row.clueStrength, 0),
    topics: Array.isArray(row.topics)
      ? row.topics.map(cleanText).filter(Boolean)
      : [],
  }
}

export const loadPackSessionPrompt = async (
  db: ReadDatabase,
  session: PackSessionLike,
) => {
  if (!session.packId || !session.packPosition) return null

  const [entryRows, packRows] = await Promise.all([
    db.select({ promptPayload: contentPackEntries.promptPayload })
      .from(contentPackEntries)
      .where(and(
        eq(contentPackEntries.packId, session.packId),
        eq(contentPackEntries.position, session.packPosition),
        eq(contentPackEntries.enabled, true),
      ))
      .limit(1),
    db.select({
      id: contentPacks.id,
      title: contentPacks.title,
      subtitle: contentPacks.subtitle,
    })
      .from(contentPacks)
      .where(eq(contentPacks.id, session.packId))
      .limit(1),
  ])

  const rawPrompt = asRecord(entryRows[0]?.promptPayload) as StoredPrompt | null
  const pack = packRows[0]
  if (!rawPrompt || !pack) return null

  const allHints = Array.isArray(rawPrompt.progressiveHints)
    ? rawPrompt.progressiveHints
        .map(normalizeHint)
        .filter((hint): hint is NonNullable<typeof hint> => Boolean(hint))
        .sort((left, right) => (
          Number(left.unlockAfterAttempts) - Number(right.unlockAfterAttempts)
        ))
    : []

  const visibleHints = allHints.filter((hint) => (
    Number(hint.unlockAfterAttempts) <= session.attemptsCount
  ))

  const maxAttempts = clampAttempts(rawPrompt.recommendedMaxAttempts)

  return {
    maxAttempts,
    progressiveHints: visibleHints.map((hint) => ({
      key: String(hint.key),
      value: {
        unlockAfterAttempts: Number(hint.unlockAfterAttempts),
        type: String(hint.type),
        text: String(hint.text),
        spoilerRisk: String(hint.spoilerRisk),
        sourceId: hint.sourceId ? String(hint.sourceId) : null,
        clueStrength: Number(hint.clueStrength),
        topics: Array.isArray(hint.topics) ? hint.topics : [],
      },
    })),
    promoPrompt: {
      packId: pack.id,
      title: pack.title,
      subtitle: pack.subtitle ?? '',
      disclaimer: cleanText(rawPrompt.disclaimer)
        || 'Комментарии переведены и отредактированы для игрового режима.',
    },
  }
}
