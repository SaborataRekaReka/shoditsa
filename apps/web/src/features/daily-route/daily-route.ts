import type { TitleMode } from '../../types'
import { DAILY_MODE_IDS } from '@shoditsa/contracts'

export const DAILY_MODE_ORDER: TitleMode[] = [...DAILY_MODE_IDS]

export const nextDailyMode = (
  currentMode: TitleMode,
  completedModes: readonly TitleMode[],
  order: readonly TitleMode[] = DAILY_MODE_ORDER,
): TitleMode | null => {
  const completed = new Set(completedModes)
  if (order.every((mode) => completed.has(mode))) return null
  const currentIndex = Math.max(0, order.indexOf(currentMode))
  for (let offset = 1; offset <= order.length; offset += 1) {
    const candidate = order[(currentIndex + offset) % order.length]
    if (!completed.has(candidate)) return candidate
  }
  return null
}
