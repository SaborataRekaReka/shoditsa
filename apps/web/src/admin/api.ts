import type {
  AdminContentItemsResponse, AdminDashboardResponse, AdminTimelineEvent, AdminUserListItem, AdminWorkspaceSummary,
  ContentMode, MeResponse,
} from '@shoditsa/contracts'

const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export class AdminApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) { super(message) }
}

export const idempotencyKey = () => crypto.randomUUID()

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
      throw new AdminApiError(response.status, String(envelope?.code ?? 'HTTP_ERROR'), String(envelope?.message ?? 'Не удалось выполнить запрос'), (envelope?.details as Record<string, unknown>) ?? {})
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
}

export type ReportListResponse = { items: Array<{ report: Record<string, unknown>; userEmail: string; titleRu: string; sessionStatus: string }>; nextCursor: string | null }
export type UserListResponse = { items: AdminUserListItem[]; nextCursor: string | null }

export const adminApi = {
  me: () => request<MeResponse>('/me'),
  dashboard: () => request<AdminDashboardResponse>('/admin/dashboard'),
  contentItems: (filters: Record<string, unknown>) => request<AdminContentItemsResponse>(`/admin/content/items${query(filters)}`),
  contentItem: (id: string) => request<AdminItemDetail>(`/admin/content/items/${encodeURIComponent(id)}`),
  contentHistory: (id: string) => request<{ versions: Array<Record<string, unknown>>; drafts: Array<Record<string, unknown>> }>(`/admin/content/items/${encodeURIComponent(id)}/history`),
  workspace: () => request<AdminWorkspaceSummary>('/admin/content/workspace'),
  saveItem: (id: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/content/workspace/items/${encodeURIComponent(id)}`, { method: 'PUT', body: json(body) }),
  discardItem: (id: string) => request<{ discarded: boolean }>(`/admin/content/workspace/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  bulkContent: (body: Record<string, unknown>) => request<Record<string, unknown>>('/admin/content/workspace/bulk', { method: 'POST', body: json(body), timeoutMs: 60_000 }),
  validateWorkspace: () => request<Record<string, unknown>>('/admin/content/workspace/validate', { method: 'POST', body: '{}' }),
  buildWorkspace: () => request<{ job: Record<string, unknown> }>('/admin/content/workspace/build', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  activateWorkspace: () => request<Record<string, unknown>>('/admin/content/workspace/activate', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  reports: (filters: Record<string, unknown>) => request<ReportListResponse>(`/admin/content-reports${query(filters)}`),
  report: (id: string) => request<Record<string, unknown>>(`/admin/content-reports/${id}`),
  patchReport: (id: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/content-reports/${id}`, { method: 'PATCH', body: json(body) }),
  pipelines: () => request<{ items: Array<Record<string, unknown>> }>('/admin/pipelines'),
  pipelineEstimate: (body: Record<string, unknown>) => request<Record<string, unknown>>('/admin/pipelines/music/estimate', { method: 'POST', body: json(body) }),
  startPipeline: (body: Record<string, unknown>) => request<{ runId: string; jobId: string }>('/admin/pipelines/music/runs', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: json({ ...body, confirmation: true }) }),
  pipelineRuns: () => request<{ items: Array<Record<string, unknown>> }>('/admin/pipeline-runs'),
  pipelineRun: (id: string) => request<Record<string, unknown>>(`/admin/pipeline-runs/${id}`),
  pipelineItems: (id: string) => request<{ items: Array<Record<string, unknown>> }>(`/admin/pipeline-runs/${id}/items`),
  pipelineDecision: (runId: string, itemId: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/pipeline-runs/${runId}/items/${itemId}/decision`, { method: 'PATCH', body: json(body) }),
  approvePipeline: (runId: string, body: Record<string, unknown>, publish = false) => request<Record<string, unknown>>(`/admin/pipeline-runs/${runId}/${publish ? 'approve-and-publish' : 'approve-to-workspace'}`, { method: 'POST', body: json(body), timeoutMs: 120_000 }),
  cancelPipeline: (id: string) => request<Record<string, unknown>>(`/admin/pipeline-runs/${id}/cancel`, { method: 'POST', body: '{}' }),
  users: (filters: Record<string, unknown>) => request<UserListResponse>(`/admin/users${query(filters)}`),
  user: (id: string) => request<Record<string, unknown>>(`/admin/users/${id}`),
  blockUser: (id: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/users/${id}/block`, { method: 'POST', body: json(body) }),
  unblockUser: (id: string, reason: string) => request<Record<string, unknown>>(`/admin/users/${id}/unblock`, { method: 'POST', body: json({ reason }) }),
  revokeSessions: (id: string) => request<Record<string, unknown>>(`/admin/users/${id}/revoke-sessions`, { method: 'POST', body: '{}' }),
  addUserNote: (id: string, text: string) => request<Record<string, unknown>>(`/admin/users/${id}/notes`, { method: 'POST', body: json({ text }) }),
  adjustWallet: (userId: string, amount: number, reason: string) => request<Record<string, unknown>>('/admin/wallet-adjustments', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: json({ userId, amount, reason }) }),
  events: (filters: Record<string, unknown>) => request<{ items: AdminTimelineEvent[]; nextCursor: string | null }>(`/admin/events${query(filters)}`),
  qualityIssues: () => request<{ items: Array<Record<string, unknown>> }>('/admin/quality-issues'),
  runQuality: () => request<{ job: Record<string, unknown> }>('/admin/content/quality-checks', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  jobs: () => request<{ items: Array<Record<string, unknown>> }>('/admin/jobs'),
  retryJob: (id: string) => request<{ job: Record<string, unknown> }>(`/admin/jobs/${id}/retry`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  health: () => request<Record<string, unknown>>('/admin/health'),
  audit: () => request<{ items: Array<Record<string, unknown>> }>('/admin/audit-log'),
  promos: () => request<{ items: Array<Record<string, unknown>> }>('/admin/promos'),
  createPromo: (body: Record<string, unknown>) => request<Record<string, unknown>>('/admin/promos', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: json(body) }),
  patchPromo: (id: string, body: Record<string, unknown>) => request<Record<string, unknown>>(`/admin/promos/${id}`, { method: 'PATCH', body: json(body) }),
  revisions: () => request<{ items: Array<Record<string, unknown>> }>('/admin/content/revisions'),
  activateRevision: (id: string) => request<Record<string, unknown>>(`/admin/content/revisions/${id}/activate`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' }),
  dailySalt: () => request<Record<string, unknown>>('/admin/settings/daily-salt'),
  updateDailySalt: (currentValue: number, value: number, reason: string) => request<Record<string, unknown>>('/admin/settings/daily-salt', { method: 'PUT', headers: { 'Idempotency-Key': idempotencyKey() }, body: json({ currentValue, value, reason }) }),
}
