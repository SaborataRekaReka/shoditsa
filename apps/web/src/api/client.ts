const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
const AUTH_BASE = String(import.meta.env.VITE_AUTH_BASE_URL || '/api/auth').replace(/\/$/, '')

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string, public details: Record<string, unknown> = {}) { super(message) }
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const request = async <T>(path: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<T> => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  try {
    const response = await fetch(path, {
      ...options, credentials: 'include', signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    })
    const data = response.status === 204 ? null : await response.json().catch(() => null)
    if (!response.ok) {
      const payload = asRecord(data)
      const nestedError = asRecord(payload?.error)
      const code = String(nestedError?.code ?? payload?.code ?? 'HTTP_ERROR')
      const message = String(nestedError?.message ?? payload?.message ?? 'Сервер не смог выполнить запрос')
      const requestId = typeof nestedError?.requestId === 'string'
        ? nestedError.requestId
        : typeof payload?.requestId === 'string'
          ? payload.requestId
          : response.headers.get('x-request-id') ?? undefined
      const details = asRecord(nestedError?.details ?? payload?.details) ?? {}
      throw new ApiClientError(response.status, code, message, requestId, details)
    }
    return data as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new ApiClientError(408, 'NETWORK_TIMEOUT', 'Сервер отвечает слишком долго. Попробуйте ещё раз.')
    throw error
  } finally { window.clearTimeout(timeout) }
}

export const api = {
  meta: () => request<any>(`${API_BASE}/meta`),
  me: () => request<any>(`${API_BASE}/me`),
  guest: () => request<any>(`${API_BASE}/auth/guest`, { method: 'POST', body: '{}' }),
  dashboard: () => request<any>(`${API_BASE}/me/dashboard`),
  start: (body: unknown) => request<any>(`${API_BASE}/games/start`, { method: 'POST', body: JSON.stringify(body) }),
  game: (id: string) => request<any>(`${API_BASE}/games/${id}`),
  search: (params: URLSearchParams) => request<any>(`${API_BASE}/catalog/search?${params}`),
  attempt: (id: string, itemId: string, idempotencyKey: string) => request<any>(`${API_BASE}/games/${id}/attempts`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ itemId }), timeoutMs: 15_000 }),
  hint: (id: string, checkpoint: 5 | 8, hintKey: string, idempotencyKey: string) => request<any>(`${API_BASE}/games/${id}/hints`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ checkpoint, hintKey }) }),
  unlock: (mode: string, period: string, key: string) => request<any>(`${API_BASE}/economy/period-unlocks`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ mode, period }) }),
  freePlay: (mode: string, difficulty: string | null, key: string) => request<any>(`${API_BASE}/economy/free-play/start`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ mode, difficulty }) }),
  redeem: (code: string, key: string) => request<any>(`${API_BASE}/promos/redeem`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ code }) }),
  archive: (mode?: string) => request<any>(`${API_BASE}/archive${mode ? `?mode=${encodeURIComponent(mode)}` : ''}`),
  wallet: () => request<any>(`${API_BASE}/me/wallet`),
  ledger: () => request<any>(`${API_BASE}/me/wallet/ledger?limit=30`),
  legacyImport: (payload: unknown) => request<any>(`${API_BASE}/me/legacy-import`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 20_000,
  }),
  signIn: (email: string, password: string) => request<any>(`${AUTH_BASE}/sign-in/email`, { method: 'POST', body: JSON.stringify({ email, password }) }),
  signInYandex: (callbackURL: string) => request<any>(`${AUTH_BASE}/sign-in/oauth2`, {
    method: 'POST',
    body: JSON.stringify({ providerId: 'yandex', callbackURL, disableRedirect: true }),
  }),
  signUp: (name: string, email: string, password: string) => request<any>(`${AUTH_BASE}/sign-up/email`, { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  requestPasswordReset: (email: string, redirectTo: string) => request<any>(`${AUTH_BASE}/request-password-reset`, {
    method: 'POST',
    body: JSON.stringify({ email, redirectTo }),
  }),
  resetPassword: (token: string, newPassword: string) => request<any>(`${AUTH_BASE}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  }),
  changePassword: (currentPassword: string, newPassword: string, revokeOtherSessions = false) => request<any>(`${AUTH_BASE}/change-password`, {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions }),
  }),
  signOut: () => request<any>(`${AUTH_BASE}/sign-out`, { method: 'POST', body: '{}' }),
}

export const queryKeys = {
  me: ['me'] as const, dashboard: ['dashboard'] as const,
  game: (id: string) => ['game', id] as const,
  search: (id: string, query: string) => ['search', id, query] as const,
  archive: (filters: unknown) => ['archive', filters] as const,
  ledger: ['ledger'] as const,
}
