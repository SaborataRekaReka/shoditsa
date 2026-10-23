import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../api/client'
import { STUDY_CLUB_OFFER_HREF } from './account-routing'
import { StudyHeader } from './StudyHeader'

const account = vi.hoisted(() => ({ commerce: null as { membership: { active: boolean } } | null, dashboard: null as { membership: { active: boolean } } | null }))
vi.mock('./study-account-cache', () => ({ useStudyAccountCache: (key: readonly unknown[]) => key === queryKeys.commerce ? account.commerce : key === queryKeys.dashboard ? account.dashboard : null }))
const Glyph = () => null
const headerHref = () => renderToStaticMarkup(createElement(StudyHeader, { Glyph })).match(/class="study-club-link" href="([^"]+)"/)?.[1]
afterEach(() => { account.commerce = null; account.dashboard = null })

describe('header Club invitation', () => {
  it('offers membership to guests and players without an active ticket', () => {
    expect(headerHref()).toBe(STUDY_CLUB_OFFER_HREF)
    account.commerce = { membership: { active: false } }
    expect(headerHref()).toBe(STUDY_CLUB_OFFER_HREF)
  })
  it('hides the invitation for members and prefers the commerce status over older dashboard data', () => {
    account.dashboard = { membership: { active: true } }
    expect(headerHref()).toBeUndefined()
    account.commerce = { membership: { active: false } }
    expect(headerHref()).toBe(STUDY_CLUB_OFFER_HREF)
    account.commerce = { membership: { active: true } }
    expect(headerHref()).toBeUndefined()
  })
})
