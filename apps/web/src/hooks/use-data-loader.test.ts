import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJsonCached } from './use-data-loader'

afterEach(() => vi.unstubAllGlobals())

describe('data loader request cache', () => {
  it('evicts a failed request so the same library can recover without a reload', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('temporary deploy interruption'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJsonCached<{ ready: boolean }>('./data/test-recovery.json')).rejects.toThrow('temporary deploy interruption')
    await expect(fetchJsonCached<{ ready: boolean }>('./data/test-recovery.json')).resolves.toEqual({ ready: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
