import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('./application-design', () => ({ APPLICATION_DESIGN: true }))
import { applyApplicationPresentation, applyPublicPresentation } from './local-presentation'

afterEach(() => vi.unstubAllGlobals())
describe('application theme ownership', () => {
  it.each(['/games/movie', '/specials/dtf-game-comments-25-v1', '/games/together', '/sessions/example'])('keeps %s stable for either frame/router effect order', path => {
    const dataset: Record<string,string> = {}
    vi.stubGlobal('document', { documentElement: { dataset } })
    applyApplicationPresentation()
    applyPublicPresentation(path)
    expect(dataset.publicTheme).toBe('quest-study')
    applyPublicPresentation(path)
    applyApplicationPresentation()
    expect(dataset.publicTheme).toBe('quest-study')
  })
  it('does not apply the public skin to admin and review tools', () => {
    const dataset: Record<string,string> = { publicTheme: 'quest-study' }
    vi.stubGlobal('document', { documentElement: { dataset } })
    applyPublicPresentation('/admin')
    expect(dataset.publicTheme).toBeUndefined()
    applyPublicPresentation('/review/music')
    expect(dataset.publicTheme).toBeUndefined()
  })
})
