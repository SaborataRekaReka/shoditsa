import { describe, expect, it } from 'vitest'
import { buildFactcheckPreview, factcheckRetryFields, mergeFactcheckResearchResults } from '../src/modules/admin/factcheck-pipeline.js'

describe('factcheck pipeline preview', () => {
  it('keeps a sourced high-confidence correction as review-only before/after diff', () => {
    const before = { id: 'character:test', mode: 'character', titleRu: 'Тест', characterFirstAppearanceYear: 1901 }
    const preview = buildFactcheckPreview(before, {
      overallVerdict: 'contradiction', confidence: 0.94, summary: 'Год первого появления неверен.',
      fieldResults: [{
        field: 'characterFirstAppearanceYear', verdict: 'contradiction', confidence: 0.94,
        reason: 'Первое издание вышло годом ранее.', proposedValue: 1900, sourceUrls: ['https://example.org/primary-work'],
      }],
    }, [{ fields: ['characterFirstAppearanceYear'], status: 'contradiction', severity: 'high', message: 'Год требует исправления.' }])

    expect(preview.status).toBe('review_required')
    expect(preview.changedFields).toEqual(['characterFirstAppearanceYear'])
    expect(preview.proposed?.characterFirstAppearanceYear).toBe(1900)
    expect(before.characterFirstAppearanceYear).toBe(1901)
    expect(preview.sources).toHaveLength(1)
    expect(preview.releaseGate.blocking).toBe(true)
  })

  it('does not turn an unsupported or low-confidence guess into a correction', () => {
    const before = { id: 'character:test', mode: 'character', characterNature: ['человек'] }
    const preview = buildFactcheckPreview(before, {
      overallVerdict: 'uncertain', confidence: 0.4, summary: 'Недостаточно источников.',
      fieldResults: [{ field: 'characterNature', verdict: 'contradiction', confidence: 0.4, reason: 'Возможно иное.', proposedValue: ['дух'], sourceUrls: [] }],
    }, [])

    expect(preview.status).toBe('unresolved')
    expect(preview.changedFields).toEqual([])
    expect(preview.proposed).toEqual(before)
  })

  it('marks a fully evidenced clean card as verified', () => {
    const before = { id: 'character:test', mode: 'character', titleRu: 'Тест' }
    const preview = buildFactcheckPreview(before, {
      overallVerdict: 'pass', confidence: 0.96, summary: 'Проверено.',
      fieldResults: [{ field: 'titleRu', verdict: 'pass', confidence: 0.96, proposedValue: 'Тест', sourceUrls: ['https://example.org/work'] }],
    }, [])

    expect(preview.status).toBe('verified')
    expect(preview.releaseGate.blocking).toBe(false)
  })

  it('uses target field evidence instead of an unrelated uncertain overall verdict', () => {
    const before = { id: 'character:test', mode: 'character', titleRu: 'Тест', posterUrl: '/internal.webp' }
    const preview = buildFactcheckPreview(before, {
      overallVerdict: 'uncertain', confidence: 0.8, summary: 'Internal artwork cannot be checked externally.',
      fieldResults: [
        { field: 'titleRu', verdict: 'pass', confidence: 0.95, proposedValue: 'Тест', sourceUrls: ['https://example.org/work'] },
        { field: 'posterUrl', verdict: 'uncertain', confidence: 0.2, proposedValue: '/internal.webp', sourceUrls: [] },
      ],
    }, [], 0.75, ['titleRu'])

    expect(preview.status).toBe('verified')
    expect(preview.releaseGate.blocking).toBe(false)
  })

  it('retries only unresolved or non-actionable factual fields', () => {
    const before = { titleRu: 'Тест', characterFirstAppearanceYear: 1901, characterSourceWork: 'Книга' }
    const fields = factcheckRetryFields(before, {
      fieldResults: [
        { field: 'titleRu', verdict: 'pass', confidence: 0.95, proposedValue: 'Тест', sourceUrls: ['https://example.org/work'] },
        { field: 'characterFirstAppearanceYear', verdict: 'contradiction', confidence: 0.98, proposedValue: 1901, sourceUrls: ['https://example.org/year'] },
        { field: 'characterSourceWork', verdict: 'uncertain', confidence: 0.4, proposedValue: 'Книга', sourceUrls: [] },
      ],
    }, ['titleRu', 'characterFirstAppearanceYear', 'characterSourceWork'])

    expect(fields).toEqual(['characterFirstAppearanceYear', 'characterSourceWork'])
  })

  it('merges a targeted follow-up without losing settled field evidence', () => {
    const merged = mergeFactcheckResearchResults({
      summary: 'Initial review.',
      fieldResults: [
        { field: 'titleRu', verdict: 'pass', confidence: 0.9, proposedValue: 'Тест', sourceUrls: ['https://example.org/title'] },
        { field: 'year', verdict: 'uncertain', confidence: 0.2, proposedValue: 1901, sourceUrls: [] },
      ],
      crossFieldFindings: [{ fields: ['year'], verdict: 'uncertain', confidence: 0.2, reason: 'Unknown.', sourceUrls: [] }],
    }, {
      summary: 'Year resolved.',
      fieldResults: [{ field: 'year', verdict: 'contradiction', confidence: 0.98, proposedValue: 1900, sourceUrls: ['https://example.org/year'] }],
      crossFieldFindings: [],
    }, ['year'])

    expect(merged.fieldResults).toHaveLength(2)
    expect(merged.fieldResults?.find((entry) => entry.field === 'titleRu')?.verdict).toBe('pass')
    expect(merged.fieldResults?.find((entry) => entry.field === 'year')?.proposedValue).toBe(1900)
    expect(merged.crossFieldFindings).toEqual([])
  })
})
