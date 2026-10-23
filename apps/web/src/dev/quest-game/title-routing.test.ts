import { describe, expect, it } from 'vitest'
import { INDEXABLE_GAME_SEO } from '../../app/seo-content'
import { studyTitleMode, studyTitleRequest } from './title-routing'

describe('local shared title routing', () => {
  it.each(INDEXABLE_GAME_SEO)('opens $mode in the same title template', game => {
    expect(studyTitleMode(game.canonicalPath, '?mode=invalid')).toBe(game.mode)
    const rewritten = new URL(studyTitleRequest(`${game.canonicalPath}?tone=dark&mode=invalid`)!, 'http://localhost')
    expect(rewritten.pathname).toBe('/shoditsa-title.html')
    expect(rewritten.searchParams.get('mode')).toBe(game.mode)
    expect(rewritten.searchParams.get('tone')).toBe('dark')
  })
  it('retains the standalone entry and leaves unrelated URLs alone', () => {
    expect(studyTitleMode('/shoditsa-title.html', '?mode=music')).toBe('music')
    expect(studyTitleMode('/shoditsa-title.html', '?mode=invalid')).toBe('anime')
    for (const path of ['/', '/games/unknown', '/api/session', '/danetki', '/shoditsa-play.html']) expect(studyTitleRequest(path)).toBeUndefined()
  })
})
