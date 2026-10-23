import { describe, expect, it } from 'vitest'
import { hasSpecialAccess, specialDestination } from './special-navigation'
import { applicationLink } from './application-navigation'

describe('special navigation', () => {
  it.each(['club', 'personal', 'admin'] as const)('opens confirmed %s access in the same application', access => {
    const href = specialDestination('pack one/part', access)
    expect(hasSpecialAccess(access)).toBe(true)
    expect(href).toBe('/specials/pack%20one%2Fpart')
    expect(applicationLink(href, 'https://shoditsa.ru')).toBe(href)
  })
  it.each(['locked', null] as const)('opens the offer without verified access (%s)', access => {
    expect(hasSpecialAccess(access)).toBe(false)
    expect(specialDestination('dtf-game-comments-25-v1', access)).toBe('/club/membership')
  })
})
