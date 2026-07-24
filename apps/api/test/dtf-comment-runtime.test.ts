import { describe, expect, it } from 'vitest'
import type { TitleItem } from '@shoditsa/contracts'
import { validateContentPayload } from '../src/modules/admin/content-service.js'
import { publicCard } from '../src/modules/games/service.js'
import { buildDtfCommentPrompt } from '../src/modules/packs/prompt-runtime.js'
import { DTF_COMMENTS_PACK_ID } from '../src/modules/packs/policy.js'

const answer = {
  id: 'game:example',
  mode: 'game',
  titleRu: 'Пример',
  titleOriginal: 'Example',
  alternativeTitles: [],
  popularityScore: 1,
  comments: [
    {
      key: 'start',
      text: 'Стартовый комментарий',
      unlockAfterAttempts: 0,
      sourcePackId: DTF_COMMENTS_PACK_ID,
      sourceId: '123',
      sourceUrl: 'https://dtf.ru/games/1-post?comment=123',
      authorId: '42',
      authorName: 'Игрок DTF',
      authorAvatarUrl: 'https://leonardo.osnova.io/avatar/-/scale_crop/96x96/',
      authorProfileUrl: 'https://dtf.ru/id42',
      publishedAt: '2023-09-04T04:43:11.000Z',
      likesCount: 80,
      replyCount: 3,
    },
    {
      key: 'rescue',
      text: 'Поздний комментарий',
      unlockAfterAttempts: 5,
      sourcePackId: DTF_COMMENTS_PACK_ID,
    },
    {
      key: 'other',
      text: 'Комментарий другого пака',
      unlockAfterAttempts: 0,
      sourcePackId: 'other-pack',
    },
  ],
} satisfies TitleItem

const input = (attemptsCount: number) => ({
  packId: DTF_COMMENTS_PACK_ID,
  attemptsCount,
  promptPayload: {
    recommendedMaxAttempts: 6,
    disclaimer: 'Редакционный комментарий',
    progressiveHints: [{
      key: 'legacy',
      text: 'Не должен победить данные карточки',
      unlockAfterAttempts: 0,
    }],
  },
  pack: {
    id: DTF_COMMENTS_PACK_ID,
    title: 'Что за игра?',
    subtitle: 'DTF',
  },
  answer,
})

describe('DTF comment runtime', () => {
  it('uses canonical comments progressively and only for the DTF pack', () => {
    expect(buildDtfCommentPrompt(input(0))?.progressiveHints.map((hint) => hint.key))
      .toEqual(['start'])
    expect(buildDtfCommentPrompt(input(5))?.progressiveHints.map((hint) => hint.key))
      .toEqual(['start', 'rescue'])
    expect(buildDtfCommentPrompt({ ...input(5), packId: 'regular-pack' })).toBeNull()
  })

  it('exposes public author and reaction metadata without direct DTF links', () => {
    expect(buildDtfCommentPrompt(input(0))?.progressiveHints[0]?.value).toMatchObject({
      authorId: '42',
      authorName: 'Игрок DTF',
      likesCount: 80,
      replyCount: 3,
    })
    expect(buildDtfCommentPrompt(input(0))?.progressiveHints[0]?.value).not.toHaveProperty('authorProfileUrl')
    expect(buildDtfCommentPrompt(input(0))?.progressiveHints[0]?.value).not.toHaveProperty('sourceUrl')
  })

  it('never exposes the private comment array through ordinary game cards', () => {
    const card = publicCard(answer)
    expect(card).not.toHaveProperty('comments')
    expect(card.titleRu).toBe('Пример')
  })

  it('validates comments only on game cards', () => {
    expect(validateContentPayload(answer as unknown as Record<string, unknown>, 'game'))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ field: 'comments' })]))
    expect(validateContentPayload({
      ...answer,
      mode: 'movie',
    } as unknown as Record<string, unknown>, 'movie'))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        field: 'comments',
        code: 'game_only',
      })]))
  })
})
