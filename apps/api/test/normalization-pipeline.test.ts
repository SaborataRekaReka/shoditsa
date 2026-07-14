import { describe, expect, it } from 'vitest'
import { assertNormalizationField, normalizationFields, normalizeProposedValue } from '../src/modules/admin/normalization-pipeline.js'

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
})
