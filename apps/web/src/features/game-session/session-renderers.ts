import { lazy } from 'react'

const ConnectionsGamePage = lazy(() => import('../connections/ConnectionsGamePage').then((module) => ({ default: module.ConnectionsGamePage })))
const DanetkiGamePage = lazy(() => import('../danetki/DanetkiGamePage').then((module) => ({ default: module.DanetkiGamePage })))

/** Engine-owned session renderers. Catalog guessing remains the legacy fallback. */
export const SESSION_RENDERER_BY_ENGINE = {
  danetki_chat: DanetkiGamePage,
  connections_grid: ConnectionsGamePage,
} as const
