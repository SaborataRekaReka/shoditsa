import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenAiProxyTransport, normalizeOpenAiProxyUrl } from './openai-fetch.mjs'

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
