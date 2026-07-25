import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchWikidataSeasonsByKinopoiskIds,
  kinopoiskKeysFromEnvironment,
  parseWikidataSeasonBindings,
} from './season-sources.mjs'

test('collects and deduplicates legacy and five-slot Kinopoisk keys', () => {
  const keys = kinopoiskKeysFromEnvironment({
    KINOPOISK_API_KEYS: 'first, second',
    KINOPOISK_API_KEY: 'second',
    KINOPOISK_UNOFFICIAL_API_KEY_1: 'third',
    KINOPOISK_UNOFFICIAL_API_KEY_2: ' first ',
    KINOPOISK_UNOFFICIAL_API_KEY_5: 'fifth',
  })

  assert.deepEqual(keys, ['first', 'second', 'third', 'fifth'])
})

test('accepts only one unambiguous positive integer season count per exact id', () => {
  const parsed = parseWikidataSeasonBindings([
    { kp: { value: '10' }, seasons: { value: '3' }, item: { value: 'https://www.wikidata.org/entity/Q10' } },
    { kp: { value: '10' }, seasons: { value: '3' }, item: { value: 'https://www.wikidata.org/entity/Q10' } },
    { kp: { value: '20' }, seasons: { value: '2' } },
    { kp: { value: '20' }, seasons: { value: '4' } },
    { kp: { value: '30' }, seasons: { value: '1.5' } },
    { kp: { value: '40' }, seasons: { value: '0' } },
    { kp: { value: '50' }, imdb: { value: 'tt12345' }, item: { value: 'http://www.wikidata.org/entity/Q50' } },
  ])

  assert.equal(parsed.counts.get('10'), 3)
  assert.equal(parsed.sourceUrls.get('10'), 'https://www.wikidata.org/entity/Q10')
  assert.equal(parsed.counts.has('20'), false)
  assert.equal(parsed.counts.has('30'), false)
  assert.equal(parsed.counts.has('40'), false)
  assert.equal(parsed.imdbIds.get('50'), 'tt12345')
  assert.equal(parsed.sourceUrls.get('50'), 'https://www.wikidata.org/entity/Q50')
  assert.deepEqual(parsed.conflicts, [{ kinopoiskId: 20, values: [2, 4] }])
})

test('batches exact Kinopoisk ids in Wikidata requests', async () => {
  const requests = []
  const fetchImpl = async (_url, init) => {
    const query = new URLSearchParams(init.body).get('query')
    requests.push(query)
    const ids = [...query.matchAll(/"(\d+)"/g)].map((match) => match[1])
    return new Response(JSON.stringify({
      results: {
        bindings: ids.map((id) => ({
          kp: { value: id },
          seasons: { value: id === '3' ? '2' : '1' },
        })),
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/sparql-results+json' },
    })
  }

  const parsed = await fetchWikidataSeasonsByKinopoiskIds([1, 2, 3, 3], {
    fetchImpl,
    batchSize: 2,
  })

  assert.equal(requests.length, 2)
  assert.equal(parsed.counts.get('1'), 1)
  assert.equal(parsed.counts.get('2'), 1)
  assert.equal(parsed.counts.get('3'), 2)
})
