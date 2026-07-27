import { describe, expect, it } from 'vitest'
import type { ConnectionsRoundPayload } from '@shoditsa/contracts'
import {
  buildConnectionsRuntimeRound,
  buildConnectionsShareRows,
  canonicalGuessSignature,
  evaluateConnectionsGuess,
  remainingTileIds,
  shouldAutoSolveFinalGroup,
  validateConnectionsRound,
} from '../src/connections'

const round: ConnectionsRoundPayload = {
  id: 'ru-test',
  difficulty: 'hard',
  tiles: [
    'МАТЬ', 'ОТЕЦ', 'ДЯДЯ', 'ТЁТЯ',
    'ЛАПТА', 'ЖМУРКИ', 'КАРТОШКА', 'ВЫШИБАЛЫ',
    'ДОМИНО', 'РЕБУС', 'КВАДРАТ', 'ФАСАД',
    'БРАТ', 'КОЧЕГАР', 'МИРАЖ', 'МОРФИЙ',
  ],
  groups: [
    { color: 'yellow', title: 'РОДСТВЕННИКИ', words: ['МАТЬ', 'ОТЕЦ', 'ДЯДЯ', 'ТЁТЯ'], hint: 'Семейное древо.' },
    { color: 'green', title: 'ДВОРОВЫЕ ИГРЫ', words: ['ЛАПТА', 'ЖМУРКИ', 'КАРТОШКА', 'ВЫШИБАЛЫ'], hint: 'Играют во дворе.' },
    { color: 'blue', title: 'ГЕОМЕТРИЯ', words: ['ДОМИНО', 'РЕБУС', 'КВАДРАТ', 'ФАСАД'], hint: 'Посмотрите на форму.' },
    { color: 'purple', title: 'АЛЬБОМЫ', words: ['БРАТ', 'КОЧЕГАР', 'МИРАЖ', 'МОРФИЙ'], hint: 'Музыкальные названия.' },
  ],
  editorial: { intendedTraps: [{ label: 'Почти семья', words: ['МАТЬ', 'ОТЕЦ', 'ДЯДЯ', 'БРАТ'] }] },
}

describe('connections core', () => {
  it('validates a 4×4 round', () => {
    expect(validateConnectionsRound(round).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('detects duplicate and unknown words', () => {
    const broken = structuredClone(round)
    broken.tiles[1] = 'МАТЬ'
    expect(validateConnectionsRound(broken).map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'tile.duplicate',
      'group.word_unknown',
    ]))
  })

  it('matches a group regardless of selection order', () => {
    const runtime = buildConnectionsRuntimeRound(round)
    expect(evaluateConnectionsGuess(runtime, [], ['t04', 't02', 't01', 't03'])).toMatchObject({
      result: 'correct',
      matchedColor: 'yellow',
    })
  })

  it('finds one-away without leaking a color', () => {
    const runtime = buildConnectionsRuntimeRound(round)
    expect(evaluateConnectionsGuess(runtime, [], ['t01', 't02', 't03', 't13'])).toEqual({
      result: 'one_away',
      matchedColor: null,
      oneAway: true,
    })
  })

  it('excludes solved groups and auto-solves after three', () => {
    const runtime = buildConnectionsRuntimeRound(round)
    expect(remainingTileIds(runtime, ['yellow'])).not.toContain('t01')
    expect(evaluateConnectionsGuess(runtime, ['yellow'], ['t01', 't02', 't03', 't04']).result).toBe('wrong')
    expect(shouldAutoSolveFinalGroup(['yellow', 'green', 'blue'])).toBe(true)
  })

  it('builds stable signatures and terminal share colors', () => {
    const runtime = buildConnectionsRuntimeRound(round)
    expect(canonicalGuessSignature(['t04', 't01', 't03', 't02'])).toBe('t01|t02|t03|t04')
    expect(buildConnectionsShareRows([{ tileIds: ['t01', 't05', 't09', 't13'], result: 'wrong' }], runtime)[0]).toEqual([
      'yellow', 'green', 'blue', 'purple',
    ])
  })
})
