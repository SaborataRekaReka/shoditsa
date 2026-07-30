import { describe, expect, it } from 'vitest'
import { DIAGNOSIS_METRIKA_GOALS } from './diagnosis-analytics'

describe('diagnosis Metrika goals', () => {
  it('keeps every configured JavaScript goal unique and valid', () => {
    const goals = Object.values(DIAGNOSIS_METRIKA_GOALS)

    expect(new Set(goals).size).toBe(goals.length)
    for (const goal of goals) {
      expect(goal).toMatch(/^[a-z][a-z0-9_]+$/)
      expect(goal.length).toBeLessThanOrEqual(32)
    }
  })
})
