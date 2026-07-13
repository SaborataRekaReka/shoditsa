import { createMusicProxyTransport } from './music-proxy.js'

type SourceState = 'ok' | 'unavailable' | 'not_configured'
type SourceHealth = { state: SourceState; reason: string | null; httpStatus: number | null }
type HealthMap = Record<'musicbrainz' | 'lastfm' | 'theaudiodb' | 'spotify', SourceHealth>

const unavailable = (reason: unknown, httpStatus: number | null = null): SourceHealth => ({
  state: 'unavailable', reason: String(reason ?? 'request_failed').replace(/\s+/g, ' ').slice(0, 240), httpStatus,
})
const notConfigured = (): SourceHealth => ({ state: 'not_configured', reason: 'not_configured', httpStatus: null })
const ok = (httpStatus = 200): SourceHealth => ({ state: 'ok', reason: null, httpStatus })

const request = async (fetchImpl: typeof fetch, url: string, options: RequestInit = {}, timeoutMs = 10_000) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetchImpl(url, { ...options, signal: controller.signal }) }
  finally { clearTimeout(timeout) }
}

const json = async (response: Response) => response.json().catch(() => null) as Promise<Record<string, any> | null>

export const probeMusicSourceHealth = async (environment: Record<string, string>, fetchImpl: typeof fetch = fetch) => {
  let proxyTransport: ReturnType<typeof createMusicProxyTransport> = null
  if (environment.MUSIC_OUTBOUND_PROXY_URL) {
    try { proxyTransport = createMusicProxyTransport(environment.MUSIC_OUTBOUND_PROXY_URL) }
    catch {
      const proxyFailure = unavailable('proxy_configuration_invalid')
      const sources: HealthMap = { musicbrainz: proxyFailure, lastfm: proxyFailure, theaudiodb: proxyFailure, spotify: proxyFailure }
      return { sources, disabledSources: Object.keys(sources), transport: 'proxy_invalid' as const }
    }
  }
  const sourceFetch = proxyTransport?.fetchImpl ?? fetchImpl
  const userAgent = environment.MUSICBRAINZ_USER_AGENT || 'Shoditsa/1.0 (https://shoditsa.ru; mailto:breneize@yandex.ru)'
  const musicbrainz = async (): Promise<SourceHealth> => {
    try {
      const response = await request(sourceFetch, 'https://musicbrainz.org/ws/2/artist/?query=artist%3ARihanna&fmt=json', { headers: { Accept: 'application/json', 'User-Agent': userAgent } })
      const payload = await json(response)
      return response.ok && Array.isArray(payload?.artists) ? ok(response.status) : unavailable(payload?.error ?? `HTTP ${response.status}`, response.status)
    } catch (error) { return unavailable(error instanceof Error ? error.message : error) }
  }
  const lastfm = async (): Promise<SourceHealth> => {
    if (!environment.LASTFM_API_KEY) return notConfigured()
    const params = new URLSearchParams({ method: 'artist.getinfo', artist: 'Rihanna', api_key: environment.LASTFM_API_KEY, format: 'json', autocorrect: '1' })
    try {
      const response = await request(sourceFetch, `https://ws.audioscrobbler.com/2.0/?${params}`)
      const payload = await json(response)
      return response.ok && !payload?.error ? ok(response.status) : unavailable(payload?.message ?? `HTTP ${response.status}`, response.status)
    } catch (error) { return unavailable(error instanceof Error ? error.message : error) }
  }
  const theaudiodb = async (): Promise<SourceHealth> => {
    if (!environment.THEAUDIODB_API_KEY) return notConfigured()
    try {
      const response = await request(sourceFetch, `https://www.theaudiodb.com/api/v1/json/${encodeURIComponent(environment.THEAUDIODB_API_KEY)}/search.php?s=Rihanna`)
      const payload = await json(response)
      return response.ok && Array.isArray(payload?.artists) ? ok(response.status) : unavailable(`HTTP ${response.status} or invalid JSON`, response.status)
    } catch (error) { return unavailable(error instanceof Error ? error.message : error) }
  }
  const spotify = async (): Promise<SourceHealth> => {
    if (!environment.SPOTIFY_CLIENT_ID || !environment.SPOTIFY_CLIENT_SECRET) return notConfigured()
    try {
      const tokenResponse = await request(sourceFetch, 'https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${environment.SPOTIFY_CLIENT_ID}:${environment.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })
      const tokenPayload = await json(tokenResponse)
      if (!tokenResponse.ok || !tokenPayload?.access_token) return unavailable(tokenPayload?.error_description ?? tokenPayload?.error ?? `HTTP ${tokenResponse.status}`, tokenResponse.status)
      const searchResponse = await request(sourceFetch, 'https://api.spotify.com/v1/search?q=artist%3ARihanna&type=artist&limit=1', {
        headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
      })
      const searchPayload = await json(searchResponse)
      return searchResponse.ok ? ok(searchResponse.status) : unavailable(searchPayload?.error?.message ?? `HTTP ${searchResponse.status}`, searchResponse.status)
    } catch (error) { return unavailable(error instanceof Error ? error.message : error) }
  }

  try {
    const [musicbrainzResult, lastfmResult, theaudiodbResult, spotifyResult] = await Promise.all([musicbrainz(), lastfm(), theaudiodb(), spotify()])
    const sources: HealthMap = { musicbrainz: musicbrainzResult, lastfm: lastfmResult, theaudiodb: theaudiodbResult, spotify: spotifyResult }
    return {
      sources,
      disabledSources: Object.entries(sources).filter(([, health]) => health.state !== 'ok').map(([source]) => source),
      transport: proxyTransport ? 'proxy' as const : 'direct' as const,
    }
  } finally {
    await proxyTransport?.close()
  }
}
