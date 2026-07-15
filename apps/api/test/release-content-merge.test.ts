import { describe, expect, it } from 'vitest'
import type { ContentMode, TitleItem } from '@shoditsa/contracts'
import { buildReleaseMergePlan, releaseMergeChecksum } from '../src/modules/admin/release-content-merge.js'
import type { LoadedReleaseLibrary } from '../src/modules/admin/release-content-loader.js'

const item = (id: string, mode: ContentMode, extra: Partial<TitleItem> = {}): TitleItem => ({
  id, mode, titleRu: id, titleOriginal: id, alternativeTitles: [], allowedInGame: true, ...extra,
}) as TitleItem
const library = (mode: ContentMode, items: TitleItem[]): LoadedReleaseLibrary => ({ mode, dir: mode, file: `${mode}/items.json`, checksum: mode, items })

describe('release content merge', () => {
  it('overlays matching cards, adds new cards and preserves active-only cards without deletions', () => {
    const active = [
      { id: 'v1', itemId: 'music-a', mode: 'music' as const, payload: item('music-a', 'music', { plotHint: 'DB hint' }), sortOrder: 0 },
      { id: 'v2', itemId: 'music-db-only', mode: 'music' as const, payload: item('music-db-only', 'music'), sortOrder: 1 },
      { id: 'v3', itemId: 'diagnosis-db-only', mode: 'diagnosis' as const, payload: item('diagnosis-db-only', 'diagnosis', { icd10: ['A00'] }), sortOrder: 0 },
      { id: 'v4', itemId: 'anime-a', mode: 'anime' as const, payload: item('anime-a', 'anime', { facts: ['Формат: TV сериал'] }), sortOrder: 0 },
    ]
    const release = [
      library('music', [item('music-a', 'music', { plotHint: 'Release hint' })]),
      library('anime', [item('anime-a', 'anime', { facts: [] })]),
      library('movie', [item('movie-new', 'movie')]),
    ]

    const plan = buildReleaseMergePlan(active, release)
    expect(plan.preview).toMatchObject({ activeItems: 4, releaseItems: 3, updated: 2, added: 1, preserved: 2, deleted: 0, finalItems: 5 })
    expect(plan.preview.modes.music).toMatchObject({ active: 2, release: 1, updated: 1, preserved: 1, final: 2 })
    expect(plan.preview.modes.diagnosis).toMatchObject({ active: 1, release: 0, preserved: 1, final: 1 })
    expect(plan.entries.find((entry) => entry.itemId === 'music-db-only')).toMatchObject({ source: 'active', activeVersionId: 'v2' })
    expect(plan.entries.find((entry) => entry.itemId === 'anime-a')?.payload.facts).toEqual([])
    expect(releaseMergeChecksum(plan.entries)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a release ID that changes content mode', () => {
    const active = [{ id: 'v1', itemId: 'same-id', mode: 'music' as const, payload: item('same-id', 'music'), sortOrder: 0 }]
    expect(() => buildReleaseMergePlan(active, [library('movie', [item('same-id', 'movie')])])).toThrow('Content mode mismatch')
  })

  it('treats JSON objects with different key order as unchanged', () => {
    const payload = item('same-card', 'movie')
    const reordered = { allowedInGame: true, alternativeTitles: [], titleOriginal: 'same-card', titleRu: 'same-card', mode: 'movie', id: 'same-card' }
    const plan = buildReleaseMergePlan([
      { id: 'v1', itemId: 'same-card', mode: 'movie', payload: reordered, sortOrder: 0 },
    ], [library('movie', [payload])])
    expect(plan.preview).toMatchObject({ updated: 0, unchanged: 1, added: 0, preserved: 0, deleted: 0, finalItems: 1 })
  })
})
