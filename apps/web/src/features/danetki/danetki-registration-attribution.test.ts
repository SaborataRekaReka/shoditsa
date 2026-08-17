import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDanetkiRegistrationIntent,
  danetkiRegistrationHref,
  readDanetkiRegistrationIntent,
  readDanetkiTrafficContext,
  rememberDanetkiRegistrationIntent,
  rememberDanetkiTrafficContext,
} from './danetki-registration-attribution'

describe('Danetki registration attribution', () => {
  const values = new Map<string, string>()
  beforeEach(() => {
    values.clear()
    vi.stubGlobal('window', {
      location: { origin: 'https://shoditsa.ru' },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    })
    clearDanetkiRegistrationIntent()
  })

  it('keeps a safe return URL and placement for signup attribution', () => {
    const href = danetkiRegistrationHref('result', '/sessions/example?from=danetki')
    expect(href).toContain('/register?')
    expect(href).toContain('source=danetki')
    rememberDanetkiRegistrationIntent('result', '/sessions/example?from=danetki')
    expect(readDanetkiRegistrationIntent()).toMatchObject({ source: 'danetki', placement: 'result', returnUrl: '/sessions/example?from=danetki' })
  })

  it('rejects external return URLs', () => {
    rememberDanetkiRegistrationIntent('catalog', 'https://example.com/steal')
    expect(readDanetkiRegistrationIntent()?.returnUrl).toBe('/games/danetki')
  })

  it('carries the SEO collection through the registration funnel', () => {
    rememberDanetkiTrafficContext('catalog', 'slozhnye')
    expect(readDanetkiTrafficContext()).toEqual({ entrySource: 'catalog', collection: 'slozhnye' })
    rememberDanetkiRegistrationIntent('investigation', '/sessions/example', 'danetka_2026_006')
    expect(readDanetkiRegistrationIntent()).toMatchObject({
      entrySource: 'catalog',
      collection: 'slozhnye',
      story: 'danetka_2026_006',
    })
  })
})
