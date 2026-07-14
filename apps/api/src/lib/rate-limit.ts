import { ApiError } from './errors.js'

const ADMIN_API_PREFIX = '/api/v1/admin/'

export type RateLimitScope = 'public' | 'admin-read' | 'admin-write'

export const rateLimitScope = (url: string, method: string): RateLimitScope => {
  if (!url.startsWith(ADMIN_API_PREFIX)) return 'public'
  return method === 'GET' || method === 'HEAD' ? 'admin-read' : 'admin-write'
}

export const rateLimitKey = (ip: string, url: string, method: string) => `${rateLimitScope(url, method)}:${ip}`

export const rateLimitMax = (production: boolean, url: string, method: string) => {
  if (!production) return 5_000
  const scope = rateLimitScope(url, method)
  if (scope === 'admin-read') return 600
  if (scope === 'admin-write') return 300
  return 120
}

export const rateLimitError = (context: { statusCode: number; ban: boolean; max: number; ttl: number }) => {
  const retryAfterMs = Math.max(1_000, Math.ceil(context.ttl / 1_000) * 1_000)
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1_000)
  return new ApiError(
    context.statusCode,
    context.ban ? 'RATE_LIMIT_BANNED' : 'RATE_LIMITED',
    context.ban ? 'Слишком много запросов. Доступ временно ограничен' : `Слишком много запросов. Повторите через ${retryAfterSeconds} сек.`,
    { retryAfterMs, limit: context.max },
  )
}
