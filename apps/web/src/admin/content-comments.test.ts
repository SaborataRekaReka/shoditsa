import { describe, expect, it } from 'vitest'
import { adminCommentUnlockLabel, adminContentComments } from './content-comments'

describe('admin content comments', () => {
  it('keeps every game comment and its verifiable source', () => {
    const comments = adminContentComments({
      comments: [
        {
          key: 'dtf-1',
          text: '  Первый   комментарий  ',
          unlockAfterAttempts: 0,
          sourceId: '1',
          sourceUrl: 'https://dtf.ru/games/1-post?comment=1',
          sourcePostUrl: 'https://dtf.ru/games/1-post',
          sourceVerifiedAt: '2026-07-23',
          clueStrength: 1,
          topics: ['mechanics', 'mechanics'],
        },
        {
          key: 'legacy-2',
          text: 'Второй комментарий',
          unlockAfterAttempts: 3,
          sourcePackId: 'dtf-game-comments-25-v1',
        },
      ],
    }, 'game')

    expect(comments).toHaveLength(2)
    expect(comments[0]).toMatchObject({
      text: 'Первый комментарий',
      sourceId: '1',
      sourceUrl: 'https://dtf.ru/games/1-post?comment=1',
      topics: ['mechanics'],
    })
    expect(comments[1]).toMatchObject({
      text: 'Второй комментарий',
      sourceUrl: null,
      sourcePackId: 'dtf-game-comments-25-v1',
    })
    expect(adminCommentUnlockLabel(comments[1].unlockAfterAttempts)).toBe('После 3 попыток')
  })

  it('does not expose unsafe source protocols or comments on other modes', () => {
    expect(adminContentComments({
      comments: [{ text: 'Комментарий', sourceUrl: 'javascript:alert(1)' }],
    }, 'game')[0]?.sourceUrl).toBeNull()
    expect(adminContentComments({ comments: [{ text: 'Комментарий' }] }, 'movie')).toEqual([])
  })
})
