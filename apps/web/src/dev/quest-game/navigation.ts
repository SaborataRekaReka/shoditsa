import { STUDY_CLUB_HREF } from './account-routing'

export type StudyView = 'play' | 'games' | 'title' | 'archive' | 'league' | 'quests' | 'profile' | 'settings' | 'club' | 'club-offer' | 'kit' | 'lobby'

export const STUDY_NAV_ITEMS = [
  { id: 'play', label: 'Играть', glyph: 'play' },
  { id: 'archive', label: 'Архив', glyph: 'archive' },
  { id: 'league', label: 'Рейтинг', glyph: 'league' },
  { id: 'quests', label: 'Задания', glyph: 'quests' },
  { id: 'profile', label: 'Профиль', glyph: 'profile' },
] as const

/** Shared study sections use the same in-document navigation. */
export const SHODITSA_STUDY_NAV_ITEMS = [
  { ...STUDY_NAV_ITEMS[0], label: 'Игры' },
  { id: 'lobby', label: 'Лобби', glyph: 'play' },
  STUDY_NAV_ITEMS[2],
  STUDY_NAV_ITEMS[3],
  { id: 'club', label: 'Клуб', glyph: 'medal', href: STUDY_CLUB_HREF },
  STUDY_NAV_ITEMS[4],
  STUDY_NAV_ITEMS[1],
] as const

export const studyNavItems = (shoditsa: boolean) => shoditsa ? SHODITSA_STUDY_NAV_ITEMS : STUDY_NAV_ITEMS

const hashViews: StudyView[] = ['play', 'games', 'title', 'archive', 'league', 'quests', 'profile', 'settings']

export function studyViewFromHash(hash: string, titleEntry: boolean, shoditsa: boolean): StudyView | undefined {
  if (shoditsa && /^#\/?club(?:\?|$)/.test(hash)) return new URLSearchParams(hash.split('?')[1]).get('section') === 'offers' ? 'club-offer' : 'club'
  if (shoditsa && hash === '#club-offer') return 'club-offer'
  const view = hash.replace(/^#/, '') as StudyView
  if (!hashViews.includes(view)) return undefined
  if (view === 'settings' && !shoditsa) return undefined
  // Old title links used #play for the menu, rather than a session launch.
  if (shoditsa && titleEntry && view === 'play') return 'games'
  return view
}

export function studyMenuView(view: StudyView, shoditsa: boolean): StudyView {
  return shoditsa && view === 'play' ? 'games' : view
}
