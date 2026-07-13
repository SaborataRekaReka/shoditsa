import { describe, expect, it } from 'vitest'
import { validateContentPayload } from '../src/modules/admin/content-service.js'

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
})
