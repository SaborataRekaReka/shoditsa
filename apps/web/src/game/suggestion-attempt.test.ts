import { describe, expect, it, vi } from 'vitest'
import { selectSuggestionForAttempt } from './suggestion-attempt'

describe('selectSuggestionForAttempt', () => {
  it('selects a suggestion without spending an attempt', () => {
    const suggestion = { id: 'movie:1' }
    const select = vi.fn()

    selectSuggestionForAttempt(suggestion, select)

    expect(select).toHaveBeenCalledWith(suggestion)
  })
})
