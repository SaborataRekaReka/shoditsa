import { describe, expect, it } from 'vitest'
import {
  clearRegistrationReferralCookie,
  normalizeRegistrationReferral,
  registrationReferralCookie,
  registrationReferralFromContext,
} from '../src/modules/users/badges.js'

describe('user badge registration referrals', () => {
  it('accepts only a known registration referral', () => {
    expect(normalizeRegistrationReferral('dtf')).toBe('dtf')
    expect(normalizeRegistrationReferral(' DTF ')).toBe('dtf')
    expect(normalizeRegistrationReferral('partner')).toBeNull()
    expect(normalizeRegistrationReferral(null)).toBeNull()
  })

  it('prefers the explicit registration header and falls back to the OAuth cookie', () => {
    expect(registrationReferralFromContext({
      getHeader: () => 'dtf',
      getCookie: () => null,
    })).toBe('dtf')
    expect(registrationReferralFromContext({
      getHeader: () => null,
      getCookie: () => 'dtf',
    })).toBe('dtf')
    expect(registrationReferralFromContext({
      getHeader: () => 'unknown',
      getCookie: () => 'dtf',
    })).toBe('dtf')
  })

  it('creates a short-lived, HTTP-only OAuth handoff cookie', () => {
    expect(registrationReferralCookie('dtf', true)).toContain('Max-Age=1800')
    expect(registrationReferralCookie('dtf', true)).toContain('HttpOnly')
    expect(registrationReferralCookie('dtf', true)).toContain('SameSite=Lax')
    expect(registrationReferralCookie('dtf', true)).toContain('Secure')
    expect(clearRegistrationReferralCookie(false)).toContain('Max-Age=0')
  })
})
