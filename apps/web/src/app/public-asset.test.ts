import { describe, expect, it } from 'vitest'
import { joinPublicAssetUrl, publicAssetUrl } from './public-asset'

describe('public asset URLs', () => {
  it('uses root-relative URLs in the hosted SPA', () => {
    expect(joinPublicAssetUrl('./images/logo.svg', '/')).toBe('/images/logo.svg')
    expect(joinPublicAssetUrl('/images/hero.webp', '/')).toBe('/images/hero.webp')
    expect(publicAssetUrl('images/symbol.svg')).toBe('/images/symbol.svg')
  })

  it('keeps autonomous bundle assets relative to its entry point', () => {
    expect(joinPublicAssetUrl('/images/logo.svg', './')).toBe('./images/logo.svg')
    expect(joinPublicAssetUrl('images/hero.webp', './game/')).toBe('./game/images/hero.webp')
  })
})
