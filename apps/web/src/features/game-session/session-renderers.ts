import { ConnectionsGamePage } from '../connections/ConnectionsGamePage'
import { DanetkiGamePage } from '../danetki/DanetkiGamePage'

/** Engine-owned session renderers. Catalog guessing remains the legacy fallback. */
export const SESSION_RENDERER_BY_ENGINE = {
  danetki_chat: DanetkiGamePage,
  connections_grid: ConnectionsGamePage,
} as const
