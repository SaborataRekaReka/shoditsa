import { describe, expect, it } from 'vitest'
import type { TitleItem } from '@shoditsa/contracts'
import { musicTierForPercentile, proposeMusicTierBackfill, summarizeMusicTierProposals } from '../src/modules/admin/music-tier-backfill.js'

const item = (index: number, gameTier?: TitleItem['gameTier']): { itemId: string; popularityScore: number; payload: TitleItem } => ({
  itemId: `music:${String(index).padStart(3, '0')}`,
  popularityScore: 101 - index,
  payload: {
    id: `music:${String(index).padStart(3, '0')}`,
    mode: 'music',
    titleRu: `Артист ${index}`,
    titleOriginal: `Artist ${index}`,
    alternativeTitles: [],
    popularityScore: 101 - index,
    allowedInGame: true,
    ...(gameTier ? { gameTier } : {}),
  },
})

describe('music tier backfill', () => {
  it('uses the established 36/55/9 distribution', () => {
    const proposals = proposeMusicTierBackfill(Array.from({ length: 100 }, (_, index) => item(index + 1)))
    expect(summarizeMusicTierProposals(proposals)).toEqual({ total: 100, tiers: { core: 36, popular: 55, niche: 9 } })
  })

  it('ranks against the full eligible pool and preserves existing tiers', () => {
    const proposals = proposeMusicTierBackfill([item(1, 'core'), item(2), item(3)])
    expect(proposals).toHaveLength(2)
    expect(proposals.map((proposal) => proposal.percentile)).toEqual([2 / 3, 1])
    expect(proposals.map((proposal) => proposal.tier)).toEqual(['popular', 'niche'])
    expect(proposals[0].afterPayload).toMatchObject({ gameTier: 'popular', gameDifficulty: 'medium', gameWeight: 0.8, contentStatus: 'ready' })
  })

  it('rejects invalid percentiles', () => {
    expect(() => musicTierForPercentile(0)).toThrow('Invalid music popularity percentile')
    expect(() => musicTierForPercentile(1.01)).toThrow('Invalid music popularity percentile')
  })
})
