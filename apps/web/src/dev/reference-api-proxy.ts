import { readFileSync } from 'node:fs'
import { createSecureContext } from 'node:tls'
import type { IncomingMessage } from 'node:http'
import type { Plugin, ProxyOptions, ServerOptions } from 'vite'

export const REFERENCE_API_TARGET = 'https://shoditsa.ru'
export const REFERENCE_API_PORT = 5177
export const REFERENCE_YANDEX_PORT = 5178

type PreviewRequest = Pick<IncomingMessage, 'method' | 'url' | 'headers'> & {
  socket: { remoteAddress?: string }
}
type BoundaryResult = { status: number; code: string; message: string } | null
const denied = (code: string, message: string, status = 403): BoundaryResult => ({ status, code, message })
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const canonicalHosts = new Set(['shoditsa.ru', 'shoditsa.ru:443'])
const header = (request: PreviewRequest, name: string) => {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Validate the browser-facing boundary before translating any upstream headers. */
export function referenceApiBoundary(request: PreviewRequest, protocol: 'http:' | 'https:', canonicalOrigin = false, port = REFERENCE_API_PORT): BoundaryResult {
  // Vite's HTTPS server negotiates HTTP/2, which uses :authority, not Host.
  // Reject contradictory values instead of letting client and proxy disagree.
  const hostHeader = header(request, 'host')
  const authority = header(request, ':authority')
  const host = hostHeader ?? authority
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`])
  if (canonicalOrigin && protocol !== 'https:') return denied('REFERENCE_API_HTTPS_REQUIRED', 'Canonical-origin preview requires HTTPS.')
  if ((hostHeader && authority && hostHeader !== authority) || !loopbackAddresses.has(request.socket.remoteAddress ?? '') || !host || !(canonicalOrigin ? canonicalHosts : allowedHosts).has(host)) {
    return denied('REFERENCE_API_LOCAL_ONLY', 'This preview is available only on its configured loopback origin.')
  }
  const rawPath = (request.url ?? '/').split('?', 1)[0]
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || /\\|%(?:2e|2f|5c)|[\u0000-\u001f]/i.test(rawPath)) {
    return denied('REFERENCE_API_INVALID_PATH', 'Invalid preview path.', 400)
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(rawPath, `${protocol}//${host}`).pathname)
    // Do not accept ambiguous paths that upstream frameworks could decode again.
    if (pathname.includes('%')) throw new Error('Double-encoded path')
  } catch {
    return denied('REFERENCE_API_INVALID_PATH', 'Invalid preview path.', 400)
  }
  if (/^\/(?:admin|api\/v1\/admin)(?:\/|$)/i.test(pathname)) {
    return denied('REFERENCE_API_PUBLIC_ONLY', 'Admin routes are not part of the public preview.', 404)
  }
  const isApi = /^\/api(?:\/|$)/.test(pathname)
  const isMedia = /^\/media(?:\/|$)/.test(pathname)
  if (!isApi && !isMedia) return null

  const method = String(request.method ?? 'GET').toUpperCase()
  // This single cross-site navigation is the actual provider callback. The
  // upstream validates its signed OAuth state cookie and authorization code.
  if (canonicalOrigin && method === 'GET' && pathname === '/api/auth/oauth2/callback/yandex') return null
  const localOrigin = canonicalOrigin ? REFERENCE_API_TARGET : `${protocol}//${host}`
  const origin = header(request, 'origin')
  const referer = header(request, 'referer')
  const fetchSite = header(request, 'sec-fetch-site')
  if (origin !== undefined && origin !== localOrigin) {
    return denied('REFERENCE_API_INVALID_ORIGIN', 'Use the preview from its own localhost origin.')
  }
  if (referer !== undefined) {
    try {
      if (new URL(referer).origin !== localOrigin) throw new Error('Foreign referer')
    } catch {
      return denied('REFERENCE_API_INVALID_ORIGIN', 'Use the preview from its own localhost origin.')
    }
  }
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return denied('REFERENCE_API_INVALID_ORIGIN', 'Cross-origin preview requests are not allowed.')
  }
  if (!safeMethods.has(method)) {
    if (origin !== localOrigin || header(request, 'sec-fetch-mode') === 'no-cors') {
      return denied('REFERENCE_API_INVALID_ORIGIN', 'An exact localhost Origin is required for this action.')
    }
    const contentType = header(request, 'content-type')
    const hasBody = Number(header(request, 'content-length') ?? 0) > 0 || Boolean(header(request, 'transfer-encoding'))
    if ((contentType && !/^application\/json(?:\s*;|$)/i.test(contentType)) || (hasBody && !contentType)) {
      return denied('REFERENCE_API_JSON_REQUIRED', 'Preview actions require JSON.', 415)
    }
  } else if (header(request, 'cookie') && !origin && !referer && fetchSite !== 'same-origin') {
    return denied('REFERENCE_API_INVALID_ORIGIN', 'Authenticated preview requests require a same-origin context.')
  }
  if (isMedia && method !== 'GET' && method !== 'HEAD') {
    return denied('REFERENCE_API_MEDIA_READ_ONLY', 'Media can only be read.', 405)
  }
  if (!canonicalOrigin && /^\/api\/auth\/(?:sign-in\/oauth2|sign-up\/email|request-password-reset|reset-password|oauth2\/callback)(?:\/|$)/i.test(pathname)) {
    return denied('REFERENCE_API_AUTH_REDIRECT_UNSUPPORTED', 'Этот способ входа требует адреса основного сайта. В локальном просмотре используйте вход по email и паролю.', 409)
  }
  // Developer page views and errors must not pollute production analytics.
  if (/^\/api\/v1\/client-events(?:\/|$)/i.test(pathname)) {
    return { status: 204, code: 'REFERENCE_API_ANALYTICS_DISABLED', message: 'Preview analytics stay local.' }
  }
  return null
}

