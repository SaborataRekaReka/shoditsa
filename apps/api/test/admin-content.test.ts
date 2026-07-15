import { describe, expect, it } from 'vitest'
import { blockingContentValidationIssues, contentPayloadsEqual, validateContentPayload } from '../src/modules/admin/content-service.js'

const base = {
  id: 'admin-test-card',
  mode: 'movie',
  titleRu: 'Тестовая карточка',
  titleOriginal: 'Test card',
  alternativeTitles: [],
  year: 2024,
  plotHint: 'Достаточно длинная подсказка без названия ответа.',
  allowedInGame: true,
}

describe('admin content validation', () => {
  it('accepts a complete ordinary card', () => {
    expect(validateContentPayload(base, 'movie').filter((issue) => issue.level === 'error')).toEqual([])
  })

  it('rejects answer leaks and invalid media paths', () => {
    const issues = validateContentPayload({
      ...base,
      plotHint: 'В этой подсказке раскрыта Тестовая карточка целиком.',
      posterUrl: 'javascript:alert(1)',
    }, 'movie')
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'plotHint', code: 'answer_leak', level: 'error' }),
      expect.objectContaining({ field: 'media', code: 'invalid_url', level: 'error' }),
    ]))
  })

  it('accepts legacy internal media paths rooted with dot slash', () => {
    const issues = validateContentPayload({
      ...base,
      posterUrl: './data/libraries/movies/img/admin-test-card/poster.webp',
      screenshots: ['./images/admin-test-card/frame.webp'],
    }, 'movie')
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([])
  })

  it('enforces mode-specific music and diagnosis fields', () => {
    const musicIssues = validateContentPayload({ ...base, mode: 'music', allowedInGame: undefined }, 'music')
    const diagnosisIssues = validateContentPayload({ ...base, mode: 'diagnosis' }, 'diagnosis')
    expect(musicIssues).toContainEqual(expect.objectContaining({ field: 'allowedInGame', code: 'required' }))
    expect(diagnosisIssues).toContainEqual(expect.objectContaining({ field: 'icd10', code: 'required' }))
  })

  it('rejects anime facts that duplicate model fields', () => {
    const issues = validateContentPayload({
      ...base,
      mode: 'anime',
      animeKind: 'TV сериал',
      animeStatus: 'Вышло',
      episodes: 12,
      animeEpisodesAired: 12,
      facts: ['Формат: TV сериал', 'Статус: Вышло', 'Эпизоды: 12', 'Вышло эпизодов: 12'],
    }, 'anime')

    expect(issues).toContainEqual(expect.objectContaining({
      field: 'facts',
      code: 'duplicate_model_fact',
      level: 'error',
    }))
  })

  it('allows normalization to fix another field without inheriting an unrelated legacy error', () => {
    const legacy = { ...base, titleOriginal: null, plotHint: 'Старая достаточно длинная подсказка без ответа.' }
    const normalized = { ...legacy, year: 2025 }

    expect(validateContentPayload(normalized, 'movie')).toContainEqual(expect.objectContaining({ field: 'titleOriginal', code: 'invalid_type' }))
    expect(blockingContentValidationIssues(legacy, normalized, 'movie')).toEqual([])
  })

  it('still blocks a new error in the field changed by normalization', () => {
    const normalized = { ...base, plotHint: 'Ответ — Тестовая карточка.' }
    expect(blockingContentValidationIssues(base, normalized, 'movie')).toContainEqual(expect.objectContaining({ field: 'plotHint', code: 'answer_leak' }))
  })

  it('compares pipeline source payloads semantically instead of by object key order', () => {
    expect(contentPayloadsEqual({ titleRu: 'Карточка', nested: { b: 2, a: 1 } }, { nested: { a: 1, b: 2 }, titleRu: 'Карточка' })).toBe(true)
    expect(contentPayloadsEqual({ titleRu: 'Карточка' }, { titleRu: 'Другая' })).toBe(false)
  })
})
