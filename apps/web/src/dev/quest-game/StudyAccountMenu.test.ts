import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identity = vi.hoisted(() => ({ account: null as { user: { name: string; isAnonymous: boolean; role: string } } | null }))
vi.mock('./study-account-cache', () => ({ useStudyAccountCache: () => identity.account }))
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), useState: () => [true, vi.fn()] }))
vi.mock('./StudyTheme', () => ({ StudyThemeToggle: () => null }))
import { StudyAccountMenu } from './StudyAccountMenu'

const render = () => renderToStaticMarkup(createElement(StudyAccountMenu, { Glyph: () => null }))
beforeEach(() => { identity.account = null })

describe('account menu access and artwork', () => {
  it('keeps the guest menu free of admin navigation and the removed intro illustration', () => {
    const html = render()
    expect(html).toContain('Войти в аккаунт')
    expect(html).toContain('support-v1.png')
    expect(html).not.toContain('profile-journal-v1.png')
    expect(html).not.toContain('Админ-панель')
  })
  it.each([
    { role: 'user', isAnonymous: false, admin: false },
    { role: 'admin', isAnonymous: true, admin: false },
    { role: 'admin', isAnonymous: false, admin: true },
  ])('shows admin navigation only for an authenticated admin ($role, anonymous=$isAnonymous)', ({ role, isAnonymous, admin }) => {
    identity.account = { user: { name: 'Игрок', role, isAnonymous } }
    expect(render().includes('Админ-панель')).toBe(admin)
  })
})
