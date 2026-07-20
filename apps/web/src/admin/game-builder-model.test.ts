import { describe, expect, it } from 'vitest'
import {
  analyseUnknownJson, autoMapFields, createExchangeDocument, ensureUniqueItemIds, inferContentMode, mapRecordToItem, targetsForMode,
} from './game-builder-model'

describe('JSON game builder model', () => {
  const source = {
    response: {
      games: [
        { game_id: 'portal-2', name: 'Portal 2', release_year: 2011, developer: 'Valve', platforms: ['PC', 'PS3'], artwork: { cover: 'https://cdn.test/portal.webp' }, clue: 'Игра о порталах и доверии к искусственному интеллекту' },
        { game_id: 'hades', name: 'Hades', release_year: 2020, developer: 'Supergiant Games', platforms: ['PC', 'Switch'], artwork: { cover: 'https://cdn.test/hades.webp' }, clue: 'Побег из подземного мира превращается в семейную историю' },
      ],
    },
  }

  it('finds a nested record collection and flattens nested leaf fields', () => {
    const analysed = analyseUnknownJson(source)
    expect(analysed.records).toHaveLength(2)
    expect(analysed.rootPath).toEqual(['response', 'games'])
    expect(analysed.fields.map((field) => field.label)).toContain('artwork.cover')
    expect(analysed.fields.find((field) => field.label === 'platforms')).toMatchObject({ kind: 'list', coverage: 1 })
  })

  it('infers the category and maps familiar aliases automatically', () => {
    const analysed = analyseUnknownJson(source)
    const mode = inferContentMode(analysed.fields)
    const targets = targetsForMode(mode)
    const mapping = autoMapFields(analysed.fields, targets)
    const fieldLabel = (target: string) => analysed.fields.find((field) => field.id === mapping[target])?.label
    expect(mode).toBe('game')
    expect(fieldLabel('id')).toBe('game_id')
    expect(fieldLabel('titleRu')).toBe('name')
    expect(fieldLabel('year')).toBe('release_year')
    expect(fieldLabel('developers')).toBe('developer')
    expect(fieldLabel('posterUrl')).toBe('artwork.cover')
  })

  it('normalizes values and emits a valid selective exchange document', () => {
    const analysed = analyseUnknownJson(source)
    const targets = targetsForMode('game')
    const mapping = autoMapFields(analysed.fields, targets)
    const mapped = ensureUniqueItemIds(analysed.records.map((record, index) => mapRecordToItem({ record, index, fields: analysed.fields, targets, mapping, mode: 'game' })))
    expect(mapped[0]).toMatchObject({
      id: 'portal-2', mode: 'game', data: { titleRu: 'Portal 2', titleOriginal: '', alternativeTitles: [], year: 2011, developers: ['Valve'] },
    })
    const document = createExchangeDocument(mapped)
    expect(document).toMatchObject({ format: 'shoditsa-content-exchange', schemaVersion: 1 })
    expect(document.fields).not.toContain('id')
    expect(document.items[0].data).not.toHaveProperty('id')
  })

  it('derives stable unique IDs when the source has no identity field', () => {
    const analysed = analyseUnknownJson([{ title: 'Одна карточка' }, { title: 'Одна карточка' }])
    const targets = targetsForMode('movie')
    const mapping = autoMapFields(analysed.fields, targets)
    const items = ensureUniqueItemIds(analysed.records.map((record, index) => mapRecordToItem({ record, index, fields: analysed.fields, targets, mapping, mode: 'movie' })))
    expect(items.map((item) => item.id)).toEqual(['import-одна-карточка-1', 'import-одна-карточка-2'])
  })

  it('builds the nested movie fields expected by the real attempt card', () => {
    const analysed = analyseUnknownJson([{ title: 'Брат', duration: 96, kp: 8.3, imdb: 7.8, director: 'Алексей Балабанов', actors: ['Сергей Бодров мл.'] }])
    const targets = targetsForMode('movie')
    const mapping = autoMapFields(analysed.fields, targets)
    const item = mapRecordToItem({ record: analysed.records[0], index: 0, fields: analysed.fields, targets, mapping, mode: 'movie' })
    expect(item.data).toMatchObject({
      runtimeMinutes: 96,
      ratings: { kinopoisk: 8.3, imdb: 7.8 },
      directors: [{ nameRu: 'Алексей Балабанов', nameOriginal: '', photoUrl: null }],
      cast: [{ nameRu: 'Сергей Бодров мл.', nameOriginal: '', photoUrl: null }],
    })
  })

  it('detects danetki and preserves its structured chat-engine fields', () => {
    const analysed = analyseUnknownJson([{
      id: 'case-1', titleRu: 'Закрытая комната', condition: 'Длинное условие загадочной ситуации.',
      solution: 'Полное объяснение загадочной ситуации.', difficulty: 'medium', genres: ['детективная'],
      keyFacts: [{ id: 'room', text: 'Комната двигалась', required: true }],
      hints: [{ level: 1, text: 'Комната не стояла на месте' }], starterQuestions: ['Это помещение?'],
      answerRules: { requiredFactIds: ['room'], minCoverage: 0.75 }, contentStatus: 'test', allowedInGame: true,
    }])
    const mode = inferContentMode(analysed.fields)
    const targets = targetsForMode(mode)
    const mapping = autoMapFields(analysed.fields, targets)
    const item = mapRecordToItem({ record: analysed.records[0], index: 0, fields: analysed.fields, targets, mapping, mode })

    expect(mode).toBe('danetki')
    expect(item.data).toMatchObject({
      condition: 'Длинное условие загадочной ситуации.',
      solution: 'Полное объяснение загадочной ситуации.',
      keyFacts: [{ id: 'room', text: 'Комната двигалась', required: true }],
      answerRules: { requiredFactIds: ['room'], minCoverage: 0.75 },
    })
    expect(targets.map((target) => target.key)).not.toContain('posterUrl')
  })
})
