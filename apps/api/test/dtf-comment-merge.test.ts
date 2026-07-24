import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TitleItem } from '@shoditsa/contracts'
import {
  mergeDtfComments,
  removeUnverifiedPlayerComments,
  resolveDtfPack,
  resolveDtfPackItem,
  type DtfCatalogGame,
  type DtfPackDocument,
  type DtfPackItem,
} from '../src/modules/packs/dtf-comment-merge.js'

const packItem = {
  id: 'dtf-example',
  gameId: 'example',
  order: 1,
  answerRef: {
    mode: 'game',
    titleRu: 'Пример',
    titleOriginal: 'Example',
    year: 2024,
    legacyReleaseYears: [],
    steamAppIds: [42],
    aliases: [],
    resolutionOrder: [],
  },
  progressiveHints: [],
} satisfies DtfPackItem

const catalogGame = (itemId: string, extra: Partial<TitleItem> = {}): DtfCatalogGame => ({
  itemId,
  itemVersionId: `${itemId}:version`,
  allowedInGame: true,
  contentStatus: null,
  popularityScore: 1,
  payload: {
    id: itemId,
    mode: 'game',
    titleRu: 'Пример',
    titleOriginal: 'Example',
    alternativeTitles: [],
    popularityScore: 1,
    year: 2024,
    steamAppId: 42,
    ...extra,
  },
})

describe('DTF comment merge', () => {
  it('prefers a canonical card over a promo duplicate', () => {
    const resolution = resolveDtfPackItem(packItem, [
      catalogGame('promo:dtf-example', { contentStatus: 'promo_pack' as never }),
      catalogGame('game:example'),
    ])

    expect(resolution.catalog?.itemId).toBe('game:example')
    expect(resolution.method).toBe('steamAppId')
  })

  it('replaces only comments from the same pack', () => {
    const payload = catalogGame('game:example').payload
    payload.comments = [{
      key: 'other-comment',
      text: 'Другая подборка',
      unlockAfterAttempts: 0,
      sourcePackId: 'other-pack',
    }, {
      key: 'old-dtf-comment',
      text: 'Старая версия',
      unlockAfterAttempts: 0,
      sourcePackId: 'dtf-pack',
    }]

    const merged = mergeDtfComments(payload, [{
      key: 'new-dtf-comment',
      text: '  Новая   версия  ',
      unlockAfterAttempts: 2,
      sourceId: '123',
      sourceUrl: 'https://dtf.ru/games/1-post?comment=123',
    }], 'dtf-pack')

    expect(merged.comments).toEqual([
      expect.objectContaining({ key: 'other-comment', sourcePackId: 'other-pack' }),
      expect.objectContaining({
        key: 'new-dtf-comment',
        text: 'Новая версия',
        sourcePackId: 'dtf-pack',
      }),
    ])
    expect(merged.comments?.[1]).toHaveProperty('sourceUrl')
    expect(merged.comments?.[1]).not.toHaveProperty('wasRedacted')
  })

  it('removes player comments that cannot be confirmed from a public source', () => {
    const payload = catalogGame('game:example').payload
    payload.comments = [{
      key: 'unverified',
      text: 'Нет источника',
      unlockAfterAttempts: 0,
      type: 'player_comment',
    }, {
      key: 'verified',
      text: 'Есть источник',
      unlockAfterAttempts: 0,
      type: 'player_comment',
      sourceId: '123',
      sourceUrl: 'https://dtf.ru/games/1-post?comment=123',
    }]

    expect(removeUnverifiedPlayerComments(payload).comments?.map((comment) => comment.key))
      .toEqual(['verified'])
  })

  it('preserves provenance when a sourced comment provides it', () => {
    const payload = catalogGame('game:example').payload
    const merged = mergeDtfComments(payload, [{
      key: 'sourced-comment',
      text: 'Комментарий с источником',
      unlockAfterAttempts: 0,
      sourceId: '123',
      sourceUrl: 'https://dtf.ru/games/1-post?comment=123',
      sourcePostUrl: 'https://dtf.ru/games/1-post',
      sourceExcerpt: '  Исходный   комментарий  ',
      sourceVerifiedAt: '2026-07-23',
      contentHash: 'sha256:abc',
      wasRedacted: true,
      redactionReasons: ['direct_answer', 'direct_answer'],
      authorId: '42',
      authorName: 'Игрок',
      authorAvatarUrl: 'https://leonardo.osnova.io/avatar/-/scale_crop/96x96/',
      authorProfileUrl: 'https://dtf.ru/id42',
      authorIsVerified: true,
      publishedAt: '2023-09-04T04:43:11.000Z',
      likesCount: 80,
      dislikesCount: 2,
      replyCount: 3,
      reactionCounts: { '1': 80 },
    }], 'dtf-pack')

    expect(merged.comments?.[0]).toMatchObject({
      sourceId: '123',
      sourceUrl: 'https://dtf.ru/games/1-post?comment=123',
      sourcePostUrl: 'https://dtf.ru/games/1-post',
      sourceExcerpt: 'Исходный комментарий',
      sourceVerifiedAt: '2026-07-23',
      contentHash: 'sha256:abc',
      wasRedacted: true,
      redactionReasons: ['direct_answer'],
      authorId: '42',
      authorName: 'Игрок',
      authorIsVerified: true,
      likesCount: 80,
      dislikesCount: 2,
      replyCount: 3,
      reactionCounts: { '1': 80 },
    })
  })

  it('resolves the complete checked-in pack into the main library', () => {
    const document = JSON.parse(readFileSync(
      new URL('../../../data/promo/dtf-game-comments-25-v1.json', import.meta.url),
      'utf8',
    )) as DtfPackDocument
    const library = JSON.parse(readFileSync(
      new URL('../../../public/data/libraries/games/items.json', import.meta.url),
      'utf8',
    )) as TitleItem[]
    const games = library.map((payload) => ({
      itemId: payload.id,
      allowedInGame: payload.allowedInGame !== false,
      contentStatus: payload.contentStatus ?? null,
      popularityScore: payload.popularityScore,
      payload,
    }))
    const resolutions = resolveDtfPack(document, games)

    expect(resolutions).toHaveLength(20)
    expect(resolutions.every((resolution) => resolution.status === 'resolved')).toBe(true)
    expect(new Set(resolutions.map((resolution) => resolution.catalog?.itemId)).size).toBe(20)
    expect(document.items.reduce((total, item) => total + item.progressiveHints.length, 0)).toBe(120)
    expect(document.items.every((item) => item.progressiveHints.every((comment) => (
      Boolean(comment.sourceId && comment.sourceUrl && comment.sourceVerifiedAt && comment.authorName)
    )))).toBe(true)
  })
})
