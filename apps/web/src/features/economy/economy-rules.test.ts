import { describe, expect, it } from 'vitest'
import { economyDanetkiCost, economyStreakMilestoneReward } from '@shoditsa/contracts'
import { countWord, freePlayCost } from './economy-rules'

describe('economy rules', () => {
  it('uses the plural form for the full 11-19 range', () => {
    const forms: [string, string, string] = ['билет', 'билета', 'билетов']
    for (const count of [11, 12, 13, 14, 15, 16, 17, 18, 19, 111, 119]) {
      expect(countWord(count, forms)).toBe('билетов')
    }
  })

  it('uses the v2 free-play ladder', () => {
    expect(freePlayCost(0)).toBe(60)
    expect(freePlayCost(1)).toBe(80)
    expect(freePlayCost(3)).toBe(120)
  })

  it('uses independent Danetki room bases with a shared paid-launch step', () => {
    expect(economyDanetkiCost('solo', 0)).toBe(90)
    expect(economyDanetkiCost('group', 0)).toBe(120)
    expect(economyDanetkiCost('solo', 2)).toBe(150)
    expect(economyDanetkiCost('group', 2)).toBe(180)
  })

  it('only awards configured streak milestones', () => {
    expect([2, 3, 7, 14, 30, 31, 60].map((day) => economyStreakMilestoneReward(day))).toEqual([0, 3, 7, 12, 20, 0, 20])
  })
})
