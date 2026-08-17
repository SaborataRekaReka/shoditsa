import { isPlayableModeId, type PlayableModeId } from '@shoditsa/contracts'
import { isLegalDocumentSlug, type LegalDocumentSlug } from '../features/legal/legal'

export type PlayerScreen = 'hub' | 'title' | 'game' | 'danetki' | 'danetki-catalog' | 'danetki-story' | 'danetki-join' | 'friends-intro' | 'friends-room' | 'rewatch' | 'review' | 'profile' | 'club' | 'purchase-return' | 'specials' | 'special' | 'create-game' | 'legal'

export type PlayerRouteState = {
  screen: PlayerScreen
  mode?: PlayableModeId
  sessionId?: string
  packId?: string
  legalDocument?: LegalDocumentSlug
  inviteToken?: string
  danetkiSlug?: string
  danetkiCollection?: 'dlya-detey'
}

const decodedSegment = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const playerRouteFromPathname = (pathname: string): PlayerRouteState => {
  const normalized = `/${pathname}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
  if (normalized === '/archive') return { screen: 'rewatch' }
  if (normalized === '/profile') return { screen: 'profile' }
  if (normalized === '/club') return { screen: 'club' }
  if (normalized === '/specials') return { screen: 'specials' }
  if (normalized === '/partners' || normalized === '/create-a-game') return { screen: 'create-game' }
  const specialMatch = normalized.match(/^\/specials\/([^/]+)$/)
  if (specialMatch) return { screen: 'special', packId: decodedSegment(specialMatch[1]) }
  if (normalized === '/purchase/return') return { screen: 'purchase-return' }
  if (normalized === '/review/music') return { screen: 'review', mode: 'music' }
  if (normalized === '/games/danetki') return { screen: 'danetki' }
  if (normalized === '/danetki') return { screen: 'danetki-catalog' }
  if (normalized === '/danetki/dlya-detey') return { screen: 'danetki-catalog', danetkiCollection: 'dlya-detey' }
  if (normalized === '/games/together') return { screen: 'friends-intro' }
  const danetkiJoinMatch = normalized.match(/^\/danetki\/join\/([^/]+)$/)
  if (danetkiJoinMatch) return { screen: 'danetki-join', inviteToken: decodedSegment(danetkiJoinMatch[1]) }
  const danetkiStoryMatch = normalized.match(/^\/danetki\/([^/]+)$/)
  if (danetkiStoryMatch) return { screen: 'danetki-story', danetkiSlug: decodedSegment(danetkiStoryMatch[1]) }
  const legalMatch = normalized.match(/^\/legal\/([^/]+)$/)
  if (legalMatch) {
    const legalDocument = decodedSegment(legalMatch[1])
    return isLegalDocumentSlug(legalDocument) ? { screen: 'legal', legalDocument } : { screen: 'hub' }
  }

  const gameMatch = normalized.match(/^\/games\/([^/]+)$/)
  if (gameMatch) {
    const mode = decodedSegment(gameMatch[1])
    return isPlayableModeId(mode) && mode !== 'danetki' ? { screen: 'title', mode } : { screen: 'hub' }
  }

  const localPlayMatch = normalized.match(/^\/play\/([^/]+)$/)
  if (localPlayMatch) {
    const mode = decodedSegment(localPlayMatch[1])
    return isPlayableModeId(mode) && mode !== 'danetki' ? { screen: 'game', mode } : { screen: 'hub' }
  }

  const sessionMatch = normalized.match(/^\/sessions\/([^/]+)$/)
  if (sessionMatch) return { screen: 'game', sessionId: decodedSegment(sessionMatch[1]) }
  return { screen: 'hub' }
}

export const playerRouteFromLocation = (pathname: string, search = ''): PlayerRouteState => {
  const route = playerRouteFromPathname(pathname)
  if (route.screen !== 'friends-intro') return route
  const params = new URLSearchParams(search)
  return params.has('room') || params.get('new') === '1' || params.get('mode') === 'danetki'
    ? { screen: 'friends-room' }
    : route
}

export const pathnameForPlayerRoute = ({ screen, mode, sessionId, packId, legalDocument, inviteToken, danetkiSlug, danetkiCollection }: PlayerRouteState) => {
  if (screen === 'danetki') return '/games/danetki'
  if (screen === 'danetki-catalog') return danetkiCollection ? `/danetki/${danetkiCollection}` : '/danetki'
  if (screen === 'danetki-story' && danetkiSlug) return `/danetki/${encodeURIComponent(danetkiSlug)}`
  if ((screen === 'title' || screen === 'game') && mode === 'danetki') return '/games/danetki'
  if (screen === 'friends-intro') return '/games/together'
  if (screen === 'friends-room') return '/games/together'
  if (screen === 'danetki-join' && inviteToken) return `/danetki/join/${encodeURIComponent(inviteToken)}`
  if (screen === 'title' && mode) return `/games/${encodeURIComponent(mode)}`
  if (screen === 'game' && sessionId) return `/sessions/${encodeURIComponent(sessionId)}`
  if (screen === 'game' && mode) return `/play/${encodeURIComponent(mode)}`
  if (screen === 'rewatch') return '/archive'
  if (screen === 'profile') return '/profile'
  if (screen === 'club') return '/club'
  if (screen === 'specials') return '/specials'
  if (screen === 'special') return packId ? `/specials/${encodeURIComponent(packId)}` : '/specials'
  if (screen === 'create-game') return '/partners'
  if (screen === 'purchase-return') return '/purchase/return'
  if (screen === 'review') return '/review/music'
  if (screen === 'legal' && legalDocument) return `/legal/${encodeURIComponent(legalDocument)}`
  return '/'
}
