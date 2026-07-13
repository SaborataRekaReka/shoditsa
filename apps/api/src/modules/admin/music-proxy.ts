import { ProxyAgent, fetch as undiciFetch } from 'undici'

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:'])

export const normalizeMusicProxyUrl = (value: string) => {
  const input = value.trim()
  if (!input) throw new Error('Proxy URL is empty')
  let parsed: URL
  try { parsed = new URL(input) }
  catch { throw new Error('Proxy URL is invalid') }
  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) throw new Error('Proxy URL must use http:// or https://')
  if (!parsed.hostname) throw new Error('Proxy URL must include a hostname')
  return parsed.toString()
}

export const createMusicProxyTransport = (value: string | undefined) => {
  if (!value?.trim()) return null
  const proxyUrl = normalizeMusicProxyUrl(value)
  const dispatcher = new ProxyAgent(proxyUrl)
  const fetchImpl = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => (
    undiciFetch(input as never, { ...init, dispatcher } as never) as unknown as Promise<Response>
  )) as typeof fetch
  return {
    fetchImpl,
    close: () => dispatcher.close(),
  }
}
