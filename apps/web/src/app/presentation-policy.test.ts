import { describe, expect, it } from 'vitest'
import { isPublicPresentationPath, resolvePresentation } from './presentation-policy'

describe('public presentation boundary', () => {
  it('uses the new design as the released application default regardless of preview preferences', () => {
    expect(resolvePresentation({ dev: false, application: true, requested: 'legacy', saved: 'legacy' })).toBe('reference')
  })
  it('never changes the released skin through a preview query or saved preference', () => {
    expect(resolvePresentation({ dev: false, configured: 'reference', requested: 'reference', saved: 'reference' })).toBe('legacy')
  })
  it('keeps the connected profile stable across links and gives an explicit local override priority', () => {
    expect(resolvePresentation({ dev: true, configured: 'reference', requested: 'legacy' })).toBe('reference')
    expect(resolvePresentation({ dev: true, saved: 'reference' })).toBe('reference')
    expect(resolvePresentation({ dev: true, requested: 'legacy', saved: 'reference' })).toBe('legacy')
  })
  it('uses a valid local preference when an unknown query or configuration is present', () => {
    expect(resolvePresentation({ dev: true, configured: 'invalid', requested: 'reference', saved: 'legacy' })).toBe('reference')
    expect(resolvePresentation({ dev: true, requested: 'invalid', saved: 'afisha' })).toBe('afisha')
    expect(resolvePresentation({ dev: true, configured: 'invalid', requested: 'invalid', saved: 'invalid' })).toBe('legacy')
  })
  it('isolates administrative routes without excluding public authentication or portals', () => {
    for (const path of ['/admin', '/admin/users', '/review/music', '/review/music/catalog']) expect(isPublicPresentationPath(path)).toBe(false)
    for (const path of ['/', '/login', '/register', '/forgot-password', '/reset-password', '/auth/callback', '/ui-kit', '/profile', '/play/anime', '/administrator', '/review/musical']) expect(isPublicPresentationPath(path)).toBe(true)
  })
})
