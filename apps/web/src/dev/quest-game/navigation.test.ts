import { describe, expect, it } from 'vitest'
import { STUDY_CLUB_HREF } from './account-routing'
import { studyNavItems, studyMenuView, studyViewFromHash } from './navigation'

describe('Shoditsa study navigation', () => {
  it('places Archive last and handles Club in the shared section navigation', () => {
    const items = studyNavItems(true)
    expect(items.map(item => item.label)).toEqual(['Игры', 'Лобби', 'Рейтинг', 'Задания', 'Клуб', 'Профиль', 'Архив'])
    const club = items.find(item => item.id === 'club')
    expect(club).toMatchObject({ id: 'club', glyph: 'medal', href: STUDY_CLUB_HREF })
    expect(studyViewFromHash('#club', false, true)).toBe('club')
    expect(studyViewFromHash('#club-offer', false, true)).toBe('club-offer')
    expect(studyViewFromHash('#/club?preview=reference&section=offers', false, true)).toBe('club-offer')
    expect(studyViewFromHash('#club', false, false)).toBeUndefined()
    expect(studyNavItems(false).map(item => item.id)).toEqual(['play', 'archive', 'league', 'quests', 'profile'])
  })
  it('opens all games from Play in the menu, while preserving other menu targets', () => {
    expect(studyMenuView('play', true)).toBe('games')
    expect(studyMenuView('archive', true)).toBe('archive')
    expect(studyMenuView('play', false)).toBe('play')
  })
  it('repairs old title menu links without changing session launches', () => {
    expect(studyViewFromHash('#play', true, true)).toBe('games')
    expect(studyViewFromHash('#play', false, true)).toBe('play')
    expect(studyViewFromHash('#play', true, false)).toBe('play')
  })
  it('supports direct catalogue links and ignores unknown fragments', () => {
    expect(studyViewFromHash('#games', false, true)).toBe('games')
    expect(studyViewFromHash('#title', true, true)).toBe('title')
    expect(studyViewFromHash('#unknown', true, true)).toBeUndefined()
  })
  it('opens standalone settings only in the Shoditsa app', () => {
    expect(studyViewFromHash('#settings', true, true)).toBe('settings')
    expect(studyViewFromHash('#settings', false, true)).toBe('settings')
    expect(studyViewFromHash('#settings', false, false)).toBeUndefined()
  })
})
