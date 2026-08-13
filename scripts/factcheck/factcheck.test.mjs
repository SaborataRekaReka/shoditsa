import assert from 'node:assert/strict'
import test from 'node:test'
import { buildResearchTasks, contextForTask, runDatasetRules } from './core.mjs'
import { expandDependencies } from './packs.mjs'

const animal = (overrides = {}) => ({
  id: 'animal:test', mode: 'animal', titleRu: 'Тестовое животное', scientificName: 'Testus animalis',
  taxonomicClass: 'Млекопитающие', animalOrder: 'Test', animalFamily: 'Testidae', bodyCoverings: ['Шерсть'],
  locomotion: ['Ходьба'], legCount: 4, thermoregulation: 'Теплокровное', reproduction: 'Живорождение',
  bodyMassKg: 10, sizeCategory: 'Средний', ...overrides,
})

test('field scope expands semantic dependencies', () => {
  const fields = expandDependencies('animal', ['legCount'])
  assert.ok(fields.includes('locomotion'))
  assert.ok(fields.includes('taxonomicClass'))
  assert.ok(fields.includes('scientificName'))
})

test('animal rules catch zero legs with walking', () => {
  const itemsByMode = { animal: [animal({ legCount: 0 })] }
  const findings = runDatasetRules(itemsByMode, { animal: ['legCount', 'locomotion'] })
  assert.ok(findings.some((finding) => finding.ruleId === 'ANIMAL-LOCOMOTION-001' && finding.severity === 'critical'))
})

test('unknown leg count is not treated as confirmed zero', () => {
  const itemsByMode = { animal: [animal({ legCount: null })] }
  const findings = runDatasetRules(itemsByMode, { animal: ['legCount', 'locomotion'] })
  assert.ok(findings.some((finding) => finding.ruleId === 'ANIMAL-LOCOMOTION-002' && finding.status === 'uncertain'))
  assert.ok(!findings.some((finding) => finding.ruleId === 'ANIMAL-LOCOMOTION-001'))
})

test('multi-field research uses one whole-card task with dependency context', () => {
  const itemsByMode = { animal: [animal()] }
  const requestedFieldsByMode = { animal: ['legCount', 'locomotion'] }
  const tasks = buildResearchTasks({ itemsByMode, requestedFieldsByMode, findings: [], research: 'all' })
  assert.equal(tasks.length, 1)
  assert.deepEqual(tasks[0].targetFields, ['legCount', 'locomotion'])
  assert.equal(tasks[0].card.scientificName, 'Testus animalis')
  assert.equal(tasks[0].card.legCount, 4)
  assert.deepEqual(tasks[0].card.locomotion, ['Ходьба'])
})

test('whole-card context targets factual fields and keeps identity', () => {
  const context = contextForTask(animal({ dataQuality: { verified: false } }), 'animal', ['*'])
  assert.ok(context.targetFields.includes('scientificName'))
  assert.ok(!context.targetFields.includes('dataQuality'))
  assert.equal(context.card.id, 'animal:test')
})

test('a null end year is not treated as year zero', () => {
  const item = { id: 'movie:test', mode: 'movie', titleRu: 'Фильм', year: 2020, endYear: null }
  const findings = runDatasetRules({ movie: [item] }, { movie: ['*'] })
  assert.ok(!findings.some((finding) => finding.ruleId === 'COMMON-TIME-001'))
})

test('BCE publication years remain valid for books and ancient characters', () => {
  const book = { id: 'book:test', mode: 'book', titleRu: 'Эпос', bookPublicationYear: -800 }
  const character = { id: 'character:test', mode: 'character', titleRu: 'Герой', characterFirstAppearanceYear: -1800 }
  const findings = runDatasetRules({ book: [book], character: [character] }, { book: ['*'], character: ['*'] })
  assert.ok(!findings.some((finding) => finding.ruleId === 'COMMON-YEAR-001'))
})

test('zero remains an invalid sentinel for a release year', () => {
  const item = { id: 'game:test', mode: 'game', titleRu: 'Игра', releaseYear: 0 }
  const findings = runDatasetRules({ game: [item] }, { game: ['*'] })
  assert.ok(findings.some((finding) => finding.ruleId === 'COMMON-YEAR-001'))
})

test('custom input accepts an existing arbitrary mode label', () => {
  const item = { id: 'entity:test', mode: 'product', titleRu: 'Товар', price: 10 }
  const findings = runDatasetRules({ custom: [item] }, { custom: ['price'] })
  assert.ok(!findings.some((finding) => finding.ruleId === 'COMMON-MODE-001'))
})
