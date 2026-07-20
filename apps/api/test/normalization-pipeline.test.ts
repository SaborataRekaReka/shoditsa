import { describe, expect, it } from 'vitest'
import { assertNormalizationField, assertNormalizationTemplate, buildNormalizationCardContext, isNormalizationRateLimitError, mergeNormalizationUsage, normalizationFields, normalizationPendingItemIds, normalizationStartIndex, normalizationUnknownVariables, normalizeProposedValue, renderNormalizationPrompt, runNormalizationPool } from '../src/modules/admin/normalization-pipeline.js'

describe('normalization pipeline', () => {
  it('exposes activityStartYear instead of ambiguous year for music', () => {
    const fields = normalizationFields('music').map((entry) => entry.field)
    expect(fields).toContain('activityStartYear')
    expect(fields).not.toContain('year')
  })

  it('exposes chat-engine fields without catalog-only presentation fields for danetki', () => {
    const fields = normalizationFields('danetki').map((entry) => entry.field)
    expect(fields).toEqual(expect.arrayContaining(['condition', 'solution', 'keyFacts', 'hints', 'starterQuestions', 'answerRules']))
    expect(fields).not.toContain('plotHint')
    expect(fields).not.toContain('posterUrl')
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

  it('recovers an unfinished hole before the stored offset', () => {
    const itemIds = ['music:1', 'music:2', 'music:3', 'music:4', 'music:5']
    expect(normalizationPendingItemIds(itemIds, ['music:1', 'music:3'], 3)).toEqual(['music:2', 'music:4', 'music:5'])
  })

  it('sends only the target and identifying context instead of the full card', () => {
    const context = buildNormalizationCardContext({
      titleRu: 'Исполнитель', activityStartYear: 2000, year: 1980, countries: ['US'], members: ['A'],
      topTracks: Array.from({ length: 100 }, (_, index) => `Track ${index}`), plotHint: 'Большая подсказка', screenshots: ['a', 'b'],
    }, 'music', 'activityStartYear')
    expect(context).toMatchObject({ titleRu: 'Исполнитель', activityStartYear: 2000, year: 1980, countries: ['US'], members: ['A'] })
    expect(context).not.toHaveProperty('topTracks')
    expect(context).not.toHaveProperty('plotHint')
    expect(context).not.toHaveProperty('screenshots')
  })

  it('renders card variables separately for every normalization item', () => {
    const rendered = renderNormalizationPrompt({
      prompt: 'Найди данные для %title% (%originalTitle%), поле %field%, сейчас %currentValue%. Разработчики: %developers%.',
      payload: { titleRu: 'Игра', titleOriginal: 'Game', year: 2001, developers: ['Studio'] },
      mode: 'game', field: 'year', contextFields: ['developers'], cardId: 'game:1',
    })
    expect(rendered.prompt).toBe('Найди данные для Игра (Game), поле year, сейчас 2001. Разработчики: ["Studio"].')
    expect(rendered.context).toMatchObject({ cardId: 'game:1', titleRu: 'Игра', titleOriginal: 'Game', year: 2001, developers: ['Studio'] })
  })

  it('supports an explicit minimal context and the card JSON variable', () => {
    const rendered = renderNormalizationPrompt({
      prompt: 'Карточка: %card%', payload: { titleRu: 'Игра', year: 2001, developers: ['Studio'] },
      mode: 'game', field: 'year', contextFields: [], cardId: 'game:1',
    })
    expect(rendered.context).toEqual({ cardId: 'game:1', titleRu: 'Игра', titleOriginal: null, year: 2001 })
    expect(rendered.prompt).not.toContain('developers')
  })

  it('blocks misspelled template variables before a paid request', () => {
    expect(normalizationUnknownVariables('Проверь %titel% и %title%', 'game')).toEqual(['titel'])
    expect(() => assertNormalizationTemplate('Проверь %titel%', 'game')).toThrow(/%titel%/)
  })

  it('allows a field discovered in any category to be used in every category', () => {
    const rendered = renderNormalizationPrompt({
      prompt: 'Универсальное поле: %customEditorialNote%', payload: { titleRu: 'Игра', customEditorialNote: 'Проверено' },
      mode: 'game', field: 'plotHint', contextFields: ['customEditorialNote'], cardId: 'game:1', availableFields: ['customEditorialNote'],
    })
    expect(rendered.prompt).toBe('Универсальное поле: Проверено')
    expect(rendered.context.customEditorialNote).toBe('Проверено')
  })

  it('processes normalization items with bounded concurrency', async () => {
    let active = 0
    let peak = 0
    const result = await runNormalizationPool([1, 2, 3, 4, 5, 6], 3, async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return 'completed'
    }, { rateLimitBackoffMs: 0 })
    expect(result).toMatchObject({ completed: 6, cancelled: false, finalConcurrency: 3 })
    expect(peak).toBe(3)
  })

  it('reduces concurrency and retries once after a rate limit', async () => {
    const attempts = new Map<number, number>()
    const result = await runNormalizationPool([1, 2, 3], 3, async (item, _index, retry) => {
      attempts.set(item, (attempts.get(item) ?? 0) + 1)
      return item === 1 && retry === 0 ? 'rate_limited' : 'completed'
    }, { rateLimitBackoffMs: 0 })
    expect(result).toMatchObject({ completed: 3, cancelled: false, finalConcurrency: 2 })
    expect(attempts.get(1)).toBe(2)
    expect(isNormalizationRateLimitError(new Error('OpenAI HTTP 429'))).toBe(true)
  })

  it('keeps the previous billed usage when one item is regenerated', () => {
    const previous = { usage: { responses: [{ responseId: 'old', model: 'gpt-5-mini', inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, webSearchCalls: 1, costUsd: 0.01 }] } }
    const usage = mergeNormalizationUsage(previous, { responseId: 'new', model: 'gpt-5-mini', inputTokens: 200, cachedInputTokens: 50, outputTokens: 20, webSearchCalls: 1, costUsd: 0.02 })
    expect(usage).toMatchObject({ inputTokens: 300, cachedInputTokens: 70, outputTokens: 30, webSearchCalls: 2, costUsd: 0.03 })
    expect(usage.responses).toHaveLength(2)
  })
})
