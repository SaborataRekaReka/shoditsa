import { describe, expect, it } from 'vitest'
import { assertNormalizationField, normalizationFields, normalizationStartIndex, normalizeProposedValue } from '../src/modules/admin/normalization-pipeline.js'

describe('normalization pipeline', () => {
  it('exposes activityStartYear instead of ambiguous year for music', () => {
    const fields = normalizationFields('music').map((entry) => entry.field)
    expect(fields).toContain('activityStartYear')
    expect(fields).not.toContain('year')
  })

  it('rejects protected or unrelated fields', () => {
    expect(() => assertNormalizationField('music', 'id')).toThrow()
    expect(() => assertNormalizationField('movie', 'activityStartYear')).toThrow()
  })

  it('validates the activity year and allows an explicit clear', () => {
    expect(normalizeProposedValue('activityStartYear', '2003', 1987)).toBe(2003)
    expect(normalizeProposedValue('activityStartYear', null, 1987)).toBeNull()
    expect(() => normalizeProposedValue('activityStartYear', 1780, 1987)).toThrow()
  })

  it('resumes after already processed cards without replaying paid requests', () => {
    const itemIds = Array.from({ length: 100 }, (_, index) => `music:${index + 1}`)
    expect(normalizationStartIndex(itemIds, 46)).toBe(46)
    expect(itemIds.slice(normalizationStartIndex(itemIds, 46))[0]).toBe('music:47')
    expect(normalizationStartIndex(itemIds, -5)).toBe(0)
    expect(normalizationStartIndex(itemIds, 500)).toBe(100)
  })
})
