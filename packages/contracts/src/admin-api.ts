import type { ContentMode } from './schemas.js'

export type AdminWorkspaceSummary = {
  id: string
  title: string
  status: 'open' | 'building' | 'ready' | 'published' | 'failed' | 'abandoned'
  baseRevisionId: string
  builtRevisionId: string | null
  version: number
  changesCount: number
  errorsCount: number
  warningsCount: number
  updatedAt: string
}

export type AdminContentListItem = {
  id: string
  versionId: string
  mode: ContentMode
  titleRu: string
  titleOriginal: string
  year: number | null
  posterUrl: string | null
  allowedInGame: boolean
  completeness: number
  reportsCount: number
  issuesCount: number
  fieldsFilled: number
  fieldsTotal: number
  missingFields: string[]
  hasHint: boolean
  source: 'manual' | 'ai_pipeline' | 'bulk' | 'import' | 'rollback' | 'report_fix' | null
  pipelineKey: 'music' | 'movie' | 'anime' | 'normalization' | 'factcheck' | null
  draftVersion: number | null
  updatedAt: string
  tags: AdminContentTag[]
}

export type AdminContentTag = { id: string; name: string; slug: string; color: string; itemsCount?: number }

export type AdminContentItemsResponse = {
  items: AdminContentListItem[]
  nextCursor: string | null
  total: number
  filters: Record<string, unknown>
}

export type AdminDashboardResponse = {
  activeRevision: { id: string; version: string; createdAt: string; counts: Array<{ mode: ContentMode; count: number }> } | null
  workspace: AdminWorkspaceSummary | null
  counters: {
    newReports: number
    criticalIssues: number
    activeJobs: number
    stuckJobs: number
    pipelineReview: number
    activeUsers24h: number
    activeUsers7d: number
    sessionsStarted24h: number
    sessionsCompleted24h: number
  }
  recentReports: Array<Record<string, unknown>>
  recentChanges: Array<Record<string, unknown>>
  recentRuns: Array<Record<string, unknown>>
}

export type AdminAcquisitionFunnelPeriod = 7 | 14 | 31

export type AdminAcquisitionFunnelBreakdown = {
  key: string
  label: string
  searchEngine?: string
  organicLandings: number
  organicUsers: number | null
  starts: number
  completions: number
  nextClicks: number
  nextStarts: number
  signUps: number
  landingToStartRate: number | null
  startToCompleteRate: number | null
  landingToSignUpRate: number | null
}

export type AdminAcquisitionActivityBreakdown = {
  key: string
  label: string
  sessionStarts: number
  sessionCompletions: number
  nextClicks: number
  nextStarts: number
}

export type AdminAcquisitionFunnelResponse = {
  periodDays: AdminAcquisitionFunnelPeriod
  generatedAt: string
  window: { from: string; to: string }
  attributionWindowDays: 7
  summary: {
    organicLandings: number
    organicUsers: number | null
    starts: number
    completions: number
    nextClicks: number
    nextStarts: number
    signUps: number
    landingToStartRate: number | null
    startToCompleteRate: number | null
    completeToNextStartRate: number | null
    landingToSignUpRate: number | null
    activity: {
      sessionStarts: number
      sessionCompletions: number
      nextClicks: number
      nextStarts: number
    }
  }
  coverage: {
    lifecycleEvents: number
    lifecycleEventsWithAcquisition: number
    lifecycleEventRate: number | null
    pageViews: number
    pageViewsWithSource: number
    pageViewsWithAcquisition: number
    successfulSignUps: number
    signUpsAttributedToOrganic: number
    signUpAttributionRate: number | null
    unkeyedOrganicEvents: number
    clientEventRetentionDays: 38
    retentionTruncationPossible: boolean
    limitations: string[]
  }
  dataSources: {
    strategy: 'raw' | 'raw_with_daily_archive'
    windowKind: 'completed_utc_days'
    eventTotalsExact: boolean
    acquisitionTotalsExact: boolean
    uniqueUsersExact: boolean
    raw: {
      from: string
      to: string
      retentionDays: 38
      exactWindowReady: boolean
      retentionStartedAt: string | null
      retentionReadyAt: string | null
    }
    daily: null | {
      from: string
      to: string
      expectedCompleteDays: number
      confirmedCompleteDays: number
      privacyPreserving: true
      role: 'activity_archive'
      complete: boolean
    }
  }
  byLanding: AdminAcquisitionFunnelBreakdown[]
  byMode: AdminAcquisitionFunnelBreakdown[]
  activityByMode: AdminAcquisitionActivityBreakdown[]
  dailyActivityArchive: null | {
    from: string
    to: string
    complete: boolean
    sessionStarts: number
    sessionCompletions: number
    nextClicks: number
    nextStarts: number
    byDestinationMode: AdminAcquisitionActivityBreakdown[]
  }
}

export type AdminUserListItem = {
  id: string
  email: string
  name: string
  displayName: string | null
  isAnonymous: boolean
  accountStatus: 'active' | 'blocked'
  role: 'player' | 'admin'
  createdAt: string
  lastActivityAt: string | null
  sessionsCount: number
  completedCount: number
  reportsCount: number
  balance: number
}

export type AdminTimelineEvent = {
  id: string
  type: string
  occurredAt: string
  userId: string
  authSessionId: string | null
  gameSessionId: string | null
  itemId: string | null
  itemVersionId: string | null
  mode: ContentMode | null
  title: string
  summary: string
  details: Record<string, unknown>
  requestId: string | null
  sourceTable: string
}
