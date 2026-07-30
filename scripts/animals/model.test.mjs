import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateProvenanceCoverage,
  createEmptyAnimal,
  deriveLifespanCategory,
  deriveSizeCategory,
  deriveTaxonomyCriteria,
  normalizeGameTaxonomy,
  normalizeEltonDiet,
  scoreAnimal,
  validateAnimal,
} from './model.mjs'

test('normalizes EltonTraits diet percentages into game categories', () => {
  assert.deepEqual(normalizeEltonDiet({
    endothermicVertebrates: 90,
    scavenging: 10,
  }), ['carnivore'])
  assert.deepEqual(normalizeEltonDiet({
    fruit: 40,
    invertebrates: 40,
    seeds: 20,
  }), ['herbivore'])
  assert.deepEqual(normalizeEltonDiet({
    fruit: 30,
    seeds: 10,
    invertebrates: 40,
    endothermicVertebrates: 20,
  }), ['omnivore'])
})

test('derives stable size and lifespan buckets', () => {
  assert.equal(deriveSizeCategory(0.02), 'tiny')
  assert.equal(deriveSizeCategory(161.5), 'large')
  assert.equal(deriveSizeCategory(2_000), 'giant')
  assert.equal(deriveLifespanCategory(28), '15-30')
  assert.equal(deriveLifespanCategory(80), 'over-60')
})

test('derives conservative game criteria from class and order', () => {
  assert.deepEqual(deriveTaxonomyCriteria({
    taxonomicClass: 'Mammalia',
    order: 'Cetacea',
  }), {
    bodyCoverings: ['smooth-skin'],
    habitats: [],
    lifestyles: ['aquatic'],
    locomotion: ['swim'],
    reproduction: 'live-birth',
    legCount: 0,
    thermoregulation: 'endothermic',
  })
  assert.deepEqual(deriveTaxonomyCriteria({
    taxonomicClass: 'Aves',
    order: 'Sphenisciformes',
  }).locomotion, ['swim', 'walk'])
  assert.equal(deriveTaxonomyCriteria({ taxonomicClass: 'Insecta' }).legCount, 6)
})

test('normalizes unstable GBIF backbone levels into game classes', () => {
  assert.deepEqual(normalizeGameTaxonomy({
    taxonomicClass: 'Squamata',
    order: '',
    phylum: 'Chordata',
  }), {
    taxonomicClass: 'Reptilia',
    order: 'Squamata',
    phylum: 'Chordata',
  })
  assert.equal(normalizeGameTaxonomy({
    taxonomicClass: '',
    order: 'Perciformes',
    phylum: 'Chordata',
  }, ['Категория:Рыбы']).taxonomicClass, 'Actinopterygii')
})

test('scores a complete, recognizable animal as eligible', () => {
  const animal = createEmptyAnimal({ id: 'animal:lion', wikidataId: 'Q140' })
  Object.assign(animal.identity, {
    commonNameRu: 'лев',
    scientificName: 'Panthera leo',
    acceptedScientificName: 'Panthera leo',
  })
  Object.assign(animal.taxonomy, {
    kingdom: 'Animalia',
    taxonomicClass: 'Mammalia',
    family: 'Felidae',
    genus: 'Panthera',
  })
  Object.assign(animal.criteria, {
    taxonomicClass: 'Mammalia',
    bodyCoverings: ['fur'],
    habitats: ['savanna'],
    lifestyles: ['terrestrial'],
    continents: ['africa'],
    climateZones: ['tropical'],
    diets: ['carnivore'],
    activity: ['nocturnal'],
    locomotion: ['walk', 'run'],
    sizeCategory: 'large',
    reproduction: 'live-birth',
    sociality: ['pride'],
  })
  animal.measurements.lifespanCategory = '15-30'
  animal.measurements.bodyMassKg = 161.5
  animal.measurements.lifespanYears.maximumObserved = 28
  animal.media.primaryImage = { fileUrl: 'https://example.test/lion.jpg' }
  animal.hints.sounds = [{ fileUrl: 'https://example.test/lion.ogg' }]
  animal.hints.distinctiveTraitsRu = ['У самцов есть грива.']
  animal.ecology.prey = [{ scientificName: 'Equus quagga' }]
  animal.popularity.wikidataSitelinks = 274
  animal.popularity.ruWikipediaPageviews365d = 195_000
  animal.provenance = [
    { fieldPaths: ['identity.commonNameRu', 'identity.scientificName', 'identity.acceptedScientificName'] },
    { fieldPaths: ['taxonomy.taxonomicClass', 'taxonomy.family'] },
    { fieldPaths: ['criteria.diets', 'criteria.activity'] },
    { fieldPaths: ['measurements.bodyMassKg', 'measurements.lifespanYears.maximumObserved'] },
    { fieldPaths: ['media.primaryImage'] },
  ]

  calculateProvenanceCoverage(animal)
  const score = scoreAnimal(animal)
  assert.equal(score.eligible, true)
  assert.equal(score.difficulty, 'easy')
  assert.ok(score.totalScore > 60)
  assert.equal(animal.quality.provenanceCoverage, 100)
  assert.deepEqual(validateAnimal(animal), [])
})
