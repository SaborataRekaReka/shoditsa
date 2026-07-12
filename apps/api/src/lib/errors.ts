import type { FastifyReply, FastifyRequest } from 'fastify'

export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message)
  }
}

const fromUnknownError = (error: unknown) => {
  if (error instanceof ApiError) return error
  if (!error || typeof error !== 'object') return new ApiError(500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера')

  const statusCodeRaw = (error as { statusCode?: unknown }).statusCode
  const statusCode = typeof statusCodeRaw === 'number' && Number.isInteger(statusCodeRaw) && statusCodeRaw >= 400 && statusCodeRaw <= 599
    ? statusCodeRaw
    : 500
  const code = typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : statusCode >= 500
      ? 'INTERNAL_ERROR'
      : 'BAD_REQUEST'
  const message = statusCode >= 500
    ? 'Внутренняя ошибка сервера'
    : typeof (error as { message?: unknown }).message === 'string' && (error as { message: string }).message.trim()
      ? (error as { message: string }).message
      : 'Некорректный запрос'

  return new ApiError(statusCode, code, message)
}

export const sendError = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
  const apiError = fromUnknownError(error)
  if (!(error instanceof ApiError)) {
    if (apiError.statusCode >= 500) request.log.error({ err: error }, 'Unhandled request error')
    else request.log.warn({ err: error }, 'Request validation error')
  }
  return reply.status(apiError.statusCode).send({ error: { code: apiError.code, message: apiError.message, requestId: request.id, details: apiError.details } })
}

export const requireIdempotencyKey = (request: FastifyRequest) => {
  const value = request.headers['idempotency-key']
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Заголовок Idempotency-Key должен содержать UUID')
  }
  return value
}
