import { describe, expect, it } from 'vitest'
import {
  dtfCommentUnlockLabel,
  newestDtfCommentKey,
  type DtfCommentCardData,
} from './DtfCommentFeed'

const comment = (
  key: string,
  unlockAfterAttempts: number,
): DtfCommentCardData => ({
  key,
  text: key,
  unlockAfterAttempts,
  authorArchetype: '',
})

describe('DTF comment feed', () => {
  it('uses a natural unlock label', () => {
    expect(dtfCommentUnlockLabel(0)).toBe('Доступен сразу')
    expect(dtfCommentUnlockLabel(1)).toBe('После 1 попытки')
    expect(dtfCommentUnlockLabel(3)).toBe('После 3 попыток')
  })

  it('marks only the latest comment unlocked on the current attempt', () => {
    const comments = [comment('first', 0), comment('second', 0), comment('third', 2)]
    expect(newestDtfCommentKey(comments.slice(0, 2), 0)).toBe('second')
    expect(newestDtfCommentKey(comments, 2)).toBe('third')
    expect(newestDtfCommentKey(comments, 1)).toBeNull()
  })
})
