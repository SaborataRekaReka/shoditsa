import type {
  AdminContentItemsResponse, AdminContentTag, AdminDashboardResponse, AdminTimelineEvent, AdminUserListItem, AdminWorkspaceSummary,
  ContentMode, MeResponse,
} from '@shoditsa/contracts'

const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export class AdminApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) { super(message) }
}

export const idempotencyKey = () => crypto.randomUUID()

const fileBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error ?? new Error('File read failed'))
  reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
  reader.readAsDataURL(file)
})

const request = async <T>(path: string, init: RequestInit & { timeoutMs?: number } = {}) => {
  const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init, credentials: 'include', signal: controller.signal,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
    const payload = response.status === 204 ? null : await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok) {
      const envelope = payload?.error && typeof payload.error === 'object' ? payload.error as Record<string, unknown> : payload
      const details = { ...((envelope?.details as Record<string, unknown>) ?? {}) }
      const retryAfter = Number(response.headers.get('retry-after'))
      if (response.status === 429 && details.retryAfterMs === undefined && Number.isFinite(retryAfter)) details.retryAfterMs = retryAfter * 1_000
      throw new AdminApiError(response.status, String(envelope?.code ?? 'HTTP_ERROR'), String(envelope?.message ?? 'Не удалось выполнить запрос'), details)
    }
    return payload as T
  } catch (error) {
    if (error instanceof AdminApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw new AdminApiError(408, 'TIMEOUT', 'Сервер отвечает слишком долго')
    throw new AdminApiError(0, 'NETWORK_ERROR', 'Нет связи с сервером')
  } finally { window.clearTimeout(timeout) }
}

const json = (value: unknown) => JSON.stringify(value)
const query = (value: Record<string, unknown>) => {
  const params = new URLSearchParams()
  for (const [key, entry] of Object.entries(value)) if (entry !== undefined && entry !== null && entry !== '') params.set(key, String(entry))
  return params.toString() ? `?${params}` : ''
}

export type AdminItemDetail = {
  active: { id: string; itemId: string; mode: ContentMode; payload: Record<string, unknown>; createdAt: string; revisionId: string } | null
  draft: { id: string; itemId: string; mode: ContentMode; afterPayload: Record<string, unknown>; beforePayload: Record<string, unknown> | null; changedFields: string[]; version: number; source: string; validationIssues: unknown[] } | null
  workspace: AdminWorkspaceSummary
  schema: { mode: ContentMode; groups: Array<{ key: string; title: string; fields: string[] }> }
  reports: Array<Record<string, unknown>>
  issues: Array<Record<string, unknown>>
  decisions: Array<Record<string, unknown>>
  tags: AdminContentTag[]
}

export type ReportListResponse = { items: Array<{ report: Record<string, unknown>; userEmail: string; titleRu: string; sessionStatus: string }>; nextCursor: string | null }
export type UserListResponse = { items: AdminUserListItem[]; nextCursor: string | null }
export type ContentExchangeSelection = {
  requested: number
  found: number
  missingItemIds: string[]
  modes: Record<ContentMode, number>
  fields: Array<{ field: string; count: number; modes: ContentMode[] }>
}
export type ContentExchangePreview = {
  format: string
  schemaVersion: number
  exportId: string
  documentHash: string
  previewHash: string
  fields: string[]
  summary: { total: number; create: number; update: number; unchanged: number; conflict: number; invalid: number }
  items: Array<{ id: string; mode: ContentMode; status: 'create' | 'update' | 'unchanged' | 'conflict' | 'invalid'; title: string; changedFields: string[]; conflicts: string[]; issues: Array<Record<string, unknown>>; message: string | null }>
}

export type ReleaseContentStatus = {
  state: 'active' | 'ready' | 'building' | 'failed' | 'update_available'
  updateAvailable: boolean
  release: {
    source: 'release_catalog'
    gitSha: string
    generatedAt: string
    checksumSha256: string
    totalItems: number
    modes: Record<string, { count: number; checksumSha256: string }>
    warnings: string[]
  }
  activeRevision: Record<string, unknown> | null
  matchingRevision: Record<string, unknown> | null
}

