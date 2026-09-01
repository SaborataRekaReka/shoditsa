import { describe, expect, it } from 'vitest'
import { territoryRoomRound } from '../src/modules/territory/service.js'

describe('territory room compatibility counter', () => {
  it('keeps extra siege questions inside the generic room constraint', () => {
    expect(territoryRoomRound(0)).toBe(0)
    expect(territoryRoomRound(20)).toBe(20)
    expect(territoryRoomRound(21)).toBe(20)
    expect(territoryRoomRound(80)).toBe(20)
  })
})
