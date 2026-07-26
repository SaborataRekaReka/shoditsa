import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applySeriesProfileChanges,
  buildSeriesProfileChanges,
  isSeriesDetails,
  sameJsonValue,
  seasonProfile,
  summarizeSeriesProfileUpdates,
} from './profile-enrichment.mjs'

test('accepts Kinopoisk series types even when MINI_SERIES has serial=false', () => {
  assert.equal(isSeriesDetails({ type: 'TV_SERIES', serial: true }), true)
  assert.equal(isSeriesDetails({ type: 'MINI_SERIES', serial: false }), true)
  assert.equal(isSeriesDetails({ type: 'FILM', serial: false }), false)
})

test('counts seasons and episodes from the seasons endpoint', () => {
  assert.deepEqual(seasonProfile({
    total: 2,
    items: [
      { number: 1, episodes: [{}, {}, {}] },
      { number: 2, episodes: [{}, {}] },
    ],
  }), { seasonsCount: 2, episodes: 5 })
  assert.deepEqual(seasonProfile({ total: 1, items: [{ number: 1, episodes: [] }] }), {
    seasonsCount: 1,
    episodes: null,
  })
})

test('refreshes objective series fields and only fills optional empty fields', () => {
  const payload = {
    seasonsCount: 1,
    seriesStatus: 'Еще выходит',
    slogan: 'Уже заполнен',
    backdropUrl: null,
    supportingCast: [],
    dataQuality: { source: ['catalog'], verified: true, missingFields: [] },
  }
  const changes = buildSeriesProfileChanges({
    payload,
    details: {
      type: 'TV_SERIES',
      completed: true,
      endYear: 2024,
      slogan: 'Не перезаписывать',
      coverUrl: 'https://example.test/cover.jpg',
    },
    seasons: {
      total: 2,
      items: [
        { episodes: [{}, {}] },
        { episodes: [{}, {}, {}] },
      ],
    },
    staff: [
      ...Array.from({ length: 5 }, (_, index) => ({ professionKey: 'ACTOR', nameRu: `Главный ${index}` })),
      { professionKey: 'ACTOR', nameRu: 'Второстепенный', nameEn: 'Supporting', posterUrl: 'https://example.test/person.jpg' },
    ],
  })

  assert.deepEqual(changes.map((change) => change.field), [
    'episodes',
    'seasonsCount',
    'seriesStatus',
    'endYear',
    'backdropUrl',
    'supportingCast',
  ])
  const updated = applySeriesProfileChanges(payload, changes)
  assert.equal(updated.slogan, 'Уже заполнен')
  assert.equal(updated.episodes, 5)
  assert.equal(updated.seasonsCount, 2)
  assert.equal(updated.seriesStatus, 'Закончен')
  assert.equal(updated.backdropUrl, 'https://example.test/cover.jpg')
  assert.deepEqual(updated.supportingCast, [{
    nameRu: 'Второстепенный',
    nameOriginal: 'Supporting',
    photoUrl: 'https://example.test/person.jpg',
  }])
  assert.deepEqual(updated.dataQuality.source, [
    'catalog',
    'series_profile_kinopoisk_seasons',
    'series_profile_kinopoisk_details',
    'series_profile_kinopoisk_staff',
  ])
})

test('summarizes changed fields deterministically', () => {
  assert.deepEqual(summarizeSeriesProfileUpdates([
    { changes: [{ field: 'episodes' }, { field: 'seasonsCount' }] },
    { changes: [{ field: 'episodes' }] },
  ]), { episodes: 2, seasonsCount: 1 })
})

test('compares JSON objects independently of PostgreSQL jsonb key ordering', () => {
  assert.equal(sameJsonValue(
    { nameRu: 'Актёр', nameOriginal: 'Actor', photoUrl: null },
    { photoUrl: null, nameOriginal: 'Actor', nameRu: 'Актёр' },
  ), true)
  assert.equal(sameJsonValue([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]), false)
})
