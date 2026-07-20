import { describe, expect, it } from 'vitest'
import { CONTENT_MODE_IDS } from '@shoditsa/contracts'
import { loadReleaseLibraries } from '../src/modules/admin/release-content-loader.js'

describe('release content catalog', () => {
  it('loads the deployable catalog as one validated revision source', async () => {
    const release = await loadReleaseLibraries('./public/data/libraries')
    expect(release.libraries.map((library) => library.mode)).toEqual([...CONTENT_MODE_IDS])
    expect(release.manifest.totalItems).toBe(release.libraries.reduce((total, library) => total + library.items.length, 0))
    expect(release.manifest.checksumSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.values(release.manifest.modes).every((mode) => mode.count > 0)).toBe(true)
    const anime = release.libraries.find((library) => library.mode === 'anime')!
    expect(anime.items.every((item) => !item.facts?.length)).toBe(true)
  })
})
