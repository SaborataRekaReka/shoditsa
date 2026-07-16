import type { TitleItem } from '@shoditsa/contracts'

export type BackfillMusicTier = 'core' | 'popular' | 'niche'

export const MUSIC_TIER_BACKFILL_VERSION = 'popularity-percentile-v1'
export const MUSIC_TIER_THRESHOLDS = Object.freeze({ core: 0.36, popular: 0.91 })

const tierMeta: Record<BackfillMusicTier, { gameDifficulty: 'easy' | 'medium' | 'hard'; gameWeight: number }> = {
  core: { gameDifficulty: 'easy', gameWeight: 1 },
  popular: { gameDifficulty: 'medium', gameWeight: 0.8 },
  niche: { gameDifficulty: 'hard', gameWeight: 0.4 },
}

export const musicTierForPercentile = (percentile: number): BackfillMusicTier => {
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) throw new Error(`Invalid music popularity percentile: ${percentile}`)
  if (percentile <= MUSIC_TIER_THRESHOLDS.core) return 'core'
  if (percentile <= MUSIC_TIER_THRESHOLDS.popular) return 'popular'
  return 'niche'
}

export type MusicTierBackfillInput = {
  itemId: string
  popularityScore: number
  payload: TitleItem
}

export type MusicTierBackfillProposal = MusicTierBackfillInput & {
  percentile: number
  tier: BackfillMusicTier
  afterPayload: TitleItem
}

export const proposeMusicTierBackfill = (items: MusicTierBackfillInput[]): MusicTierBackfillProposal[] => {
  const eligible = items
    .filter((item) => item.payload.allowedInGame === true)
    .sort((left, right) => right.popularityScore - left.popularityScore || left.itemId.localeCompare(right.itemId, 'en-US'))

  const total = eligible.length
  if (!total) return []

  return eligible.flatMap((item, index) => {
    if (String(item.payload.gameTier ?? '').trim()) return []
    const percentile = (index + 1) / total
    const tier = musicTierForPercentile(percentile)
    const meta = tierMeta[tier]
    return [{
      ...item,
      percentile,
      tier,
      afterPayload: {
        ...item.payload,
        gameTier: tier,
        gameDifficulty: meta.gameDifficulty,
        gameWeight: meta.gameWeight,
        contentStatus: 'ready',
      },
    }]
  })
}

export const summarizeMusicTierProposals = (proposals: MusicTierBackfillProposal[]) => ({
  total: proposals.length,
  tiers: {
    core: proposals.filter((proposal) => proposal.tier === 'core').length,
    popular: proposals.filter((proposal) => proposal.tier === 'popular').length,
    niche: proposals.filter((proposal) => proposal.tier === 'niche').length,
  },
})
