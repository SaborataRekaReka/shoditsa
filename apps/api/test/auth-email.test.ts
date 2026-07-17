import { describe, expect, it } from 'vitest'
import { renderAuthEmail } from '../src/modules/auth/email.js'

describe('authentication email templates', () => {
  it.each([
    ['verification', 'Подтвердить email'],
    ['password-reset', 'Сменить пароль'],
  ] as const)('renders a usable %s email in HTML and plain text', (kind, action) => {
    const url = `https://shoditsa.ru/login?token=test-${kind}`
    const message = renderAuthEmail(kind, url)

    expect(message.subject).toContain('Сходится!')
    expect(message.text).toContain(url)
    expect(message.text).toContain(action)
    expect(message.html).toContain(`href="${url}"`)
    expect(message.html).toContain(action)
  })

  it('escapes untrusted URL characters in HTML', () => {
    const message = renderAuthEmail('password-reset', 'https://example.test/?next="<script>')
    expect(message.html).not.toContain('<script>')
    expect(message.html).toContain('&quot;&lt;script&gt;')
  })
})
