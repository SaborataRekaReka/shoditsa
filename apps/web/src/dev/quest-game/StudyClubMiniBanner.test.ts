import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { queryKeys } from '../../api/client'
import { clubSidebarPromo, StudyClubMiniBanner } from './StudyClubMiniBanner'

const account = vi.hoisted(() => ({ commerce: null as { membership: { active: boolean } } | null, dashboard: null as { membership: { active: boolean } } | null }))
vi.mock('./study-account-cache', () => ({ useStudyAccountCache: (key: readonly unknown[]) => key === queryKeys.commerce ? account.commerce : key === queryKeys.dashboard ? account.dashboard : null }))
afterEach(() => { account.commerce = null; account.dashboard = null })

it('не рекламирует Клуб на страницах самого Клуба', () => {
  expect(clubSidebarPromo('club-offer', false, 0)).toBe('friends')
  expect(clubSidebarPromo('club', true, 0)).toBe('specials')
  expect(clubSidebarPromo('club', true, 1)).toBe('friends')
  expect(clubSidebarPromo(undefined, false, 0)).toBe('club')
})

it('предлагает участникам игры вместо вступления в любом разделе', () => {
  for (const context of [undefined, 'club', 'club-offer'] as const) {
    expect(clubSidebarPromo(context, true, 0)).toBe('specials')
    expect(clubSidebarPromo(context, true, 1)).toBe('friends')
  }
})

it('учитывает членство из аккаунта без отдельного свойства страницы', () => {
  account.dashboard = { membership: { active: true } }
  expect(renderToStaticMarkup(createElement(StudyClubMiniBanner))).not.toContain('Вступи в клуб')
  account.commerce = { membership: { active: false } }
  expect(renderToStaticMarkup(createElement(StudyClubMiniBanner))).toContain('Вступи в клуб')
  account.commerce = { membership: { active: true } }
  const html = renderToStaticMarkup(createElement(StudyClubMiniBanner))
  expect(html).not.toContain('Вступи в клуб')
  expect(html).toMatch(/href="\/(specials|games\/together)"/)
})
