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
  draftVersion: number | null
  updatedAt: string
}

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