export function createReferenceApiProxy(canonicalOrigin = false): ProxyOptions {
  return {
    target: REFERENCE_API_TARGET,
    changeOrigin: true,
    secure: true,
    followRedirects: false,
    // Native EventSource needs a streaming connection without an idle cutoff.
    timeout: 0,
    proxyTimeout: 0,
    configure(proxy) {
      proxy.on('error', (error, request) => {
        // Vite's subsequent error listener prints the request URL and stack.
        // OAuth callback codes must never appear in those local diagnostics.
        if (request.url?.startsWith('/api/auth/')) {
          request.url = request.url.split('?', 1)[0]
          error.message = 'Upstream authentication request failed.'
          error.stack = 'Upstream authentication request failed; sensitive details omitted.'
        }
      })
      proxy.on('proxyReq', (outgoing, request) => {
        // The middleware above has already checked Host, loopback and Origin.
        if (!canonicalOrigin) {
          outgoing.setHeader('Origin', REFERENCE_API_TARGET)
          if (request.headers.referer) outgoing.setHeader('Referer', `${REFERENCE_API_TARGET}/`)
        }
        for (const name of ['forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for']) {
          outgoing.removeHeader(name)
        }
      })
      proxy.on('proxyRes', (response) => {
        // This is a same-origin endpoint, never a cross-origin relay.
        delete response.headers['access-control-allow-origin']
        delete response.headers['access-control-allow-credentials']
        delete response.headers['alt-svc']
        // Set-Cookie is deliberately untouched: Secure, HttpOnly, SameSite and
        // host-only semantics remain the auth server's responsibility.
      })
    },
  }
}

export function referenceApiDevProfile(options: { certificatePath?: string; keyPath?: string; canonicalOrigin?: boolean; port?: number } = {}): {
  plugin: Plugin; server: ServerOptions
} {
  if (Boolean(options.certificatePath) !== Boolean(options.keyPath)) {
    throw new Error('Reference API HTTPS requires both REFERENCE_API_CERT and REFERENCE_API_KEY.')
  }
  const https = options.certificatePath && options.keyPath
    ? { cert: readFileSync(options.certificatePath), key: readFileSync(options.keyPath) }
    : undefined
  if (options.canonicalOrigin && !https) throw new Error('Yandex reference preview requires a trusted certificate and key for shoditsa.ru.')
  if (https) createSecureContext(https)
  const protocol = https ? 'https:' : 'http:'
  const port = options.port ?? (options.canonicalOrigin ? REFERENCE_YANDEX_PORT : REFERENCE_API_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid reference API preview port.')
  return {
    plugin: {
      name: 'reference-api-local-boundary',
      configResolved(config) {
        if (config.server.host !== '127.0.0.1' || config.server.port !== port || !config.server.strictPort) {
          throw new Error(`Reference API preview must bind to 127.0.0.1:${port} with strictPort.`)
        }
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const result = referenceApiBoundary(request, protocol, options.canonicalOrigin, port)
          if (!result) return next()
          if (result.status >= 400) {
            // Boundary diagnostics deliberately exclude URL, query, cookies and
            // authorization. HTTP/2 carries its host in :authority instead.
            server.config.logger.warn(`[reference-api boundary] ${JSON.stringify({
              code: result.code,
              canonicalOrigin: Boolean(options.canonicalOrigin),
              protocol,
              method: request.method,
              host: header(request, 'host'),
              authority: header(request, ':authority'),
              remoteAddress: request.socket.remoteAddress,
            })}`)
          }
          response.statusCode = result.status
          response.setHeader('Cache-Control', 'no-store')
          if (result.status === 204) return response.end()
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ code: result.code, message: result.message }))
        })
      },
    },
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      allowedHosts: options.canonicalOrigin ? ['shoditsa.ru'] : ['localhost'],
      cors: false,
      ...(https ? { https } : {}),
      ...(options.canonicalOrigin ? { ws: { protocol: 'wss', host: 'shoditsa.ru', clientPort: 443 } } : {}),
      proxy: {
        '^/api(?:/|$)': createReferenceApiProxy(options.canonicalOrigin),
        '^/media(?:/|$)': createReferenceApiProxy(options.canonicalOrigin),
      },
    },
  }
}
