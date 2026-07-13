import { describe, expect, it } from 'vitest'
import { loadConfig } from '@shoditsa/config'
import { decryptIntegrationValue, encryptIntegrationValue } from '../src/modules/admin/integration-secrets.js'

describe('admin integration secret encryption', () => {
  it('round-trips without storing plaintext', () => {
    process.env.BETTER_AUTH_SECRET ||= 'integration-secret-tests-at-least-32-characters'
    process.env.PROMO_CODE_PEPPER ||= 'integration-secret-tests-promo-pepper-32'
    const config = loadConfig()
    const value = 'sk-example-secret-value-1234'
    const encrypted = encryptIntegrationValue(value, config)
    expect(encrypted.encryptedValue).not.toContain(value)
    expect(encrypted.lastFour).toBe('1234')
    expect(decryptIntegrationValue(encrypted, config)).toBe(value)
  })
})
