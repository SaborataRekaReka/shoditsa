import { describe, expect, it } from 'vitest'
import { entryCoverUrl, CATALOG_ENTRY_PRESENTATION } from './catalog-entry-presentation'
import covers from './catalog-entry-covers.json'

describe('catalog entry media boundary', () => {
  it('uses public library files in the autonomous preview and the media proxy in the connected preview', () => {
    const source = './data/libraries/anime/img/posters/42.webp'
    expect(entryCoverUrl('anime', source, true)).toMatch(/\/data\/libraries\/anime\/img\/posters\/42\.webp$/)
    expect(entryCoverUrl('anime', source, false)).toBe('/media/content/anime/posters/42.webp')
    expect(entryCoverUrl('book', '/data/libraries/books/img/covers/a.webp', false)).toBe('/media/content/book/covers/a.webp')
  })

  it('keeps existing external media intact and permits title-only cards', () => {
    expect(entryCoverUrl('music', 'https://example.com/artist.webp', false)).toBe('https://example.com/artist.webp')
    expect(entryCoverUrl('diagnosis', undefined, false)).toBeUndefined()
    expect(entryCoverUrl('movie', '/images/home-doodle/movie.webp', false)).toMatch(/\/images\/home-doodle\/movie\.webp$/)
  })

  it('ships public teasers for every supported title mode without game answers or comparison attributes', () => {
    expect(Object.keys(covers).sort()).toEqual(Object.keys(CATALOG_ENTRY_PRESENTATION).sort())
    for (const entries of Object.values(covers)) {
      expect(entries.length).toBeGreaterThan(0)
      expect(new Set(entries.map(entry => entry.title)).size).toBe(entries.length)
      for (const entry of entries) {
        expect(entry.title.trim().length).toBeGreaterThan(0)
        expect(Object.keys(entry).every(key => ['title', 'src', 'fit'].includes(key))).toBe(true)
      }
    }
  })
})
