import { describe, expect, it } from 'vitest'
import {
  dtfCommentDateLabel,
  dtfCommentDisplayText,
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
  authorName: '',
  authorAvatarUrl: '',
  authorIsVerified: false,
  authorIsPlus: false,
  publishedAt: '',
  likesCount: null,
  dislikesCount: null,
  replyCount: null,
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

  it('formats the public DTF publication date', () => {
    expect(dtfCommentDateLabel('2023-09-04T04:43:11.000Z')).toContain('2023')
    expect(dtfCommentDateLabel('not-a-date')).toBe('')
  })

  it('naturally rewrites placeholders left in an already-running session', () => {
    expect(dtfCommentDisplayText('База. [название игры] не имеет ничего общего'))
      .toBe('База. Эта игра не имеет ничего общего')
    expect(dtfCommentDisplayText('Новости про [Название игры] всё смешнее'))
      .toBe('Новости про эту игру всё смешнее')
    expect(dtfCommentDisplayText('[название игры] 2 сегодня анонсируют'))
      .toBe('Продолжение этой игры сегодня анонсируют')
  })
})
