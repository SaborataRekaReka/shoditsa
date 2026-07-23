import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ERA_QUOTAS,
  answerVariants,
  eraKeyFor,
  normalizeTitle,
  selectDailyPool,
  technicalReason,
} from './enrichment-lib.mjs'

test('normalizes Russian spelling, punctuation and safe number variants deterministically', () => {
  assert.equal(normalizeTitle('  S.T.A.L.K.E.R.: Зов Припяти  '), 's t a l k e r зов припяти')
  assert.equal(normalizeTitle('Ёлка — II'), 'елка ii')
  const variants = answerVariants('Divinity: Original Sin II')
  assert.ok(variants.includes('Divinity: Original Sin 2'))
  assert.equal(new Set(variants.map(normalizeTitle)).size, variants.length)
})

test('rejects technical Steam applications', () => {
  assert.equal(technicalReason('Example Game Demo'), 'demo')
  assert.equal(technicalReason('Example Dedicated Server'), 'server')
  assert.equal(technicalReason('Example Game'), null)
  assert.equal(technicalReason('Example Game', 'game', true), 'unreleased')
})

test('builds exactly 1000 daily entries with the requested era composition', () => {
  const years = {
    before_2000: 1998,
    '2000_2009': 2005,
    '2010_2016': 2014,
    '2017_2021': 2019,
    '2022_current': 2024,
  }
  const catalog = []
  for (const [era, quota] of Object.entries(ERA_QUOTAS)) {
    for (let index = 0; index < quota + 10; index += 1) {
      catalog.push({
        id: `${era}-${index}`,
        titleRu: `${era} ${index}`,
        titleOriginal: `${era} ${index}`,
        alternativeTitles: [],
        year: years[era],
        genres: ['Action'],
        developers: [`Developer ${index}`],
        publishers: [`Publisher ${index}`],
        platforms: ['PC'],
        dailyEligible: true,
        reviewStatus: 'machine_verified',
        recognitionScore: 100 - index / 100,
        scoreConfidence: 1,
        franchiseKey: null,
      })
    }
  }
  const result = selectDailyPool(catalog)
  assert.equal(result.selected.length, 1000)
  assert.deepEqual(result.eraCounts, ERA_QUOTAS)
  assert.deepEqual(
    Object.fromEntries(Object.keys(ERA_QUOTAS).map((era) => [
      era,
      result.selected.filter((item) => eraKeyFor(item.year) === era).length,
    ])),
    ERA_QUOTAS,
  )
})
