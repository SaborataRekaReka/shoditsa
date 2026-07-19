import { isPlayableModeId, type PlayableModeId } from '@shoditsa/contracts'

export type PlayerScreen = 'hub' | 'title' | 'game' | 'rewatch' | 'review' | 'profile'

export type PlayerRouteState = {
  screen: PlayerScreen
  mode?: PlayableModeId
  sessionId?: string
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
  if (normalized === '/review/music') return { screen: 'review', mode: 'music' }

  const gameMatch = normalized.match(/^\/games\/([^/]+)$/)
  if (gameMatch) {
    const mode = decodedSegment(gameMatch[1])
    return isPlayableModeId(mode) ? { screen: 'title', mode } : { screen: 'hub' }
  }

  const localPlayMatch = normalized.match(/^\/play\/([^/]+)$/)
  if (localPlayMatch) {
    const mode = decodedSegment(localPlayMatch[1])
    return isPlayableModeId(mode) ? { screen: 'game', mode } : { screen: 'hub' }
  }

  const sessionMatch = normalized.match(/^\/sessions\/([^/]+)$/)
  if (sessionMatch) return { screen: 'game', sessionId: decodedSegment(sessionMatch[1]) }
  return { screen: 'hub' }
}

export const pathnameForPlayerRoute = ({ screen, mode, sessionId }: PlayerRouteState) => {
  if (screen === 'title' && mode) return `/games/${encodeURIComponent(mode)}`
  if (screen === 'game' && sessionId) return `/sessions/${encodeURIComponent(sessionId)}`
  if (screen === 'game' && mode) return `/play/${encodeURIComponent(mode)}`
  if (screen === 'rewatch') return '/archive'
  if (screen === 'profile') return '/profile'
  if (screen === 'review') return '/review/music'
  return '/'
}
