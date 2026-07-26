import test from 'node:test'
import assert from 'node:assert/strict'
import {
  candidateMatch,
  chooseCandidate,
  countryDescriptor,
  developmentCountryIds,
  developerCountryIds,
} from './development-country-lib.mjs'

const itemClaim = (id) => ({
  rank: 'normal',
  mainsnak: { snaktype: 'value', datavalue: { value: { id } } },
})

const stringClaim = (value) => ({
  rank: 'normal',
  mainsnak: { snaktype: 'value', datavalue: { value } },
})

const timeClaim = (year) => ({
  rank: 'normal',
  mainsnak: {
    snaktype: 'value',
    datavalue: { value: { time: `+${year}-01-01T00:00:00Z` } },
  },
})

const entity = (id, label, claims = {}) => ({
  id,
  labels: { en: { value: label } },
  aliases: {},
  descriptions: { en: { value: 'video game' } },
  claims,
})

test('matches a game only when title, year and entity type agree', () => {
  const game = entity('Q1', 'Example Game', {
    P31: [itemClaim('Q7889')],
    P577: [timeClaim(2018)],
  })
  const match = candidateMatch({
    titleRu: 'Example Game',
    titleOriginal: 'Example Game',
    year: 2018,
  }, game)
  assert.equal(match.valid, true)
  assert.equal(match.yearDistance, 0)
})

test('does not silently choose tied candidates', () => {
  const entities = new Map([
    ['Q1', entity('Q1', 'Example Game', { P31: [itemClaim('Q7889')], P577: [timeClaim(2018)] })],
    ['Q2', entity('Q2', 'Example Game', { P31: [itemClaim('Q7889')], P577: [timeClaim(2018)] })],
  ])
  const result = chooseCandidate({
    titleRu: 'Example Game',
    titleOriginal: 'Example Game',
    year: 2018,
  }, ['Q1', 'Q2'], (qid) => entities.get(qid))
  assert.equal(result.status, 'ambiguous')
})

test('prefers developer countries and detects disagreement with game origin', () => {
  const entities = new Map([
    ['QD', entity('QD', 'Developer', { P17: [itemClaim('QCA')] })],
    ['QCA', entity('QCA', 'Canada')],
    ['QUS', entity('QUS', 'United States')],
  ])
  const game = entity('QG', 'Example Game', {
    P178: [itemClaim('QD')],
    P495: [itemClaim('QUS')],
  })
  const result = developmentCountryIds(game, (qid) => entities.get(qid))
  assert.deepEqual(result.countries, ['QCA'])
  assert.equal(result.method, 'developer_country')
  assert.equal(result.conflict, true)
})

test('uses country of citizenship for an individual creator', () => {
  const creator = entity('Q4', 'Creator', { P27: [itemClaim('Q17')] })
  assert.deepEqual(developerCountryIds(creator, () => null), ['Q17'])
})

test('prefers an organization operating country over a separate origin claim', () => {
  const studio = entity('Q4', 'Studio', {
    P17: [itemClaim('Q30')],
    P495: [itemClaim('Q17')],
  })
  assert.deepEqual(developerCountryIds(studio, () => null), ['Q30'])
})

test('builds a localized country descriptor with ISO code', () => {
  const country = entity('Q17', 'Japan', { P297: [stringClaim('JP')] })
  country.labels.ru = { value: 'Япония' }
  assert.deepEqual(countryDescriptor('Q17', country), {
    wikidataId: 'Q17',
    code: 'JP',
    nameRu: 'Япония',
    nameEn: 'Japan',
  })
})
