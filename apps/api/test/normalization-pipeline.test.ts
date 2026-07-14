import { describe, expect, it } from 'vitest'
import { assertNormalizationField, mergeNormalizationUsage, normalizationFields, normalizationStartIndex, normalizeProposedValue } from '../src/modules/admin/normalization-pipeline.js'

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

  it('keeps the previous billed usage when one item is regenerated', () => {
    const previous = { usage: { responses: [{ responseId: 'old', model: 'gpt-5-mini', inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, webSearchCalls: 1, costUsd: 0.01 }] } }
    const usage = mergeNormalizationUsage(previous, { responseId: 'new', model: 'gpt-5-mini', inputTokens: 200, cachedInputTokens: 50, outputTokens: 20, webSearchCalls: 1, costUsd: 0.02 })
    expect(usage).toMatchObject({ inputTokens: 300, cachedInputTokens: 70, outputTokens: 30, webSearchCalls: 2, costUsd: 0.03 })
    expect(usage.responses).toHaveLength(2)
  })
})
