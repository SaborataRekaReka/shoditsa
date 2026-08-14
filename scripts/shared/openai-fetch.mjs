import { randomBytes } from 'node:crypto'
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

const IPROYAL_HOST = /(^|\.)iproyal\.com$/i
const IPROYAL_COUNTRY = /_country-[a-z]{2}(?=_|$)/i
const IPROYAL_SESSION = /_session-[a-z0-9]+(?=_|$)/i
const IPROYAL_LIFETIME = /_lifetime-[a-z0-9]+(?=_|$)/i
const safeSessionId = (value) => String(value ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 32)

export const stabilizeOpenAiProxyUrl = (value, options = {}) => {
  const normalized = normalizeOpenAiProxyUrl(value)
  const parsed = new URL(normalized)
  if (!IPROYAL_HOST.test(parsed.hostname) || !parsed.password) return normalized

  const country = String(options.country ?? 'de').trim().toLowerCase()
  if (!/^[a-z]{2}$/.test(country)) throw new Error('OpenAI proxy country must be a two-letter code')
  const sessionId = safeSessionId(options.sessionId) || randomBytes(8).toString('hex')
  const lifetime = String(options.lifetime ?? '24h').trim().toLowerCase()
  if (!/^\d+(?:s|m|h|d)$/.test(lifetime)) throw new Error('OpenAI proxy lifetime is invalid')

  let password = decodeURIComponent(parsed.password)
  password = IPROYAL_COUNTRY.test(password)
    ? password.replace(IPROYAL_COUNTRY, `_country-${country}`)
    : `${password}_country-${country}`
  password = IPROYAL_SESSION.test(password)
    ? password.replace(IPROYAL_SESSION, `_session-${sessionId}`)
    : `${password}_session-${sessionId}`
  if (!IPROYAL_LIFETIME.test(password)) password = `${password}_lifetime-${lifetime}`
  parsed.password = password
  return parsed.toString()
}

export const createOpenAiProxyTransport = (value, dependencies = {}) => {
  if (!String(value ?? '').trim()) return null
  const ProxyAgentImpl = dependencies.ProxyAgentImpl ?? ProxyAgent
  const undiciFetchImpl = dependencies.undiciFetchImpl ?? undiciFetch
  const proxyUrl = dependencies.stabilizeIproyal
    ? stabilizeOpenAiProxyUrl(value, dependencies.stabilizeIproyal)
    : normalizeOpenAiProxyUrl(value)
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
