import { describe, expect, it } from 'vitest'
import { sortedWordGuesses, wordCountLabel, wordRankWidth } from './word-presentation'
describe('semantic rank presentation', () => {
  it('keeps closer ranks visually ahead, including dictionary boundaries', () => {
    const ranks = [1, 2, 10, 100, 500, 1000, 10000, 29558]
    const widths = ranks.map(rank => wordRankWidth(rank, 29558))
    expect(widths[0]).toBe(100)
    expect(widths.every(width => width >= 3 && width <= 100)).toBe(true)
    expect(widths).toEqual([...widths].sort((a, b) => b - a))
    expect(wordRankWidth(0, 29558)).toBe(100)
    expect(wordRankWidth(50000, 29558)).toBe(3)
  })
  it('sorts a separate history while retaining the latest server position', () => {
    const guesses = [{ position: 1, word: 'море', rank: 1000, source: 'guess' as const }, { position: 2, word: 'лес', rank: 100, source: 'guess' as const }, { position: 3, word: 'дом', rank: 500, source: 'hint' as const }]
    expect(sortedWordGuesses(guesses).map(row => row.word)).toEqual(['лес', 'дом', 'море'])
    expect(guesses.at(-1)?.word).toBe('дом')
  })
  it.each([[1, '1 попытка'], [2, '2 попытки'], [5, '5 попыток'], [11, '11 попыток'], [21, '21 попытка']])('uses natural count copy for %i', (count, label) => {
    expect(wordCountLabel(count as number, ['попытка', 'попытки', 'попыток'])).toBe(label)
  })
})
