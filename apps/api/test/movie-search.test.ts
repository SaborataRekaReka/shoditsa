import { describe, expect, it, vi } from 'vitest'
import { searchKinopoiskMovie } from '../src/modules/admin/movie-search.js'

describe('Kinopoisk movie search', () => {
  it('prefers an exact movie title and requested year', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ films: [
      { filmId: 1, nameRu: 'Бэтмен', nameEn: 'Batman', year: '1989', type: 'FILM' },
      { filmId: 2, nameRu: 'Бэтмен', nameEn: 'The Batman', year: '2022', type: 'FILM' },
      { filmId: 3, nameRu: 'Бэтмен', year: '2022', type: 'TV_SERIES' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(searchKinopoiskMovie('Бэтмен', 2022, 'test-key', fetchImpl)).resolves.toEqual({
      kinopoiskId: 2,
      title: 'Бэтмен',
      year: 2022,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('returns null when no film matches the requested year', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ films: [
      { filmId: 1, nameRu: 'Бэтмен', year: '1989', type: 'FILM' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(searchKinopoiskMovie('Бэтмен', 2022, 'test-key', fetchImpl)).resolves.toBeNull()
  })

  it('rotates to the next API key after a limited key', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ films: [
        { filmId: 2, nameRu: 'Бэтмен', year: '2022', type: 'FILM' },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(searchKinopoiskMovie('Бэтмен', 2022, 'first,second', fetchImpl)).resolves.toMatchObject({ kinopoiskId: 2 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
