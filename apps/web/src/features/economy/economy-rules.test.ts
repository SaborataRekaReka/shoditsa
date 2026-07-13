import { describe, expect, it } from 'vitest'
import { countWord, freePlayCost } from './economy-rules'

describe('economy rules', () => {
  it('uses the plural form for the full 11-19 range', () => {
    const forms: [string, string, string] = ['билет', 'билета', 'билетов']
    for (const count of [11, 12, 13, 14, 15, 16, 17, 18, 19, 111, 119]) {
      expect(countWord(count, forms)).toBe('билетов')
    }
  })

  it('increases free-play cost by 15 per launch', () => {
    expect(freePlayCost(0)).toBe(45)
    expect(freePlayCost(1)).toBe(60)
    expect(freePlayCost(3)).toBe(90)
  })
})
