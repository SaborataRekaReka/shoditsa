import { ProxyAgent, fetch as undiciFetch } from 'undici'

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:'])

export const normalizeOpenAiProxyUrl = (value) => {
  const input = String(value ?? '').trim()
  if (!input) throw new Error('OpenAI proxy URL is empty')
  let parsed
  try { parsed = new URL(input) }
  catch { throw new Error('OpenAI proxy URL is invalid') }
  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) throw new Error('OpenAI proxy URL must use http:// or https://')
  if (!parsed.hostname) throw new Error('OpenAI proxy URL must include a hostname')
  return parsed.toString()
}

export const createOpenAiProxyTransport = (value, dependencies = {}) => {
  if (!String(value ?? '').trim()) return null
  const ProxyAgentImpl = dependencies.ProxyAgentImpl ?? ProxyAgent
  const undiciFetchImpl = dependencies.undiciFetchImpl ?? undiciFetch
  const proxyUrl = normalizeOpenAiProxyUrl(value)
  const dispatcher = new ProxyAgentImpl(proxyUrl)
  return {
    fetchImpl: (input, init = {}) => undiciFetchImpl(input, { ...init, dispatcher }),
    close: () => dispatcher.close(),
    proxyUrl,
  }
}

const configuredProxy = process.env.OPENAI_OUTBOUND_PROXY_URL?.trim()
  || process.env.MUSIC_OUTBOUND_PROXY_URL?.trim()
  || ''
let transport = null
let configurationError = null
if (configuredProxy) {
  try { transport = createOpenAiProxyTransport(configuredProxy) }
  catch { configurationError = new Error('openai_proxy_configuration_invalid') }
}

export const openAiFetch = (input, init = {}) => {
  if (configurationError) throw configurationError
  return transport ? transport.fetchImpl(input, init) : fetch(input, init)
}

export const openAiTransportMode = transport ? 'proxy' : configuredProxy ? 'proxy_invalid' : 'direct'
