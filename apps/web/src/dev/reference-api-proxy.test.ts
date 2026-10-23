import { EventEmitter } from 'node:events'
import { describe, expect, it, afterEach, vi } from 'vitest'
import viteConfig from '../../vite.config'
import { createReferenceApiProxy, referenceApiBoundary, referenceApiDevProfile } from './reference-api-proxy'

const request = (overrides: Record<string, unknown> = {}) => ({
  method: 'GET', url: '/api/v1/meta', socket: { remoteAddress: '127.0.0.1' },
  headers: { host: 'localhost:5177' }, ...overrides,
})
const post = (headers: Record<string, string> = {}, url = '/api/auth/sign-in/email') => request({
  method: 'POST', url,
  headers: { host: 'localhost:5177', origin: 'http://localhost:5177', 'content-type': 'application/json', ...headers },
})

describe('connected reference API boundary', () => {
  it('allows public reads and same-origin authenticated reads / JSON actions', () => {
    expect(referenceApiBoundary(request(), 'http:')).toBeNull()
    expect(referenceApiBoundary(request({ headers: { host: 'localhost:5177', cookie: 'example=value', 'sec-fetch-site': 'same-origin' } }), 'http:')).toBeNull()
    expect(referenceApiBoundary(post(), 'http:')).toBeNull()
    expect(referenceApiBoundary(post({ origin: 'https://localhost:5177' }), 'https:')).toBeNull()
  })

  it.each([
    request({ socket: { remoteAddress: '192.168.1.5' } }),
    request({ headers: { host: 'attacker.example:5177' } }),
    request({ headers: { host: 'localhost:5176' } }),
    post({ origin: 'http://localhost:5176' }),
    post({ origin: 'https://shoditsa.ru' }),
    post({ origin: 'null' }),
    post({ origin: '' }),
    post({ referer: 'https://attacker.example/form' }),
    post({ 'sec-fetch-site': 'cross-site' }),
    post({ 'sec-fetch-mode': 'no-cors' }),
    request({ headers: { host: 'localhost:5177', cookie: 'example=value' } }),
  ])('rejects untrusted requests before any upstream translation', (input) => {
    expect(referenceApiBoundary(input, 'http:')?.status).toBe(403)
  })

  it.each(['/admin', '/api/v1/admin/content-review', '/api/v1/x/../admin', '//attacker.example/api', '/api/v1/%61dmin', '/api/v1/%2e%2e/admin', '/api/v1/%252fadmin', '/api\\v1\\admin'])('blocks unsafe or admin paths %s', (url) => {
    expect(referenceApiBoundary(request({ url }), 'http:')).not.toBeNull()
  })

  it('requires JSON for mutating requests and keeps media read-only', () => {
    expect(referenceApiBoundary(post({ 'content-type': 'application/x-www-form-urlencoded' }), 'http:')?.status).toBe(415)
    expect(referenceApiBoundary(post({}, '/media/content/movie/example.webp'), 'http:')?.status).toBe(405)
    expect(referenceApiBoundary(request({ url: '/media/content/movie/example.webp' }), 'http:')).toBeNull()
  })

  it('allows real guest play while blocking unsupported auth redirect flows', () => {
    expect(referenceApiBoundary(post({}, '/api/v1/auth/guest'), 'http:')).toBeNull()
    expect(referenceApiBoundary(post({ origin: 'https://foreign.example' }, '/api/v1/auth/guest'), 'http:')?.status).toBe(403)
    for (const url of ['/api/auth/sign-in/oauth2', '/api/auth/sign-up/email', '/api/auth/request-password-reset', '/api/auth/oauth2/callback/yandex']) {
      expect(referenceApiBoundary(post({}, url), 'http:')?.status).toBe(409)
    }
    expect(referenceApiBoundary(post({}, '/api/v1/client-events/batch'), 'http:')?.status).toBe(204)
    expect(referenceApiBoundary(post({}, '/api/v1/games/example/attempts'), 'http:')).toBeNull()
  })

  it('pins the verified upstream, preserves cookie attributes and streams SSE', () => {
    const options = createReferenceApiProxy()
    expect(options).toMatchObject({ target: 'https://shoditsa.ru', secure: true, followRedirects: false, timeout: 0, proxyTimeout: 0 })
    expect(options.cookieDomainRewrite).toBeUndefined()
    expect(options.cookiePathRewrite).toBeUndefined()
    const proxy = new EventEmitter()
    options.configure?.(proxy as never, options)
    const outgoing = { setHeader: vi.fn(), removeHeader: vi.fn() }
    proxy.emit('proxyReq', outgoing, request({ headers: { referer: 'http://localhost:5177/login?private=value' } }))
    expect(outgoing.setHeader).toHaveBeenCalledWith('Origin', 'https://shoditsa.ru')
    expect(outgoing.setHeader).toHaveBeenCalledWith('Referer', 'https://shoditsa.ru/')
    const cookie = '__Secure-shoditsa.session_token=test-only; Path=/; Secure; HttpOnly; SameSite=Lax'
    const response = { headers: { 'set-cookie': [cookie], 'content-type': 'text/event-stream', 'access-control-allow-origin': 'https://shoditsa.ru' } }
    proxy.emit('proxyRes', response)
    expect(response.headers['set-cookie']).toEqual([cookie])
    expect(response.headers['content-type']).toBe('text/event-stream')
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('does not silently accept a partial HTTPS setup', () => {
    expect(() => referenceApiDevProfile({ certificatePath: 'missing.pem' })).toThrow('both')
    expect(() => referenceApiDevProfile({ canonicalOrigin: true })).toThrow('trusted certificate')
    expect(referenceApiDevProfile().server).toMatchObject({ host: '127.0.0.1', port: 5177, strictPort: true, cors: false })
  })

  it('binds the unified review to its configured port without trusting other origins', () => {
    expect(referenceApiDevProfile({ port: 5180 }).server).toMatchObject({ host: '127.0.0.1', port: 5180, strictPort: true })
    const input = post({ host: '127.0.0.1:5180', origin: 'http://127.0.0.1:5180' }, '/api/v1/friends-rooms')
    expect(referenceApiBoundary(input, 'http:', false, 5180)).toBeNull()
    expect(referenceApiBoundary(input, 'http:')?.status).toBe(403)
    expect(referenceApiBoundary(post(), 'http:', false, 5180)?.status).toBe(403)
    expect(referenceApiBoundary({ ...input, headers: { ...input.headers, origin: 'http://localhost:5180' } }, 'http:', false, 5180)?.status).toBe(403)
    for (const port of [0, -1, 65536, Number.NaN, 5180.5]) expect(() => referenceApiDevProfile({ port })).toThrow('Invalid')
  })

  it('allows unmodified Yandex start and callback only on the exact HTTPS origin', () => {
    const start = post({ host: 'shoditsa.ru', origin: 'https://shoditsa.ru' }, '/api/auth/sign-in/oauth2')
    expect(referenceApiBoundary(start, 'https:', true)).toBeNull()
    expect(referenceApiBoundary(start, 'http:', true)?.status).toBe(403)
    expect(referenceApiBoundary(post({ host: 'shoditsa.ru', origin: 'http://localhost:5177' }), 'https:', true)?.status).toBe(403)
    const callback = request({
      url: '/api/auth/oauth2/callback/yandex?code=test-code&state=test-state',
      headers: { host: 'shoditsa.ru', referer: 'https://passport.yandex.ru/', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', cookie: 'synthetic-state=only-for-tests' },
    })
    expect(referenceApiBoundary(callback, 'https:', true)).toBeNull()
    expect(referenceApiBoundary({ ...callback, method: 'POST' }, 'https:', true)?.status).toBe(403)
    expect(referenceApiBoundary({ ...callback, url: '/api/v1/me' }, 'https:', true)?.status).toBe(403)
    expect(referenceApiBoundary({ ...callback, headers: { ...callback.headers, host: 'localhost:5178' } }, 'https:', true)?.status).toBe(403)
  })

  it('validates HTTP/2 authority with the same exact host rules as HTTP/1', () => {
    const h2 = request({ headers: { ':authority': 'shoditsa.ru', origin: 'https://shoditsa.ru' } })
    expect(referenceApiBoundary(h2, 'https:', true)).toBeNull()
    expect(referenceApiBoundary({ ...h2, method: 'POST', url: '/api/auth/sign-in/oauth2' }, 'https:', true)).toBeNull()
    expect(referenceApiBoundary(request({ url: '/login', headers: { ':authority': 'shoditsa.ru:443' } }), 'https:', true)).toBeNull()
    for (const headers of [
      { ':authority': 'attacker.example' },
      { ':authority': 'localhost:5178' },
      { ':authority': 'shoditsa.ru', host: 'attacker.example' },
      { ':authority': 'attacker.example', host: 'shoditsa.ru' },
    ]) expect(referenceApiBoundary(request({ headers }), 'https:', true)?.code).toBe('REFERENCE_API_LOCAL_ONLY')
    expect(referenceApiBoundary(request({ headers: { ':authority': 'localhost:5177' } }), 'https:')).toBeNull()
  })

  it('keeps canonical OAuth headers, redirects and cookies unchanged, redacting error URLs', () => {
    const options = createReferenceApiProxy(true)
    const proxy = new EventEmitter()
    options.configure?.(proxy as never, options)
    const outgoing = { setHeader: vi.fn(), removeHeader: vi.fn() }
    proxy.emit('proxyReq', outgoing, request({ headers: { origin: 'https://shoditsa.ru', referer: 'https://shoditsa.ru/login' } }))
    expect(outgoing.setHeader).not.toHaveBeenCalled()
    const headers = { location: 'https://shoditsa.ru/login', 'set-cookie': ['__Secure-shoditsa.session_token=synthetic; Secure; HttpOnly; SameSite=Lax'] }
    proxy.emit('proxyRes', { headers })
    expect(headers.location).toBe('https://shoditsa.ru/login')
    expect(headers['set-cookie'][0]).toContain('Secure; HttpOnly; SameSite=Lax')
    const callback = request({ url: '/api/auth/oauth2/callback/yandex?code=synthetic-sensitive&state=synthetic-state' })
    const error = new Error('synthetic-sensitive')
    proxy.emit('error', error, callback)
    expect(callback.url).toBe('/api/auth/oauth2/callback/yandex')
    expect(error.stack).not.toContain('synthetic-sensitive')
  })
})

describe('Vite preview selection', () => {
  afterEach(() => vi.unstubAllEnvs())
  const configure = async (mode: string, command: 'serve' | 'build' = 'serve') => {
    if (typeof viteConfig !== 'function') throw new Error('Expected a Vite config function')
    return viteConfig({ mode, command, isSsrBuild: false, isPreview: false })
  }

  it('keeps ordinary dev and autonomous 5176 launch configuration unchanged', async () => {
    vi.stubEnv('VITE_REFERENCE_API', '0')
    vi.stubEnv('VITE_LOCAL_REDESIGN', '0')
    vi.stubEnv('VITE_API_PROXY_TARGET', '')
    vi.stubEnv('REFERENCE_API_CANONICAL_ORIGIN', '0')
    const ordinary = await configure('development')
    expect(ordinary.server?.port).toBe(5173)
    expect(ordinary.server?.proxy).toEqual({ '/api': 'http://127.0.0.1:3001' })
    vi.stubEnv('VITE_LOCAL_REDESIGN', '1')
    const offline = await configure('yandex')
    expect(offline.base).toBe('./')
    expect(offline.server?.https).toBeUndefined()
    expect(offline.plugins?.some((plugin) => plugin && 'name' in plugin && plugin.name === 'reference-api-local-boundary')).toBe(false)
  })

  it('enables the production proxy only in explicitly selected server dev mode', async () => {
    vi.stubEnv('VITE_REFERENCE_API', '1')
    vi.stubEnv('VITE_LOCAL_REDESIGN', '0')
    vi.stubEnv('REFERENCE_API_CERT', '')
    vi.stubEnv('REFERENCE_API_KEY', '')
    vi.stubEnv('REFERENCE_API_CANONICAL_ORIGIN', '0')
    expect((await configure('reference-api')).server?.port).toBe(5177)
    expect((await configure('reference-api', 'build')).server?.port).toBe(5173)
    await expect(configure('yandex')).rejects.toThrow('server mode')
    vi.stubEnv('VITE_LOCAL_REDESIGN', '1')
    await expect(configure('reference-api')).rejects.toThrow('server mode')
  })
})
