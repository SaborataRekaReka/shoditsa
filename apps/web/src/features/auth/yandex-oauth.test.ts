import { describe, expect, it } from 'vitest'
import { detectYandexOAuthCountry, localizeYandexOAuthUrl } from './yandex-oauth'

const oauthUrl = 'https://oauth.yandex.com/authorize?response_type=code&state=state-123&redirect_uri=https%3A%2F%2Fshoditsa.ru%2Fapi%2Fauth%2Foauth2%2Fcallback%2Fyandex'

describe('Yandex OAuth regional host', () => {
  it('uses the Kazakhstan cookie domain for a Kazakhstan timezone', () => {
    expect(detectYandexOAuthCountry({ languages: ['en-US'], timeZone: 'Asia/Qyzylorda' })).toBe('KZ')
    expect(new URL(localizeYandexOAuthUrl(oauthUrl, { languages: ['en-US'], timeZone: 'Asia/Qyzylorda' })).hostname).toBe('oauth.yandex.kz')
  })

  it('supports the regional Yandex domains exposed by browser locales', () => {
    expect(new URL(localizeYandexOAuthUrl(oauthUrl, { languages: ['ru-BY'], timeZone: 'UTC' })).hostname).toBe('oauth.yandex.by')
    expect(new URL(localizeYandexOAuthUrl(oauthUrl, { languages: ['tr'], timeZone: 'Europe/Istanbul' })).hostname).toBe('oauth.yandex.com.tr')
  })

  it('falls back to yandex.com when no supported country can be detected', () => {
    expect(new URL(localizeYandexOAuthUrl(oauthUrl, { languages: ['en-US'], timeZone: 'America/New_York' })).hostname).toBe('oauth.yandex.com')
  })

  it('preserves OAuth state and callback parameters while changing only the hostname', () => {
    const localized = new URL(localizeYandexOAuthUrl(oauthUrl, { languages: ['kk-KZ'], timeZone: 'UTC' }))
    expect(localized.searchParams.get('state')).toBe('state-123')
    expect(localized.searchParams.get('redirect_uri')).toBe('https://shoditsa.ru/api/auth/oauth2/callback/yandex')
    expect(localized.pathname).toBe('/authorize')
  })

  it('rejects authorization URLs outside the Yandex OAuth allowlist', () => {
    expect(() => localizeYandexOAuthUrl('https://example.com/authorize?state=stolen')).toThrow('untrusted authorization URL')
  })
})
