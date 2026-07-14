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

  it('keeps composer invariants during rapid mixed actions', () => {
    let state = createInitialGameSessionState()
    const letters = ['а', 'б', 'в', 'г', 'д', 'е']

    for (let index = 0; index < 120; index += 1) {
      state = gameSessionReducer(state, { type: 'append_query_char', char: letters[index % letters.length] })
      if (index % 3 === 0) state = gameSessionReducer(state, { type: 'backspace_query' })
      if (index % 5 === 0) state = gameSessionReducer(state, { type: 'set_active_index', index: (index % 4) - 1 })
      if (index % 7 === 0) state = gameSessionReducer(state, { type: 'set_message', message: `m-${index}` })

      if (index % 11 === 0) {
        state = gameSessionReducer(state, {
          type: 'submit_attempt',
          attempts: [{ titleId: `title-${index}`, hints: [] }],
          status: index % 22 === 0 ? 'playing' : 'won',
        })
        expect(state.query).toBe('')
        expect(state.selected).toBeNull()
        expect(state.activeSuggestionIndex).toBe(-1)
        expect(state.message).toBe('')
      }
    }

    const restored = gameSessionReducer(state, {
      type: 'reset',
      payload: {
        attempts: [{ titleId: 'restored-title', hints: [] }],
        status: 'playing',
        hintChoices: [],
        dismissedHintRounds: [],
      },
    })
    expect(restored.attempts).toHaveLength(1)
    expect(restored.query).toBe('')
    expect(restored.selected).toBeNull()
    expect(restored.activeSuggestionIndex).toBe(-1)
    expect(restored.message).toBe('')
  })
})
