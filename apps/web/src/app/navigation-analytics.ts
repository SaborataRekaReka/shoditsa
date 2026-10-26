import { isPlayableModeId } from '@shoditsa/contracts'
import { trackClientEvent } from './client-events'
import { canonicalAnalyticsPath, storedAnalyticsConsent, trackMetrikaGoal, trackMetrikaPageView, type AnalyticsConsent } from './metrics'
import { PRESENTATION_PREVIEW } from './local-presentation'

type NavigationLocation = { pathname: string; search?: string }
type NavigationView = { key: string; id: string; path: string; properties: Record<string, string>; consent: AnalyticsConsent | null }
let current: NavigationView | undefined

/** Keep private route IDs only in the in-memory identity; never export arbitrary query values. */
const routeView = ({ pathname, search = '' }: NavigationLocation) => {
  const params = new URLSearchParams(search)
  const path = canonicalAnalyticsPath(pathname)
  const pathMode = pathname.match(/^\/(?:games|play)\/([^/]+)$/)?.[1]
  const candidate = pathMode ?? params.get('mode')
  const mode = candidate && (isPlayableModeId(candidate) || ['territory', 'svoyak', 'quiz'].includes(candidate)) ? candidate : undefined
  const properties: Record<string, string> = {
    screen: pathname === '/' ? 'home' : /^\/games\/[^/]+$/.test(pathname) ? 'title' : /^\/(?:play|sessions)\//.test(pathname) ? 'game' : path.replace(/^\//, '') || 'home',
    ...(mode ? { mode } : {}),
  }
  // Filters that change the actual game/view count; anchors, UTM, auth and invitation tokens do not.
  for (const key of ['period', 'date', 'difficulty', 'variant'] as const) {
    const value = params.get(key)
    if (value && /^[a-zA-Z0-9_-]{1,40}$/.test(value)) properties[key] = value
  }
  const room = pathname === '/games/together' ? params.get('room') ?? '' : ''
  return { key: JSON.stringify([pathname, properties, room]), path, properties }
}

/** Sole owner of committed route views, including StrictMode remounts and consent replay. */
export const trackNavigationView = (location: NavigationLocation) => {
  if (PRESENTATION_PREVIEW) return
  const next = routeView(location)
  const consent = storedAnalyticsConsent()
  if (current?.key !== next.key) {
    current = { ...next, id: crypto.randomUUID(), consent }
    trackClientEvent('page_view', next.properties, { eventId: current.id })
  } else if (current.consent === 'rejected' && consent === 'accepted') {
    // The earlier necessary event was intentionally unattributed. This marks a new consented view,
    // not a replay/backfill of rejected activity or an extra hit after an already accepted decision.
    current.id = crypto.randomUUID()
    trackClientEvent('page_view', { ...next.properties, consent_granted: true }, { eventId: current.id })
  }
  current.consent = consent
  trackMetrikaPageView(current.id, current.path, current.properties)
}

export const refreshNavigationConsent = () => {
  if (!current) return
  const consent = storedAnalyticsConsent()
  if (current.consent === 'rejected' && consent === 'accepted') {
    current.id = crypto.randomUUID()
    trackClientEvent('page_view', { ...current.properties, consent_granted: true }, { eventId: current.id })
  }
  current.consent = consent
  trackMetrikaPageView(current.id, current.path, current.properties)
}

/** These goals describe a navigation action, never a server game start. */
export const trackNavigationAction = (href: string, sourceSurface: string) => {
  let url: URL
  try { url = new URL(href, window.location.origin) } catch { return }
  if (url.origin !== window.location.origin) return
  const mode = url.pathname.match(/^\/games\/([^/]+)$/)?.[1]
  const properties = { source_surface: sourceSurface }
  if (mode && isPlayableModeId(mode)) trackMetrikaGoal('select_mode', { ...properties, mode })
  else if (url.pathname === '/profile') trackMetrikaGoal('open_profile', properties)
  else if (url.pathname === '/archive') trackMetrikaGoal('open_archive', properties)
}
