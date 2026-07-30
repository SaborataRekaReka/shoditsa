import { describe, expect, it, vi } from 'vitest'
import { commitSuggestionAttempt } from './suggestion-attempt'

describe('commitSuggestionAttempt', () => {
  it('selects and immediately submits the clicked suggestion', () => {
    const suggestion = { id: 'movie:1' }
    const calls: string[] = []
    const select = vi.fn((item: typeof suggestion) => calls.push(`select:${item.id}`))
    const submit = vi.fn((item: typeof suggestion) => calls.push(`submit:${item.id}`))

    commitSuggestionAttempt(suggestion, select, submit)

    expect(calls).toEqual(['select:movie:1', 'submit:movie:1'])
    expect(select).toHaveBeenCalledWith(suggestion)
    expect(submit).toHaveBeenCalledWith(suggestion)
  })
})
