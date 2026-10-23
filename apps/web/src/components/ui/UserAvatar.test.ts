import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { avatarInitials, UserAvatar } from './UserAvatar'

describe('account avatar', () => {
  it('uses the account portrait with a private referrer policy', () => {
    const html = renderToStaticMarkup(createElement(UserAvatar, { name: 'Алекс Бренейзе', src: 'https://example.com/avatar.jpg' }))
    expect(html).toContain('src="https://example.com/avatar.jpg"')
    expect(html).toContain('referrerPolicy="no-referrer"')
  })
  it('uses personal initials or a guest silhouette without a portrait', () => {
    expect(avatarInitials('  Алекс  Бренейзе  ')).toBe('АБ')
    expect(avatarInitials('Алекс')).toBe('А')
    expect(renderToStaticMarkup(createElement(UserAvatar, { name: 'Алекс Бренейзе', src: 'javascript:alert(1)' }))).toContain('АБ')
    expect(renderToStaticMarkup(createElement(UserAvatar))).toContain('<svg')
  })
  it('adds the club frame only for the active membership variant, including portrait fallbacks', () => {
    const plain = renderToStaticMarkup(createElement(UserAvatar, { name: 'Алекс' }))
    const club = renderToStaticMarkup(createElement(UserAvatar, { name: 'Алекс', club: true }))
    expect(plain).not.toContain('user-avatar--club')
    expect(plain).not.toContain('user-avatar__club-star')
    expect(club).toContain('user-avatar--club')
    expect(club).toContain('user-avatar__club-star')
    expect(club).toContain('А')
  })
})
