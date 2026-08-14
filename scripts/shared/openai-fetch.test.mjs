import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenAiProxyTransport, normalizeOpenAiProxyUrl, stabilizeOpenAiProxyUrl } from './openai-fetch.mjs'
import { createOpenAiWebSearchTool, isOpenAiWebSearchRegionalError, isTransientOpenAiError, requestOpenAiWithRetry } from './openai-web-search.mjs'

test('OpenAI proxy accepts authenticated HTTP URLs and rejects unsupported protocols', () => {
  assert.equal(normalizeOpenAiProxyUrl('http://user:password@proxy.example:12321'), 'http://user:password@proxy.example:12321/')
  assert.throws(() => normalizeOpenAiProxyUrl('socks5://proxy.example:1080'), /http:\/\/ or https:\/\//)
})

test('OpenAI transport sends requests through the configured dispatcher', async () => {
  let createdUrl = null
  let capturedInit = null
  const fakeDispatcher = { close: async () => {} }
  class FakeProxyAgent {
    constructor(url) { createdUrl = url; return fakeDispatcher }
  }
  const transport = createOpenAiProxyTransport('http://user:password@proxy.example:12321', {
    ProxyAgentImpl: FakeProxyAgent,
    undiciFetchImpl: async (_input, init) => { capturedInit = init; return new Response('{}', { status: 200 }) },
  })
  const response = await transport.fetchImpl('https://api.openai.com/v1/responses', { method: 'POST' })
  assert.equal(response.status, 200)
  assert.equal(createdUrl, 'http://user:password@proxy.example:12321/')
  assert.equal(capturedInit.dispatcher, fakeDispatcher)
  assert.equal(capturedInit.method, 'POST')
})

test('OpenAI transport stays direct when no proxy is configured', () => {
  assert.equal(createOpenAiProxyTransport(''), null)
})

test('OpenAI transport pins IPRoyal to a supported country and sticky session', async () => {
  let createdUrl = null
  const fakeDispatcher = { close: async () => {} }
  class FakeProxyAgent {
    constructor(url) { createdUrl = url; return fakeDispatcher }
  }
  const transport = createOpenAiProxyTransport('http://user:password@geo.iproyal.com:12321', {
    ProxyAgentImpl: FakeProxyAgent,
    undiciFetchImpl: async () => new Response('{}', { status: 200 }),
    stabilizeIproyal: { country: 'de', sessionId: 'Factcheck01', lifetime: '24h' },
  })
  assert.equal(createdUrl, 'http://user:password_country-de_session-Factcheck01_lifetime-24h@geo.iproyal.com:12321/')
  await transport.close()
})

test('IPRoyal stabilization replaces a stale session while leaving other proxies unchanged', () => {
  assert.equal(
    stabilizeOpenAiProxyUrl('http://user:password_country-us_session-Old123_lifetime-24h@geo.iproyal.com:12321', { country: 'de', sessionId: 'New456' }),
    'http://user:password_country-de_session-New456_lifetime-24h@geo.iproyal.com:12321/',
  )
  assert.equal(
    stabilizeOpenAiProxyUrl('http://user:password@proxy.example:12321', { country: 'de', sessionId: 'New456' }),
    'http://user:password@proxy.example:12321/',
  )
})

test('OpenAI web search retries safely with cache-only search after a regional refusal', () => {
  assert.deepEqual(createOpenAiWebSearchTool(), { type: 'web_search', search_context_size: 'low' })
  assert.deepEqual(createOpenAiWebSearchTool({ cacheOnly: true }), { type: 'web_search', search_context_size: 'low', external_web_access: false })
  assert.equal(isOpenAiWebSearchRegionalError(new Error('Country, region, or territory is not supported')), true)
  assert.equal(isOpenAiWebSearchRegionalError(new Error('OpenAI HTTP 429')), false)
})

test('OpenAI requests retry transient failures but not authentication failures', async () => {
  assert.equal(isTransientOpenAiError(new Error('The operation was aborted due to timeout')), true)
  let attempts = 0
  const delays = []
  const result = await requestOpenAiWithRetry(async () => {
    attempts += 1
    if (attempts < 3) throw new Error('fetch failed')
    return 'ok'
  }, { baseDelayMs: 10, waitForRetry: async (delay) => delays.push(delay) })
  assert.equal(result, 'ok')
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [10, 20])

  attempts = 0
  await assert.rejects(() => requestOpenAiWithRetry(async () => {
    attempts += 1
    throw new Error('OpenAI HTTP 401')
  }, { waitForRetry: async () => {} }), /OpenAI HTTP 401/)
  assert.equal(attempts, 1)
})
