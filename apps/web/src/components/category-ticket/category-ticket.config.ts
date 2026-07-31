import type { LucideIcon } from 'lucide-react'
import { CATALOG_GUESS_DAILY_MODE_IDS, GAME_MODE_MANIFEST } from '@shoditsa/contracts'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import type { PlayableCatalogGuessModeId } from '@shoditsa/contracts'

export type CategoryTicketMode = PlayableCatalogGuessModeId | 'danetki' | 'connections'

export type CategoryTicketConfig = {
  mode: PlayableCatalogGuessModeId
  title: string
  description: string
  color: string
  icon: LucideIcon
  watermarkUrl: string
}

export const CATEGORY_TICKET_CONFIG: CategoryTicketConfig[] = CATALOG_GUESS_DAILY_MODE_IDS.map((mode) => ({
  mode,
  title: GAME_MODE_MANIFEST[mode].label,
  ...MODE_PRESENTATION[mode],
}))
