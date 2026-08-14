import { describe, expect, it } from 'vitest'
import { buildFactcheckPreview } from '../src/modules/admin/factcheck-pipeline.js'

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
})
