import type {
  AdminContentReviewDecision, AdminReviewDecisionResponse, AdminReviewQueueResponse, ApiDifficultyKey,
  ApiPeriodKey, ArchiveResponse, AssistHintKey, AttemptResponse, CatalogSearchResponse, ContentMode, ContentReportBody,
  ContentReportResponse, DashboardResponse, FreePlayResponse, GameResponse, GameStartBody,
  GameStartResponse, GuestResponse, HintResponse, LedgerResponse, LegacyImportBody, LegacyImportResponse,
  MeResponse, MetaResponse, PeriodUnlockResponse, PromoRedeemResponse, WalletResponse, AuthActionResponse,
  PlayerProfile, ProfilePatch,
  ArchiveCalendarQuery, ArchiveCalendarResponse, CheckoutBody, CheckoutResponse, CommerceCatalogResponse, MeCommerceResponse, OrderResponse,
  PackDetailResponse, PackListResponse, PackProgressResponse,
  PrivateGameOrderBody, PrivateGameOrderResponse,
  DanetkiMessage,
  FriendsRoomConfigBody, FriendsRoomCreateBody, FriendsRoomPreview, FriendsRoomResponse,
} from '@shoditsa/contracts'
import { trackClientEvent } from '../app/client-events'

const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
const AUTH_BASE = String(import.meta.env.VITE_AUTH_BASE_URL || '/api/auth').replace(/\/$/, '')

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string, public details: Record<string, unknown> = {}) { super(message) }
}

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const hasIdempotencyKey = (headers?: HeadersInit) => {
  if (!headers) return false
  if (headers instanceof Headers) return headers.has('Idempotency-Key')
  if (Array.isArray(headers)) return headers.some(([name]) => name.toLowerCase() === 'idempotency-key')
  return Object.keys(headers).some((name) => name.toLowerCase() === 'idempotency-key')
}

const parseRetryAfterMs = (response: Response, payload: Record<string, unknown> | null, message: string) => {
  const details = asRecord(payload?.details)
  const explicitMs = Number(details?.retryAfterMs ?? payload?.retryAfterMs)
  if (Number.isFinite(explicitMs) && explicitMs > 0) return explicitMs

  const header = response.headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000)
    const retryAt = Date.parse(header)
    if (Number.isFinite(retryAt)) {
      const diff = retryAt - Date.now()
      if (diff > 0) return diff
    }
  }

  const match = message.match(/retry in\s+(\d+)\s*(second|seconds|sec|s|minute|minutes|min|m)/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = match[2].toLowerCase()
  return unit.startsWith('m') ? value * 60_000 : value * 1_000
}

const retryDelayMs = (status: number, retryAfterMs: number | null, attempt: number, maxRateLimitRetryMs: number) => {
  if (status === 429 && retryAfterMs !== null) return Math.min(retryAfterMs, maxRateLimitRetryMs)
  return Math.min(250 * (attempt + 1), 1_500)
}

const request = async <T>(path: string, options: RequestInit & { timeoutMs?: number; retries?: number; maxRateLimitRetryMs?: number } = {}): Promise<T> => {
  const { timeoutMs = 10_000, retries = 0, maxRateLimitRetryMs = 2_500, ...fetchOptions } = options
  const method = String(fetchOptions.method ?? 'GET').toUpperCase()
  const retryable = ['GET', 'HEAD', 'OPTIONS'].includes(method) || hasIdempotencyKey(fetchOptions.headers)
  let attemptIndex = 0

  while (true) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(path, {
        ...fetchOptions,
        credentials: 'include',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
          ...fetchOptions.headers,
        },
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
        const retryAfterMs = parseRetryAfterMs(response, payload, message)
        const details = {
          ...(asRecord(nestedError?.details ?? payload?.details) ?? {}),
          ...(retryAfterMs !== null ? { retryAfterMs } : {}),
        }
        const canRetry = retryable
          && attemptIndex < retries
          && (
            (response.status === 429 && retryAfterMs !== null && retryAfterMs <= maxRateLimitRetryMs)
            || response.status === 408
            || (response.status >= 500 && response.status <= 504)
          )
        if (canRetry) {
          const waitMs = retryDelayMs(response.status, retryAfterMs, attemptIndex, maxRateLimitRetryMs)
          attemptIndex += 1
          await delay(waitMs)
          continue
        }
        trackClientEvent('api_error', { status: response.status, path: path.split('?')[0] }, { errorCode: code, requestId })
        throw new ApiClientError(response.status, code, message, requestId, details)
      }
      return data as T
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (retryable && attemptIndex < retries) {
          const waitMs = retryDelayMs(408, null, attemptIndex, maxRateLimitRetryMs)
          attemptIndex += 1
          await delay(waitMs)
          continue
        }
        throw new ApiClientError(408, 'NETWORK_TIMEOUT', 'Сервер отвечает слишком долго. Попробуйте ещё раз.')
      }
      if (error instanceof ApiClientError) throw error
      if (error instanceof TypeError) {
        if (retryable && attemptIndex < retries) {
          const waitMs = retryDelayMs(0, null, attemptIndex, maxRateLimitRetryMs)
          attemptIndex += 1
          await delay(waitMs)
          continue
        }
        throw new ApiClientError(0, 'NETWORK_UNAVAILABLE', 'Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.')
      }
      throw error
    } finally {
      window.clearTimeout(timeout)
    }
  }
}

