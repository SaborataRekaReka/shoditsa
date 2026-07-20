import type { LucideIcon } from 'lucide-react'
import { DAILY_MODE_IDS, GAME_MODE_MANIFEST } from '@shoditsa/contracts'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import type { TitleMode } from '../../types'

export type CategoryTicketMode = TitleMode | 'danetki'

export type CategoryTicketConfig = {
  mode: TitleMode
  title: string
  description: string
  color: string
  icon: LucideIcon
  watermarkUrl: string
}

export const CATEGORY_TICKET_CONFIG: CategoryTicketConfig[] = DAILY_MODE_IDS.map((mode) => ({
  mode,
  title: GAME_MODE_MANIFEST[mode].label,
  ...MODE_PRESENTATION[mode],
}))
