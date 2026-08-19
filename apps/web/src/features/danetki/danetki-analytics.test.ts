import { describe, expect, it } from 'vitest'
import { isFreshDanetkiCompletion } from './danetki-analytics'

describe('Danetki completion analytics', () => {
  it('accepts only a live transition from playing to a terminal state', () => {
    expect(isFreshDanetkiCompletion('playing', 'won')).toBe(true)
    expect(isFreshDanetkiCompletion('playing', 'lost')).toBe(true)
  })

  it('does not treat a mounted or reloaded result as a new completion', () => {
    expect(isFreshDanetkiCompletion('won', 'won')).toBe(false)
    expect(isFreshDanetkiCompletion('lost', 'lost')).toBe(false)
    expect(isFreshDanetkiCompletion('won', 'playing')).toBe(false)
  })
})
