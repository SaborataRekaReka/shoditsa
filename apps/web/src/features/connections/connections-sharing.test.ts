import { describe, expect, it } from 'vitest'
import type { ConnectionsGameState } from '@shoditsa/contracts'
import { connectionsShareText } from './connections-sharing'

const state: ConnectionsGameState = {
  tiles: [],
  solvedGroups: [],
  hints: [],
  mistakesUsed: 1,
  mistakesRemaining: 3,
  maxMistakes: 4,
  maxGuesses: 6,
  hintAvailableAt: null,
  status: 'won',
  guesses: [
    {
      position: 1,
      tileIds: ['t01', 't05', 't09', 't13'],
      result: 'wrong',
      colorRow: ['yellow', 'green', 'blue', 'purple'],
    },
    {
      position: 2,
      tileIds: ['t01', 't02', 't03', 't04'],
      result: 'correct',
      matchedColor: 'yellow',
      colorRow: ['yellow', 'yellow', 'yellow', 'yellow'],
    },
  ],
}

describe('connections sharing', () => {
  it('contains only the public day, color rows, and game URL', () => {
    const text = connectionsShareText('2026-07-27', state)

    expect(text).toContain('Сходится! Связи №')
    expect(text).toContain('🟨🟩🟦🟪')
    expect(text).toContain('🟨🟨🟨🟨')
    expect(text).toContain('shoditsa.ru/games/connections')
    expect(text).not.toMatch(/t0[1-9]|Оканчиваются|МАЙ/)
  })

  it('does not expose in-progress guesses without terminal color rows', () => {
    const playing = structuredClone(state)
    playing.status = 'playing'
    playing.guesses = [{
      position: 1,
      tileIds: ['t01', 't02', 't03', 't04'],
      result: 'one_away',
    }]

    expect(connectionsShareText('2026-07-27', playing)).not.toContain('🟨')
  })
})
