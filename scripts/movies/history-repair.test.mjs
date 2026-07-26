import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyMovieHistoryChanges,
  buildMovieHistoryChanges,
  localizeProductionMedia,
  summarizeMovieHistoryUpdates,
  validPeople,
} from './history-repair.mjs'

const director = {
  nameRu: 'Режиссёр',
  nameOriginal: 'Director',
  photoUrl: '/media/people/aa/person.webp',
}
const writer = {
  nameRu: 'Сценарист',
  nameOriginal: 'Writer',
  photoUrl: '/media/people/bb/writer.webp',
}

test('restores historical people and removes stale series metadata from a movie', () => {
  const payload = {
    id: 'kp_1',
    mode: 'movie',
    directors: [],
    writers: [],
    showrunners: [writer],
    seriesStatus: 'Еще выходит',
    dataQuality: {
      source: ['kinopoisk_api_staff', 'series_status_fallback'],
      verified: true,
      missingFields: [],
    },
  }
  const changes = buildMovieHistoryChanges({
    payload,
    historicalDirectors: [director],
    historicalWriters: [writer],
    directorSource: { revisionId: 'directors-revision' },
    writerSource: { revisionId: 'writers-revision' },
  })
  assert.deepEqual(changes.map((change) => `${change.field}:${change.operation}`), [
    'directors:set',
    'writers:set',
    'seriesStatus:delete',
    'showrunners:set',
    'dataQuality:set',
  ])

  const updated = applyMovieHistoryChanges(payload, changes)
  assert.deepEqual(updated.directors, [director])
  assert.deepEqual(updated.writers, [writer])
  assert.deepEqual(updated.showrunners, [])
  assert.equal(Object.hasOwn(updated, 'seriesStatus'), false)
  assert.deepEqual(updated.dataQuality.source, ['kinopoisk_api_staff'])
})

test('rejects historical people arrays without a usable name', () => {
  assert.equal(validPeople([]), false)
  assert.equal(validPeople([{ photoUrl: '/media/people/a.webp' }]), false)
  assert.equal(validPeople([{ nameOriginal: 'Usable' }]), true)
})

test('localizes nested production media paths without changing external URLs', () => {
  assert.deepEqual(localizeProductionMedia({
    posterUrl: '/media/content/series/kp_1/poster.webp',
    directors: [director],
    external: 'https://example.test/poster.jpg',
  }), {
    posterUrl: './data/libraries/series/img/kp_1/poster.webp',
    directors: [{
      ...director,
      photoUrl: './data/libraries/people/img/aa/person.webp',
    }],
    external: 'https://example.test/poster.jpg',
  })
})

test('summarizes set and delete operations separately', () => {
  assert.deepEqual(summarizeMovieHistoryUpdates([
    { changes: [{ field: 'directors', operation: 'set' }, { field: 'seriesStatus', operation: 'delete' }] },
    { changes: [{ field: 'directors', operation: 'set' }] },
  ]), {
    directors: 2,
    'seriesStatus:delete': 1,
  })
})
