/**
 * Runtime adapter for comment-based prompts stored on canonical game cards.
 */

import { and, eq } from 'drizzle-orm'
import type { GameComment, TitleItem } from '@shoditsa/contracts'
import {
  contentItemVersions,
  contentPackEntries,
  contentPacks,
  type Database,
} from '@shoditsa/database'
import { DTF_COMMENTS_PACK_ID } from './policy.js'

type ReadDatabase = Pick<Database, 'select'>

type PackSessionLike = {
  packId: string | null
  packPosition: number | null
  answerItemVersionId: string | null
  attemptsCount: number
}

type StoredPrompt = {
  disclaimer?: unknown
  recommendedMaxAttempts?: unknown
  /** Transitional fallback for revisions imported before game.comments existed. */
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

export const normalizeGameComment = (value: unknown): GameComment | null => {
  const row = asRecord(value)
  if (!row) return null
  const key = cleanText(row.key)
  const text = cleanText(row.text)
  const unlockAfterAttempts = Math.max(0, asInteger(row.unlockAfterAttempts, 0))
  if (!key || !text) return null
  const spoilerRisk = cleanText(row.spoilerRisk)
  return {
    key,
    text,
    unlockAfterAttempts,
    type: cleanText(row.type) || 'player_comment',
    spoilerRisk: spoilerRisk === 'medium' || spoilerRisk === 'high' ? spoilerRisk : 'low',
    sourceId: cleanText(row.sourceId) || null,
    sourcePackId: cleanText(row.sourcePackId) || null,
    clueStrength: asInteger(row.clueStrength, 0),
    topics: Array.isArray(row.topics)
      ? row.topics.map(cleanText).filter(Boolean)
      : [],
    authorArchetype: cleanText(row.authorArchetype) || null,
  }
}

type DtfCommentPromptInput = {
  packId: string
  attemptsCount: number
  promptPayload: unknown
  pack: { id: string; title: string; subtitle: string | null }
  answer: Pick<TitleItem, 'comments'> | null
}

export const buildDtfCommentPrompt = ({
  packId,
  attemptsCount,
  promptPayload,
  pack,
  answer,
}: DtfCommentPromptInput) => {
  if (packId !== DTF_COMMENTS_PACK_ID) return null
  const rawPrompt = asRecord(promptPayload) as StoredPrompt | null
  if (!rawPrompt) return null

  // Canonical game data is authoritative. The fallback only keeps a previous
  // active revision playable during a rolling deployment.
  const canonicalComments = Array.isArray(answer?.comments)
    ? answer.comments.filter((comment) => !comment.sourcePackId || comment.sourcePackId === packId)
    : []
  const sourceComments = canonicalComments.length
    ? canonicalComments
    : Array.isArray(rawPrompt.progressiveHints)
      ? rawPrompt.progressiveHints
      : []
  const allHints = sourceComments
    .map(normalizeGameComment)
    .filter((hint): hint is GameComment => Boolean(hint))
    .sort((left, right) => left.unlockAfterAttempts - right.unlockAfterAttempts)

  if (!allHints.length) return null
  const visibleHints = allHints.filter((hint) => hint.unlockAfterAttempts <= attemptsCount)
  const maxAttempts = clampAttempts(rawPrompt.recommendedMaxAttempts)

  return {
    maxAttempts,
    progressiveHints: visibleHints.map((hint) => ({
      key: hint.key,
      value: {
        unlockAfterAttempts: hint.unlockAfterAttempts,
        type: hint.type ?? 'player_comment',
        text: hint.text,
        spoilerRisk: hint.spoilerRisk ?? 'low',
        sourceId: hint.sourceId ?? null,
        clueStrength: hint.clueStrength ?? 0,
        topics: hint.topics ?? [],
        authorArchetype: hint.authorArchetype ?? null,
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

export const loadPackSessionPrompt = async (
  db: ReadDatabase,
  session: PackSessionLike,
) => {
  if (
    session.packId !== DTF_COMMENTS_PACK_ID
    || !session.packPosition
    || !session.answerItemVersionId
  ) return null

  const [entryRows, packRows, answerRows] = await Promise.all([
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
    db.select({ payload: contentItemVersions.payload })
      .from(contentItemVersions)
      .where(eq(contentItemVersions.id, session.answerItemVersionId))
      .limit(1),
  ])

  const pack = packRows[0]
  if (!entryRows[0] || !pack || !answerRows[0]) return null
  return buildDtfCommentPrompt({
    packId: session.packId,
    attemptsCount: session.attemptsCount,
    promptPayload: entryRows[0].promptPayload,
    pack,
    answer: answerRows[0].payload as TitleItem,
  })
}
