import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ me: vi.fn(), guest: vi.fn() }))
vi.mock('../api/client', () => ({
  api: mocks,
  queryKeys: { me: ['me'], dashboard: ['dashboard'] },
  ApiClientError: class extends Error {
    constructor(public status: number, public code: string, message: string) { super(message) }
  },
}))

describe('reference API session initialization', () => {
  beforeEach(() => { vi.resetModules(); mocks.me.mockReset(); mocks.guest.mockReset() })
  afterEach(() => vi.unstubAllEnvs())

  it('initializes a real guest in connected review, just like the hosted site', async () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_REFERENCE_API', '1')
    const { ApiClientError } = await import('../api/client')
    const error = new ApiClientError(401, 'AUTH_REQUIRED', 'Sign in')
    mocks.me.mockRejectedValueOnce(error).mockResolvedValueOnce({ user: { id: 'guest-example', isAnonymous: true } })
    const { ensureServerSession } = await import('./use-server-runtime')
    await expect(ensureServerSession()).resolves.toEqual({ user: { id: 'guest-example', isAnonymous: true } })
    expect(mocks.guest).toHaveBeenCalledTimes(1)
    expect(mocks.me).toHaveBeenCalledTimes(2)
  })

  it('preserves ordinary guest initialization outside the connected preview', async () => {
    vi.stubEnv('VITE_REFERENCE_API', '0')
    const { ApiClientError } = await import('../api/client')
    mocks.me.mockRejectedValueOnce(new ApiClientError(401, 'AUTH_REQUIRED', 'Sign in')).mockResolvedValueOnce({ user: { id: 'example' } })
    const { ensureServerSession } = await import('./use-server-runtime')
    await expect(ensureServerSession()).resolves.toEqual({ user: { id: 'example' } })
    expect(mocks.guest).toHaveBeenCalledTimes(1)
  })
})
