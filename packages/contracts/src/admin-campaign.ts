export type AdminCampaignPeriod = 7 | 14 | 31

export type AdminCampaignFunnelCounts = {
  acquisitions: number
  started: number
  completed: number
  repeatCompleted: number
  registered: number
  registeredAfterCompletion: number
  paidClub: number
  paidClubOrders: number
  matured24h: number
  matured7d: number
}

export type AdminCampaignFunnelRow = AdminCampaignFunnelCounts & {
  source: string
  medium: 'paid_social' | 'referral'
  campaign: string
  landing: '/games/diagnosis'
}

export type AdminCampaignFunnelResponse = {
  generatedAt: string
  days: AdminCampaignPeriod
  window: { fromInclusive: string; toExclusive: string; timezone: 'UTC' }
  status: 'observed' | 'no_observations' | 'partial'
  summary: AdminCampaignFunnelCounts
  items: AdminCampaignFunnelRow[]
  coverage: {
    rawFromInclusive: string
    rawRetentionDays: number
    firstObservedAt: string | null
    campaignEvents: number
    sessionLinks: number
    matchedSessionLinks: number
    unmatchedSessionLinks: number
    conflictingAcquisitions: number
    truncated: boolean
    wholeSiteConsentCoverage: null
    retentionD2To7: null
  }
  methodology: string[]
}
