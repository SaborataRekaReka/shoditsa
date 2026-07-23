import type { ContentMode } from '@shoditsa/contracts'

export type AdminContentComment = {
  key: string
  text: string
  unlockAfterAttempts: number
  clueStrength: number | null
  sourceId: string | null
  sourcePackId: string | null
  sourceUrl: string | null
  sourcePostUrl: string | null
  sourceExcerpt: string | null
  sourceVerifiedAt: string | null
  contentHash: string | null
  topics: string[]
  wasRedacted: boolean
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const text = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

const sourceUrl = (value: unknown) => {
  const candidate = text(value)
  if (!candidate) return null
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

const integer = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback
}

export const adminContentComments = (
  payload: Record<string, unknown>,
  mode: ContentMode,
): AdminContentComment[] => {
  if (mode !== 'game' || !Array.isArray(payload.comments)) return []
  return payload.comments.flatMap((raw, index) => {
    const comment = record(raw)
    const displayText = text(comment.text ?? comment.displayText)
    if (!displayText) return []
    const verifiedSourceUrl = sourceUrl(comment.sourceUrl)
    const postUrl = sourceUrl(comment.sourcePostUrl)
    const topics = Array.isArray(comment.topics)
      ? [...new Set(comment.topics.map(text).filter(Boolean))]
      : []
    const clueStrength = Number.isFinite(Number(comment.clueStrength))
      ? integer(comment.clueStrength)
      : null
    return [{
      key: text(comment.key ?? comment.id) || `comment-${index + 1}`,
      text: displayText,
      unlockAfterAttempts: integer(comment.unlockAfterAttempts),
      clueStrength,
      sourceId: text(comment.sourceId ?? comment.sourceCommentId) || null,
      sourcePackId: text(comment.sourcePackId) || null,
      sourceUrl: verifiedSourceUrl ?? postUrl,
      sourcePostUrl: postUrl,
      sourceExcerpt: text(comment.sourceExcerpt) || null,
      sourceVerifiedAt: text(comment.sourceVerifiedAt) || null,
      contentHash: text(comment.contentHash) || null,
      topics,
      wasRedacted: Boolean(comment.wasRedacted),
    }]
  })
}

export const adminCommentUnlockLabel = (attempts: number) =>
  attempts > 0 ? `После ${attempts} попыток` : 'Стартовый комментарий'
