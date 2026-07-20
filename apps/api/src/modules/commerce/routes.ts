import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { AppConfig } from '@shoditsa/config'
import { CheckoutBodySchema, CommerceOrderParamsSchema, UuidSchema, type CheckoutBody, type CommerceOrderParams } from '@shoditsa/contracts'
import type { Database } from '@shoditsa/database'
import type { Auth } from '../auth/auth.js'
import { getRequestUser, requireAdmin } from '../auth/session.js'
import { requireIdempotencyKey } from '../../lib/errors.js'
import { commerceCatalog } from './products.js'
import { acceptWebhook, confirmStubOrder, getOrder, meCommerce, startCheckout } from './service.js'

type Deps = { db: Database; auth: Auth; config: AppConfig }
const idempotencyHeaders = Type.Object({ 'idempotency-key': UuidSchema }, { additionalProperties: true })

export const registerCommerceRoutes = async (app: FastifyInstance, deps: Deps) => {
  app.get('/api/v1/commerce/catalog', async () => commerceCatalog(deps.db, deps.config.commerce.enabled, deps.config.commerce.currency))
  app.get('/api/v1/me/commerce', async (request) => {
    const actor = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    return meCommerce(deps.db, actor!.id)
  })
  app.post('/api/v1/commerce/checkout', {
    schema: { body: CheckoutBodySchema, headers: idempotencyHeaders },
    config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: async (request: { headers: Record<string, unknown>; ip: string }) => String(request.headers.cookie ?? request.ip) } },
  }, async (request) => {
    const actor = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    const body = request.body as CheckoutBody
    return startCheckout(deps.db, deps.config, actor!, body.productId, requireIdempotencyKey(request), { offerVersion: body.offerVersion, termsAccepted: body.termsAccepted })
  })
  app.get('/api/v1/commerce/orders/:orderId', {
    schema: { params: CommerceOrderParamsSchema },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request) => {
    const actor = await getRequestUser(request, deps.auth, deps.db, true, deps.config)
    return getOrder(deps.db, actor!.id, (request.params as CommerceOrderParams).orderId)
  })

  if (!deps.config.production && deps.config.commerce.provider === 'stub') {
    app.post('/api/v1/commerce/test/orders/:orderId/confirm', { schema: { params: CommerceOrderParamsSchema } }, async (request) => {
      const testKey = request.headers['x-commerce-test-key']
      if (!deps.config.metricsToken || testKey !== deps.config.metricsToken) await requireAdmin(request, deps.auth, deps.db, deps.config)
      return confirmStubOrder(deps.db, deps.config, (request.params as CommerceOrderParams).orderId)
    })
  }

  await app.register(async (rawScope) => {
    rawScope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))
    rawScope.post('/api/v1/commerce/webhooks/:provider', {
      schema: { params: Type.Object({ provider: Type.String({ minLength: 1, maxLength: 40 }) }, { additionalProperties: false }) },
      bodyLimit: 128 * 1024,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    }, async (request) => acceptWebhook(
      deps.db,
      deps.config,
      (request.params as { provider: string }).provider,
      request.body as Buffer,
      request.headers,
    ))
  })
}
