import { describe, expect, it, vi } from 'vitest'
import { probeMusicSourceHealth } from '../src/modules/admin/music-source-health.js'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

describe('music source health probe', () => {
  it('disables unavailable and unconfigured optional sources without exposing credentials', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('musicbrainz')) throw new Error('connect timeout')
      if (url.includes('audioscrobbler')) return json({ error: 11, message: 'Access Denied' }, 403)
      if (url.includes('accounts.spotify')) return json({ access_token: 'temporary-token' })
      if (url.includes('api.spotify')) return json({ error: { message: 'Spotify is unavailable in this country' } }, 403)
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    const result = await probeMusicSourceHealth({ LASTFM_API_KEY: 'secret', SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' }, fetchImpl)
    expect(result.disabledSources).toEqual(['musicbrainz', 'lastfm', 'theaudiodb', 'spotify'])
    expect(result.sources.lastfm.reason).toBe('Access Denied')
    expect(result.sources.spotify.reason).toContain('unavailable in this country')
    expect(JSON.stringify(result)).not.toContain('temporary-token')
  })

  it('keeps healthy configured sources enabled', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('musicbrainz')) return json({ artists: [{ id: 'mbid' }] })
      if (url.includes('audioscrobbler')) return json({ artist: { name: 'Rihanna' } })
      if (url.includes('theaudiodb')) return json({ artists: [{ idArtist: '1' }] })
      if (url.includes('accounts.spotify')) return json({ access_token: 'temporary-token' })
      if (url.includes('api.spotify')) return json({ artists: { items: [] } })
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    const result = await probeMusicSourceHealth({ LASTFM_API_KEY: 'key', THEAUDIODB_API_KEY: 'key', SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' }, fetchImpl)
    expect(result.disabledSources).toEqual([])
    expect(result.transport).toBe('direct')
  })

  it('fails closed when a configured proxy URL is invalid', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const result = await probeMusicSourceHealth({ MUSIC_OUTBOUND_PROXY_URL: 'socks5://untrusted.invalid:1080' }, fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.transport).toBe('proxy_invalid')
    expect(result.disabledSources).toEqual(['musicbrainz', 'lastfm', 'theaudiodb', 'spotify'])
    expect(JSON.stringify(result)).not.toContain('untrusted.invalid')
  })
})
