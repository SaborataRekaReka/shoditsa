import { describe, expect, it } from 'vitest'
import { growthFeatures, type GrowthPolicy } from '@shoditsa/contracts'
import { advanceGrowthPolicy, nextGrowthStageAt, normalizeGrowthPolicy } from '../src/modules/growth/service.js'

const baseline: GrowthPolicy = { stage: 'baseline', changedAt: null, registrationOpenedAt: null }
describe('sequential Diagnosis growth rollout', () => {
  it('defaults unknown settings to the untouched baseline', () => {
    expect(normalizeGrowthPolicy({ stage: 'everything', changedAt: 'bad' })).toEqual(baseline)
    expect(growthFeatures({ ...baseline, stage: 'club' }, new Date('2026-09-11T23:59:59Z')).replay).toBe(false)
  })
  it('protects the current measurement window and rejects skipped stages', () => {
    expect(() => advanceGrowthPolicy(baseline, 'replay', new Date('2026-09-11'))).toThrow(/окно/)
    expect(() => advanceGrowthPolicy(baseline, 'club', new Date('2026-09-12'))).toThrow(/по одному/)
  })
  it('requires seven complete UTC days after activation', () => {
    const replay = advanceGrowthPolicy(baseline, 'replay', new Date('2026-09-12T08:00Z'))
    expect(nextGrowthStageAt(replay)).toBe('2026-09-20T00:00:00.000Z')
    expect(() => advanceGrowthPolicy(replay, 'registration', new Date('2026-09-19T23:59Z'))).toThrow()
    const registration = advanceGrowthPolicy(replay, 'registration', new Date('2026-09-20'))
    expect(growthFeatures(registration, new Date('2026-09-20'))).toMatchObject({ replay: true, registration: true, club: false })
  })
  it('allows an immediate pause without forgetting the bonus campaign start', () => {
    const registration: GrowthPolicy = { stage: 'registration', changedAt: '2026-09-20T00:00:00Z', registrationOpenedAt: '2026-09-20T00:00:00Z' }
    expect(advanceGrowthPolicy(registration, 'baseline', new Date('2026-09-20T01:00Z'))).toMatchObject({ stage: 'baseline', registrationOpenedAt: registration.registrationOpenedAt })
  })
})
