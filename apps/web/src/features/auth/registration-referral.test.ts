import { describe, expect, it } from 'vitest'
import { registrationReferralFromSearch } from './registration-referral'

describe('registration referral', () => {
  it('recognizes the DTF registration link', () => {
    expect(registrationReferralFromSearch('?ref=dtf')).toBe('dtf')
    expect(registrationReferralFromSearch('?ref=%20DTF%20')).toBe('dtf')
  })

  it('does not accept unknown or missing referrals', () => {
    expect(registrationReferralFromSearch('?ref=unknown')).toBeNull()
    expect(registrationReferralFromSearch('')).toBeNull()
  })
})
