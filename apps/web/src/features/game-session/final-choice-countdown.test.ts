import { describe, expect, it } from 'vitest'
import { FINAL_CHOICE_DURATION_SECONDS, finalChoiceSecondsRemaining } from './final-choice-countdown.js'

describe('final choice countdown', () => {
  it('starts at 45 seconds when the server deadline is 45 seconds away', () => {
    expect(finalChoiceSecondsRemaining('2026-07-25T12:00:45.000Z', Date.parse('2026-07-25T12:00:00.000Z'))).toBe(45)
  })

  it('rounds partial seconds up and never becomes negative', () => {
    expect(finalChoiceSecondsRemaining('2026-07-25T12:00:10.000Z', Date.parse('2026-07-25T12:00:09.100Z'))).toBe(1)
    expect(finalChoiceSecondsRemaining('2026-07-25T12:00:10.000Z', Date.parse('2026-07-25T12:00:11.000Z'))).toBe(0)
  })

  it('uses the 45-second default before a server deadline is available', () => {
    expect(finalChoiceSecondsRemaining(undefined)).toBe(FINAL_CHOICE_DURATION_SECONDS)
  })
})
