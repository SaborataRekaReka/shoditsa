/** Sequential, server-controlled experiment. Never change SEO as part of this rollout. */
export const GROWTH_STAGES = ['baseline', 'replay', 'registration', 'club'] as const
export type GrowthStage = typeof GROWTH_STAGES[number]
export const GROWTH_CAMPAIGN = 'diagnosis-continuation-v1'
export const GROWTH_NOT_BEFORE = '2026-09-12T00:00:00.000Z'
// First complete UTC day after the production instrumentation release.
export const GROWTH_MEASUREMENT_FROM = '2026-09-08T00:00:00.000Z'
export const REGISTRATION_BONUS_ROUNDS = 3
export type GrowthPolicy = {
  stage: GrowthStage
  changedAt: string | null
  registrationOpenedAt: string | null
}
export type GrowthFeatures = {
  stage: GrowthStage
  campaign: string
  replay: boolean
  registration: boolean
  club: boolean
}
export const growthFeatures = (policy: GrowthPolicy, now = new Date()): GrowthFeatures => {
  const stage = now.getTime() < Date.parse(GROWTH_NOT_BEFORE) ? 'baseline' : policy.stage
  const index = GROWTH_STAGES.indexOf(stage)
  return { stage, campaign: GROWTH_CAMPAIGN, replay: index >= 1, registration: index >= 2, club: index >= 3 }
}
export type GrowthReport = {
  policy: GrowthPolicy
  effective: GrowthFeatures
  notBefore: string
  nextStageAvailableAt: string
  period: { from: string; toExclusive: string; days: number }
  measurement: { from: string; coverage: 'not_started' | 'partial' | 'complete' }
  sessions: { completions: number; firstCompleters: number; measuredCompleters: number | null; repeatStarts: number | null; repeatCompletions: number | null; repeatingCompleters: number | null; bonusStarts: number; bonusCompletions: number; clubStarts: number | null }
  accounts: { created: number; signUps: number; bonusGranted: number; bonusPlayers: number }
  commerce: { orders: number; paidOrders: number; payingUsers: number; paidUsersUsedClub: number | null; revenueMinor: number }
  events: Array<{ eventName: string; stage: string; consent: string; events: number; users: number }>
}
