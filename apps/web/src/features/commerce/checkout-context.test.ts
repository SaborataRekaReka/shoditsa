import { describe, expect, it } from 'vitest'
import { checkoutContext, checkoutRegistrationHref } from './checkout-context'

const id = 'e062fb3e-2c8c-4375-8977-fd80c7e73140'
describe('checkout intent across authentication', () => {
  it('preserves the chosen plan and Diagnosis context without triggering an order', () => {
    const context = checkoutContext('?from=diagnosis', 'club_30d', () => id)
    const registration = new URL(checkoutRegistrationHref('/club#club-offers', 'club_30d', context), 'https://shoditsa.ru')
    const after = new URL(registration.searchParams.get('returnUrl')!, registration.origin)
    expect(after.pathname).toBe('/club')
    expect(after.hash).toBe('#club-offers')
    expect(after.searchParams.get('product')).toBe('club_30d')
    expect(checkoutContext(after.search, 'club_30d', () => 'wrong')).toEqual(context)
  })
  it('does not reuse another product intent or arbitrary source data', () => {
    expect(checkoutContext(`?product=club_365d&intent=${id}&from=private-dtf`, 'club_30d', () => 'fresh')).toEqual({ intentId: 'fresh', sourceMode: undefined })
  })
  it('rejects an external return URL', () => {
    expect(() => checkoutRegistrationHref('https://example.test', 'club_30d', { intentId: id, sourceMode: undefined })).toThrow()
  })
})
