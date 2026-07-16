import { describe, expect, it } from 'vitest'
import { apiBackfillFields, buildMissingFieldsProposal } from '../src/modules/admin/pipeline-backfill.js'

describe('API metadata backfill', () => {
  it('allows only explicit safe fields for each pipeline', () => {
    expect(apiBackfillFields('anime', { purpose: 'api_metadata_backfill', patchFields: ['cast', 'genres', 'plotHint', 'allowedInGame'] }))
      .toEqual(['cast', 'genres'])
    expect(apiBackfillFields('movie', { purpose: 'api_metadata_backfill', patchFields: ['directors', 'posterUrl', 'topRank'] }))
      .toEqual(['directors'])
  })

  it('does not enable patch mode for ordinary runs', () => {
    expect(apiBackfillFields('anime', { patchFields: ['cast'] })).toEqual([])
  })

  it('fills only missing values and preserves the rest of the card byte-for-byte', () => {
    const before = {
      id: 'shiki_1', cast: [], genres: ['Драма'], plotHint: 'Проверенная игровая подсказка.',
      posterUrl: '/media/anime.webp', allowedInGame: true, contentStatus: 'ready', topRank: 44,
    }
    const source = {
      cast: [{ nameRu: 'Актёр' }], genres: ['Экшен'], plotHint: 'Новая подсказка из API',
      posterUrl: 'https://remote/image.jpg', allowedInGame: false, contentStatus: 'review', topRank: 1,
    }
    const result = buildMissingFieldsProposal(before, source, ['cast', 'genres'])
    expect(result.changedFields).toEqual(['cast'])
    expect(result.proposed).toEqual({ ...before, cast: [{ nameRu: 'Актёр' }] })
  })

  it('does not create a proposal when the API also has no value', () => {
    expect(buildMissingFieldsProposal({ directors: [] }, { directors: [] }, ['directors']))
      .toEqual({ proposed: { directors: [] }, changedFields: [] })
  })
})
