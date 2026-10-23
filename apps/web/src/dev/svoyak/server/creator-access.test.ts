import { describe, expect, it, vi } from 'vitest'
import { assertClubRoomCreator } from './creator-access'
import { referenceApiBoundary } from '../../reference-api-proxy'
const request = { headers: { host: '127.0.0.1:5180', cookie: 'session=example' } }
describe('Svoyak server creation access', () => {
  it('rejects an anonymous creator before contacting the account API', async () => {
    const read = vi.fn()
    await expect(assertClubRoomCreator({ headers: { host: request.headers.host } }, read)).rejects.toMatchObject({ code: 'CLUB_REQUIRED', status: 403 })
    expect(read).not.toHaveBeenCalled()
  })
  it('accepts only an active membership returned by the trusted account API', async () => {
    const read = vi.fn().mockResolvedValue(new Response(JSON.stringify({ membership: { active: true } })))
    await expect(assertClubRoomCreator(request, read)).resolves.toBeUndefined()
    expect(read).toHaveBeenCalledWith('http://127.0.0.1:5180/api/v1/me/commerce', expect.objectContaining({ headers: { Cookie: 'session=example', Accept: 'application/json', Origin: 'http://127.0.0.1:5180' }, redirect: 'error' }))
  })
  it.each([false, undefined, 'true'])('rejects inactive or malformed membership (%s)', async active => {
    const read = vi.fn().mockResolvedValue(new Response(JSON.stringify({ membership: { active } })))
    await expect(assertClubRoomCreator(request, read)).rejects.toMatchObject({ code: 'CLUB_REQUIRED', status: 403 })
  })
  it('fails closed when the account API is unavailable', async () => {
    const read = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(assertClubRoomCreator(request, read)).rejects.toMatchObject({ code: 'ACCESS_UNAVAILABLE', status: 503 })
  })
  it('keeps the membership check compatible with the connected preview origin boundary', async () => {
    const read = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = Object.fromEntries(new Headers(init?.headers))
      expect(referenceApiBoundary({ method: 'GET', url: new URL(String(url)).pathname, headers: { ...headers, host: request.headers.host }, socket: { remoteAddress: '127.0.0.1' } }, 'http:', false, 5180)).toBeNull()
      return new Response(JSON.stringify({ membership: { active: true } }))
    })
    await expect(assertClubRoomCreator(request, read)).resolves.toBeUndefined()
  })
  it('does not forward a cookie to an untrusted host', async () => {
    const read = vi.fn()
    await expect(assertClubRoomCreator({ headers: { ...request.headers, host: 'external.test' } }, read)).rejects.toMatchObject({ code: 'LOCAL_ONLY' })
    expect(read).not.toHaveBeenCalled()
  })
})
