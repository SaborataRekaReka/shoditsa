import { describe, expect, it } from 'vitest'
import { fromUnknownError } from '../src/lib/errors.js'
import { rateLimitError, rateLimitKey, rateLimitMax, rateLimitScope } from '../src/lib/rate-limit.js'

describe('rate limit policy', () => {
  it('isolates admin reads, admin writes and public traffic into separate buckets', () => {
    expect(rateLimitScope('/api/v1/admin/pipeline-runs/123/items', 'GET')).toBe('admin-read')
    expect(rateLimitScope('/api/v1/admin/pipeline-runs/123/items/decisions', 'PATCH')).toBe('admin-write')
    expect(rateLimitScope('/api/v1/games/start', 'POST')).toBe('public')
    expect(rateLimitKey('127.0.0.1', '/api/v1/admin/dashboard', 'GET')).toBe('admin-read:127.0.0.1')
    expect(rateLimitKey('127.0.0.1', '/api/v1/admin/content/items/x', 'PUT')).toBe('admin-write:127.0.0.1')
  })

  it('keeps the public limit strict while giving authenticated admin workflows independent capacity', () => {
    expect(rateLimitMax(true, '/api/v1/games/start', 'POST')).toBe(120)
    expect(rateLimitMax(true, '/api/v1/admin/dashboard', 'GET')).toBe(600)
    expect(rateLimitMax(true, '/api/v1/admin/pipeline-runs/x/items/decisions', 'PATCH')).toBe(300)
  })

  it('returns a stable localized RATE_LIMITED envelope with retry metadata', () => {
    const error = rateLimitError({ statusCode: 429, ban: false, max: 120, ttl: 17_001 })
    expect(error).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Слишком много запросов. Повторите через 18 сек.',
      details: { retryAfterMs: 18_000, limit: 120 },
    })
    expect(fromUnknownError(Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 }))).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Слишком много запросов. Повторите попытку позже',
    })
  })
})