export const adminApi = {
  me: () => request<MeResponse>('/me'),
  dashboard: () => request<AdminDashboardResponse>('/admin/dashboard'),
  contentItems: (filters: Record<string, unknown>) => request<AdminContentItemsResponse>(`/admin/content/items${query(filters)}`),
  tags: () => request<{ items: AdminContentTag[] }>('/admin/content/tags'),
  createTag: (name: string, color?: string) => request<AdminContentTag>('/admin/content/tags', { method: 'POST', body: json({ name, ...(color ? { color } : {}) }) }),
  contentItem: (id: string) => request<AdminItemDetail>(`/admin/content/items/${encodeURIComponent(id)}`),
  contentHistory: (id: string) => request<{ versions: Array<Record<string, unknown>>; drafts: Array<Record<string, unknown>> }>(`/admin/content/items/${encodeURIComponent(id)}/history`),
  workspace: () => request<AdminWorkspaceSummary>('/admin/content/workspace'),
  releaseContent: () => request<ReleaseContentStatus>('/admin/content/release'),
  buildReleaseContent: () => request<{ job: Record<string, unknown> }>('/admin/content/release/build', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  saveItem: (id: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/content/workspace/items/${encodeURIComponent(id)}`, { method: 'PUT', body: json(body) }),
  discardItem: (id: string) => request<{ discarded: boolean }>(`/admin/content/workspace/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadMedia: async (id: string, file: File, purpose: 'posterUrl' | 'headerUrl' | 'backdropUrl' | 'screenshot') => request<{ url: string; width: number; height: number; bytes: number }>(`/admin/content/items/${encodeURIComponent(id)}/media`, { method: 'POST', body: json({ fileName: file.name, contentType: file.type, base64: await fileBase64(file), purpose }), timeoutMs: 60_000 }),
  bulkContent: (body: Record<string, unknown>) => request<Record<string, unknown>>('/admin/content/workspace/bulk', { method: 'POST', body: json(body), timeoutMs: 60_000 }),
  contentExchangeSelection: (itemIds: string[]) => request<ContentExchangeSelection>('/admin/content/exchange/selection', { method: 'POST', body: json({ itemIds }) }),
  exportContentExchange: (itemIds: string[], fields: string[]) => request<Record<string, unknown>>('/admin/content/exchange/export', { method: 'POST', body: json({ itemIds, fields }), timeoutMs: 60_000 }),
  previewContentExchangeImport: (document: Record<string, unknown>) => request<ContentExchangePreview>('/admin/content/exchange/import/preview', { method: 'POST', body: json({ document }), timeoutMs: 60_000 }),
  applyContentExchangeImport: (body: Record<string, unknown>) => request<{ summary: { requested: number; staged: number; failed: number }; results: Array<Record<string, unknown>> }>('/admin/content/exchange/import/apply', { method: 'POST', body: json(body), timeoutMs: 120_000 }),
  validateWorkspace: () => request<Record<string, unknown>>('/admin/content/workspace/validate', { method: 'POST', body: '{}' }),
  buildWorkspace: () => request<{ job: Record<string, unknown> }>('/admin/content/workspace/build', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  activateWorkspace: () => request<Record<string, unknown>>('/admin/content/workspace/activate', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  reports: (filters: Record<string, unknown>) => request<ReportListResponse>(`/admin/content-reports${query(filters)}`),
  report: (id: string) => request<Record<string, unknown>>(`/admin/content-reports/${id}`),
  patchReport: (id: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/content-reports/${id}`, { method: 'PATCH', body: json(body) }),
  pipelines: () => request<{ items: Array<Record<string, unknown>> }>('/admin/pipelines'),
  pipelineEstimate: (pipeline: 'music' | 'movie' | 'anime' | 'normalization', body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/pipelines/${pipeline}/estimate`, { method: 'POST', body: json(body) }),
  pipelineManualPreview: (pipeline: 'music' | 'movie' | 'anime', items: Array<Record<string, unknown>>) => request<{ items: Array<Record<string, unknown>>; summary: Record<string, number> }>(`/admin/pipelines/${pipeline}/manual/preview`, { method: 'POST', body: json(pipeline === 'music' ? { artists: items } : pipeline === 'movie' ? { movies: items } : { anime: items }) }),
  normalizationFields: (mode: ContentMode) => request<{
    mode: ContentMode
    items: Array<{ field: string; label: string }>
    variables: Array<{ name: string; label: string; token: string }>
    contextOptions: Array<{ field: string; label: string }>
    defaultContextFields: string[]
  }>(`/admin/pipelines/normalization/fields${query({ mode })}`),
  normalizationPreview: (body: Record<string, unknown>) => request<{
    item: { id: string; titleRu: string | null; titleOriginal: string | null }
    renderedPrompt: string
    context: Record<string, unknown>
  }>('/admin/pipelines/normalization/preview', { method: 'POST', body: json(body) }),
  startPipeline: (pipeline: 'music' | 'movie' | 'anime' | 'normalization', body: Record<string, unknown>) => request<{ runId: string; jobId: string }>(`/admin/pipelines/${pipeline}/runs`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: json({ ...body, confirmation: true }) }),
  pipelineRuns: () => request<{ items: Array<Record<string, unknown>> }>('/admin/pipeline-runs'),
  pipelineRun: (id: string) => request<Record<string, unknown>>(`/admin/pipeline-runs/${id}`),
  pipelineRunEvents: (id: string) => request<Record<string, unknown>>(`/admin/pipeline-runs/${id}/events`),
  pipelineItems: (id: string) => request<{ items: Array<Record<string, unknown>> }>(`/admin/pipeline-runs/${id}/items`),
  pipelineDecision: (runId: string, itemId: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/pipeline-runs/${runId}/items/${itemId}/decision`, { method: 'PATCH', body: json(body) }),
  pipelineBulkDecision: (runId: string, body: { itemIds: string[]; approved: boolean; note?: string }) => request<{ success: number; failed: number; approved: boolean; itemIds: string[] }>(`/admin/pipeline-runs/${runId}/items/decisions`, { method: 'PATCH', body: json(body) }),
  regeneratePipelineItem: (runId: string, itemId: string) => request<Record<string, unknown>>(`/admin/pipeline-runs/${runId}/items/${itemId}/regenerate`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  retryFailedPipelineItems: (runId: string) => request<{ job: Record<string, unknown>; failedCount: number }>(`/admin/pipeline-runs/${runId}/retry-failed`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  approvePipeline: (runId: string, body: Record<string, unknown>, publish = false) => request<Record<string, unknown>>(`/admin/pipeline-runs/${runId}/${publish ? 'approve-and-publish' : 'approve-to-workspace'}`, { method: 'POST', body: json(body), timeoutMs: 120_000 }),
  cancelPipeline: (id: string) => request<Record<string, unknown>>(`/admin/pipeline-runs/${id}/cancel`, { method: 'POST', body: '{}' }),
  continuePipelineRun: (id: string) => request<Record<string, unknown>>(`/admin/pipeline-runs/${id}/continue`, { method: 'POST', body: '{}' }),
  deletePipelineRun: (id: string) => request<Record<string, unknown>>(`/admin/pipeline-runs/${id}`, { method: 'DELETE', body: json({ confirmation: true }) }),
  cleanupPipelineRuns: (keepLatest = 30) => request<Record<string, unknown>>('/admin/pipeline-runs/cleanup', { method: 'POST', body: json({ confirmation: true, keepLatest }) }),
  integrations: () => request<{ items: Array<Record<string, unknown>> }>('/admin/integrations'),
  saveIntegration: (key: string, value: string) => request<{ items: Array<Record<string, unknown>> }>(`/admin/integrations/${encodeURIComponent(key)}`, { method: 'PUT', body: json({ value, confirmation: true }) }),
  deleteIntegration: (key: string) => request<{ items: Array<Record<string, unknown>> }>(`/admin/integrations/${encodeURIComponent(key)}`, { method: 'DELETE', body: json({ confirmation: true }) }),
  users: (filters: Record<string, unknown>) => request<UserListResponse>(`/admin/users${query(filters)}`),
  user: (id: string) => request<Record<string, unknown>>(`/admin/users/${id}`),
  blockUser: (id: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/users/${id}/block`, { method: 'POST', body: json(body) }),
  unblockUser: (id: string, reason: string) => request<Record<string, unknown>>(`/admin/users/${id}/unblock`, { method: 'POST', body: json({ reason }) }),
  revokeSessions: (id: string) => request<Record<string, unknown>>(`/admin/users/${id}/revoke-sessions`, { method: 'POST', body: '{}' }),
  addUserNote: (id: string, text: string) => request<Record<string, unknown>>(`/admin/users/${id}/notes`, { method: 'POST', body: json({ text }) }),
  adjustWallet: (userId: string, amount: number, reason: string) => request<Record<string, unknown>>('/admin/wallet-adjustments', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: json({ userId, amount, reason }) }),
  events: (filters: Record<string, unknown>) => request<{ items: AdminTimelineEvent[]; nextCursor: string | null }>(`/admin/events${query(filters)}`),
  qualityIssues: () => request<{ items: Array<Record<string, unknown>> }>('/admin/quality-issues'),
  patchQualityIssue: (id: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/quality-issues/${id}`, { method: 'PATCH', body: json(body) }),
  runQuality: () => request<{ job: Record<string, unknown> }>('/admin/content/quality-checks', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  jobs: () => request<{ items: Array<Record<string, unknown>> }>('/admin/jobs'),
  retryJob: (id: string) => request<{ job: Record<string, unknown> }>(`/admin/jobs/${id}/retry`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  health: () => request<Record<string, unknown>>('/admin/health'),
  audit: () => request<{ items: Array<Record<string, unknown>> }>('/admin/audit-log'),
  promos: () => request<{ items: Array<Record<string, unknown>> }>('/admin/promos'),
  createPromo: (body: Record<string, unknown>) => request<Record<string, unknown>>('/admin/promos', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: json(body) }),
  patchPromo: (id: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/promos/${id}`, { method: 'PATCH', body: json(body) }),
  revisions: () => request<{ items: Array<Record<string, unknown>> }>('/admin/content/revisions'),
  activateRevision: (id: string, reason?: string) => request<Record<string, unknown>>(`/admin/content/revisions/${id}/activate`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: json({ ...(reason ? { reason } : {}) }) }),
  dailyChallenges: () => request<{ today: string; items: Array<Record<string, unknown>> }>('/admin/daily-challenges'),
  replaceDailyChallenge: (id: string, itemId: string, reason: string) => request<Record<string, unknown>>(`/admin/daily-challenges/${id}/replace`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: json({ itemId, reason, confirmation: true }) }),
  dailySalt: () => request<Record<string, unknown>>('/admin/settings/daily-salt'),
  updateDailySalt: (currentValue: number, value: number, reason: string) => request<Record<string, unknown>>('/admin/settings/daily-salt', { method: 'PUT', headers: { 'Idempotency-Key': idempotencyKey() }, body: json({ currentValue, value, reason }) }),
}