export const api = {
  meta: () => request<MetaResponse>(`${API_BASE}/meta`),
  me: () => request<MeResponse>(`${API_BASE}/me`),
  guest: () => request<GuestResponse>(`${API_BASE}/auth/guest`, { method: 'POST', body: '{}' }),
  dashboard: () => request<DashboardResponse>(`${API_BASE}/me/dashboard`, { retries: 1 }),
  updateProfile: (body: ProfilePatch) => request<PlayerProfile>(`${API_BASE}/me/profile`, { method: 'PATCH', body: JSON.stringify(body) }),
  start: (body: GameStartBody, key: string) => request<GameStartResponse>(`${API_BASE}/games/start`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(body),
    retries: 1,
    maxRateLimitRetryMs: 10_000,
  }),
  game: (id: string) => request<GameResponse>(`${API_BASE}/games/${id}`, { retries: 1 }),
  danetkiSnapshot: (id: string, afterSeq = 0) => request<GameResponse>(`${API_BASE}/danetki/sessions/${id}/snapshot?afterSeq=${afterSeq}`, { retries: 1 }),
  danetkiMessage: (id: string, text: string, idempotencyKey: string) => request<{ message: DanetkiMessage; aiStatus: 'queued' }>(`${API_BASE}/danetki/sessions/${id}/messages`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ text, idempotencyKey }), retries: 1, timeoutMs: 15_000 }),
  danetkiHint: (id: string, idempotencyKey: string) => request<{ message: DanetkiMessage; hintLevel: number }>(`${API_BASE}/danetki/sessions/${id}/hints`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey }), retries: 1 }),
  danetkiRetryAi: (id: string, idempotencyKey: string) => request<{ queued: boolean; jobId: string }>(`${API_BASE}/danetki/sessions/${id}/retry-ai`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey }), retries: 1 }),
  danetkiGuess: (id: string, text: string, idempotencyKey: string) => request<{ guess: { id: string; status: string } }>(`${API_BASE}/danetki/sessions/${id}/guesses`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ text, idempotencyKey }), retries: 1, timeoutMs: 15_000 }),
  danetkiSurrender: (id: string, idempotencyKey: string) => request<{ completed: boolean; votes: number; required: number }>(`${API_BASE}/danetki/sessions/${id}/surrender-votes`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey }), retries: 1 }),
  danetkiInvite: (id: string, idempotencyKey: string) => request<{ token: string; expiresAt: string }>(`${API_BASE}/danetki/sessions/${id}/invites`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey }) }),
  danetkiInvitePreview: (token: string) => request<{ title: string; ownerName: string; participants: number; capacity: number; expiresAt: string }>(`${API_BASE}/danetki/invites/${encodeURIComponent(token)}`),
  danetkiJoin: (token: string, displayName: string, idempotencyKey: string) => request<GameResponse>(`${API_BASE}/danetki/invites/${encodeURIComponent(token)}/join`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ displayName, idempotencyKey }), retries: 1 }),
  danetkiLeave: (id: string, idempotencyKey: string) => request<{ left: boolean; newOwnerUserId: string | null }>(`${API_BASE}/danetki/sessions/${id}/leave`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey }) }),
  friendsRoomCreate: (body: FriendsRoomCreateBody = {}) => request<FriendsRoomResponse>(`${API_BASE}/friends/rooms`, { method: 'POST', body: JSON.stringify(body) }),
  friendsRoomPreview: (code: string) => request<FriendsRoomPreview>(`${API_BASE}/friends/rooms/code/${encodeURIComponent(code)}`),
  friendsRoomJoin: (code: string, displayName?: string) => request<FriendsRoomResponse>(`${API_BASE}/friends/rooms/code/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ ...(displayName ? { displayName } : {}) }) }),
  friendsRoomSnapshot: (id: string) => request<FriendsRoomResponse>(`${API_BASE}/friends/rooms/${encodeURIComponent(id)}/snapshot`, { retries: 1 }),
  friendsRoomConfigure: (id: string, body: FriendsRoomConfigBody) => request<FriendsRoomResponse>(`${API_BASE}/friends/rooms/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  friendsRoomStart: (id: string, idempotencyKey: string) => request<FriendsRoomResponse>(`${API_BASE}/friends/rooms/${encodeURIComponent(id)}/start`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey }), retries: 1 }),
  friendsRoomAnswer: (id: string, text: string, idempotencyKey: string, itemId?: string) => request<FriendsRoomResponse>(`${API_BASE}/friends/rooms/${encodeURIComponent(id)}/answers`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ text, itemId, idempotencyKey }), retries: 1 }),
  friendsRoomReveal: (id: string, idempotencyKey: string) => request<FriendsRoomResponse>(`${API_BASE}/friends/rooms/${encodeURIComponent(id)}/reveal`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey }), retries: 1 }),
  friendsRoomNext: (id: string, idempotencyKey: string) => request<FriendsRoomResponse>(`${API_BASE}/friends/rooms/${encodeURIComponent(id)}/next`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey }), retries: 1 }),
  friendsRoomRestart: (id: string, idempotencyKey: string) => request<FriendsRoomResponse>(`${API_BASE}/friends/rooms/${encodeURIComponent(id)}/restart`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey }), retries: 1 }),
  friendsRoomMessage: (id: string, text: string, idempotencyKey: string) => request<FriendsRoomResponse>(`${API_BASE}/friends/rooms/${encodeURIComponent(id)}/messages`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ text, idempotencyKey }), retries: 1 }),
  friendsRoomLeave: (id: string, idempotencyKey: string) => request<{ left: true }>(`${API_BASE}/friends/rooms/${encodeURIComponent(id)}/leave`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey }), retries: 1 }),
  search: (params: URLSearchParams) => request<CatalogSearchResponse>(`${API_BASE}/catalog/search?${params}`, { retries: 1 }),
  attempt: (id: string, itemId: string, idempotencyKey: string) => request<AttemptResponse>(`${API_BASE}/games/${id}/attempts`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ itemId }), timeoutMs: 15_000, retries: 1, maxRateLimitRetryMs: 10_000 }),
  hint: (id: string, checkpoint: 5 | 8, hintKey: AssistHintKey, idempotencyKey: string) => request<HintResponse>(`${API_BASE}/games/${id}/hints`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ checkpoint, hintKey }), retries: 1, maxRateLimitRetryMs: 10_000 }),
  unlock: (mode: ContentMode, period: ApiPeriodKey, key: string) => request<PeriodUnlockResponse>(`${API_BASE}/economy/period-unlocks`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ mode, period }), retries: 1, maxRateLimitRetryMs: 10_000 }),
  freePlay: (mode: ContentMode, difficulty: ApiDifficultyKey | null, key: string) => request<FreePlayResponse>(`${API_BASE}/economy/free-play/start`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ mode, difficulty }), retries: 1, maxRateLimitRetryMs: 10_000 }),
  redeem: (code: string, key: string) => request<PromoRedeemResponse>(`${API_BASE}/promos/redeem`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ code }), retries: 1 }),
  archive: (mode?: ContentMode) => request<ArchiveResponse>(`${API_BASE}/archive${mode ? `?mode=${encodeURIComponent(mode)}` : ''}`, { retries: 1 }),
  archiveCalendar: (query: ArchiveCalendarQuery) => request<ArchiveCalendarResponse>(`${API_BASE}/archive/calendar?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string')).toString()}`, { retries: 1 }),
  commerceCatalog: () => request<CommerceCatalogResponse>(`${API_BASE}/commerce/catalog`, { retries: 1 }),
  meCommerce: () => request<MeCommerceResponse>(`${API_BASE}/me/commerce`, { retries: 1 }),
  checkout: (body: CheckoutBody, key: string) => request<CheckoutResponse>(`${API_BASE}/commerce/checkout`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body), retries: 1, maxRateLimitRetryMs: 10_000 }),
  commerceOrder: (id: string) => request<OrderResponse>(`${API_BASE}/commerce/orders/${encodeURIComponent(id)}`, { retries: 1 }),
  packs: () => request<PackListResponse>(`${API_BASE}/packs`, { retries: 1 }),
  pack: (id: string) => request<PackDetailResponse>(`${API_BASE}/packs/${encodeURIComponent(id)}`, { retries: 1 }),
  packProgress: (id: string) => request<PackProgressResponse>(`${API_BASE}/packs/${encodeURIComponent(id)}/progress`, { retries: 1 }),
  startPack: (id: string, position: number) => request<GameStartResponse>(`${API_BASE}/packs/${encodeURIComponent(id)}/sessions`, { method: 'POST', body: JSON.stringify({ position }), retries: 1 }),
  createPrivateGameOrder: (body: PrivateGameOrderBody) => request<PrivateGameOrderResponse>(`${API_BASE}/private-game-orders`, { method: 'POST', body: JSON.stringify(body) }),
  wallet: () => request<WalletResponse>(`${API_BASE}/me/wallet`, { retries: 1 }),
  ledger: () => request<LedgerResponse>(`${API_BASE}/me/wallet/ledger?limit=30`, { retries: 1 }),
  legacyImport: (payload: LegacyImportBody) => request<LegacyImportResponse>(`${API_BASE}/me/legacy-import`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 20_000,
  }),
  contentReport: (payload: ContentReportBody) => request<ContentReportResponse>(`${API_BASE}/content-reports`, {
    method: 'POST',
    body: JSON.stringify({
      clientEventId: crypto.randomUUID(),
      appVersion: String(import.meta.env.VITE_APP_VERSION || 'dev'),
      pageUrl: `${window.location.origin}${window.location.pathname}`,
      ...payload,
    }),
  }),
  reviewQueue: (params = new URLSearchParams({ mode: 'music', pendingOnly: 'true', limit: '30' })) => request<AdminReviewQueueResponse>(`${API_BASE}/admin/content-review?${params}`),
  reviewDecision: (itemId: string, field: string, decision: AdminContentReviewDecision, key: string) => request<AdminReviewDecisionResponse>(`${API_BASE}/admin/content-review/${encodeURIComponent(itemId)}/${encodeURIComponent(field)}`, { method: 'PUT', headers: { 'Idempotency-Key': key }, body: JSON.stringify(decision) }),
  signIn: (email: string, password: string) => request<AuthActionResponse>(`${AUTH_BASE}/sign-in/email`, { method: 'POST', body: JSON.stringify({ email, password }) }),
  signInYandex: (callbackURL: string) => request<{ url?: string }>(`${AUTH_BASE}/sign-in/oauth2`, {
    method: 'POST',
    body: JSON.stringify({ providerId: 'yandex', callbackURL, disableRedirect: true }),
  }),
  signUp: (name: string, email: string, password: string, callbackURL: string) => request<AuthActionResponse>(`${AUTH_BASE}/sign-up/email`, { method: 'POST', body: JSON.stringify({ name, email, password, callbackURL }) }),
  requestPasswordReset: (email: string, redirectTo: string) => request<unknown>(`${AUTH_BASE}/request-password-reset`, {
    method: 'POST',
    body: JSON.stringify({ email, redirectTo }),
  }),
  resetPassword: (token: string, newPassword: string) => request<unknown>(`${AUTH_BASE}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  }),
  changePassword: (currentPassword: string, newPassword: string, revokeOtherSessions = false) => request<unknown>(`${AUTH_BASE}/change-password`, {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions }),
  }),
  signOut: () => request<unknown>(`${AUTH_BASE}/sign-out`, { method: 'POST', body: '{}' }),
}

export const danetkiEventsUrl = (sessionId: string) => `${API_BASE}/danetki/sessions/${encodeURIComponent(sessionId)}/events`
export const friendsRoomEventsUrl = (roomId: string) => `${API_BASE}/friends/rooms/${encodeURIComponent(roomId)}/events`

export const queryKeys = {
  me: ['me'] as const, dashboard: ['dashboard'] as const,
  game: (id: string) => ['game', id] as const,
  friendsRoom: (id: string) => ['friends-room', id] as const,
  search: (id: string, query: string) => ['search', id, query] as const,
  archive: (filters: unknown) => ['archive', filters] as const,
  ledger: ['ledger'] as const,
  review: (filters: unknown) => ['admin', 'content-review', filters] as const,
  commerceCatalog: ['commerce', 'catalog'] as const,
  commerce: ['commerce', 'me'] as const,
  commerceOrder: (id: string) => ['commerce', 'order', id] as const,
  archiveCalendar: (filters: unknown) => ['archive', 'calendar', filters] as const,
  packs: ['packs'] as const,
  pack: (id: string) => ['packs', id] as const,
}
