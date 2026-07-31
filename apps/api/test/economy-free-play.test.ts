import { describe, expect, it } from 'vitest'
import { unseenFreePlayCandidates } from '../src/modules/economy/service.js'

describe('free-play answer selection', () => {
  const animals = [
    { id: 'animal:wolf' },
    { id: 'animal:fox' },
    { id: 'animal:bear' },
  ]

  it('excludes answers already shown to the player today', () => {
    expect(unseenFreePlayCandidates(animals, ['animal:wolf', 'animal:bear'])).toEqual([
      { id: 'animal:fox' },
    ])
  })

  it('reuses the full pool only after every answer has been shown', () => {
    expect(unseenFreePlayCandidates(animals, animals.map((item) => item.id))).toEqual(animals)
  })
})
