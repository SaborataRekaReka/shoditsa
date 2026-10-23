import { isPlayableModeId } from '@shoditsa/contracts'
import { isStudyRootHomeLocation } from '../../dev/quest-game/home-route'

export const APPLICATION_PATHS = {
  games: '/', archive: '/archive', league: '/leaderboard', quests: '/quests',
  profile: '/profile', settings: '/settings', club: '/club', 'club-offer': '/club/membership',
  lobby: '/lobby',
} as const
export type ApplicationSection = keyof typeof APPLICATION_PATHS
export type ApplicationLocation = { pathname: string; search: string; hash: string }

export const applicationHref = (view: string) => APPLICATION_PATHS[(view === 'play' ? 'games' : view) as ApplicationSection] ?? '/'

export function applicationSection(pathname: string): ApplicationSection | undefined {
  const path = pathname.replace(/\/$/, '') || '/'
  return (Object.keys(APPLICATION_PATHS) as ApplicationSection[]).find(key => APPLICATION_PATHS[key] === path)
}

/** Primary sections share one product shell on direct loads and reloads. */
export function isApplicationShellPage(location: ApplicationLocation, server: boolean): boolean {
  const section = applicationSection(location.pathname)
  if (section === 'lobby') return false
  if (section === 'games') return isStudyRootHomeLocation(location)
  if (section) return true
  const mode = location.pathname.match(/^\/games\/([^/]+)$/)?.[1]
  return !server && !!mode && isPlayableModeId(mode)
}

/** Compatibility only: new navigation never emits a prototype URL or preview parameter. */
export function canonicalApplicationHref(location: ApplicationLocation): string | undefined {
  const params = new URLSearchParams(location.search)
  let path = location.pathname
  let hash = location.hash
  if (path === '/shoditsa-play.html') {
    const mode = params.get('mode') ?? 'anime'
    path = isPlayableModeId(mode) ? `/play/${mode}` : '/'
    params.delete('mode'); hash = ''
  }
  if (['/', '/index.html', '/shoditsa-title.html', '/shoditsa-home.html'].includes(path)) {
    const legacy = hash.replace(/^#\/?/, '').split('?')[0]
    const section = legacy === 'club' && new URLSearchParams(hash.split('?')[1]).get('section') === 'offers'
      ? 'club-offer' : legacy === 'play' ? 'games' : legacy
    if (section in APPLICATION_PATHS) { path = APPLICATION_PATHS[section as ApplicationSection]; hash = '' }
    else if (/^(?:play|games|sessions)\//.test(legacy)) { path = `/${legacy}`; hash = ''; for (const [key, value] of new URLSearchParams(location.hash.split('?')[1])) if (key !== 'preview') params.set(key, value) }
    else if (path === '/shoditsa-home.html') { path = '/'; hash = '' }
    else if (path === '/shoditsa-title.html') {
      const mode = params.get('mode') ?? 'anime'
      path = isPlayableModeId(mode) ? `/games/${mode}` : '/'
      params.delete('mode'); hash = ''
    }
  }
  if (params.has('studyMode') && /^\/play\//.test(path)) {
    for (const [from, to] of [['studyPeriod', 'period'], ['studyDifficulty', 'difficulty'], ['studyVariant', 'variant']]) {
      const value = params.get(from)
      if (value && !(to === 'period' && value === 'all') && !(to === 'difficulty' && value === 'medium')) params.set(to, value)
      params.delete(from)
    }
    params.delete('studyMode')
  }
  params.delete('preview')
  const href = `${path}${params.size ? `?${params}` : ''}${hash}`
  return href === `${location.pathname}${location.search}${location.hash}` ? undefined : href
}
