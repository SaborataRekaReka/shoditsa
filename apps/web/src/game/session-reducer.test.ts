import { describe, expect, it } from 'vitest'
import { createInitialGameSessionState, gameSessionReducer } from './session-reducer'

describe('saved game restoration', () => {
  it('restores attempts and clears stale composer state', () => {
    const dirty = { ...createInitialGameSessionState(), query: 'старый запрос', message: 'ошибка' }
    const restored = gameSessionReducer(dirty, {
      type: 'reset',
      payload: { attempts: [{ titleId: 'movie-1', hints: [] }], status: 'playing', hintChoices: [], dismissedHintRounds: [] },
    })
    expect(restored.attempts).toHaveLength(1)
    expect(restored.query).toBe('')
    expect(restored.message).toBe('')
  })
})
