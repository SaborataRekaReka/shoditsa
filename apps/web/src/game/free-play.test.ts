import { describe, expect, it } from 'vitest'
import { freePlayAnswerSalt, freePlayGameKey, freePlayLaunchFromGameKey } from './free-play'

describe('free-play sessions', () => {
  it('uses a distinct persisted key for every paid launch', () => {
    const baseKey = 'movie|all|2026-07-12'

    expect(freePlayGameKey(baseKey, 1)).toBe('movie|all|2026-07-12|free:1')
    expect(freePlayGameKey(baseKey, 2)).toBe('movie|all|2026-07-12|free:2')
    expect(freePlayGameKey(baseKey, 2)).not.toBe(`${baseKey}|salt:2`)
  })

  it('restores the paid launch identity from a saved game key', () => {
    const key = freePlayGameKey('music|all|2026-07-12|diff:medium', 4)

    expect(freePlayLaunchFromGameKey(key)).toBe(4)
    expect(freePlayLaunchFromGameKey('movie|all|2026-07-12|salt:4')).toBeNull()
    expect(freePlayAnswerSalt(4)).toBeGreaterThan(4)
  })
})
