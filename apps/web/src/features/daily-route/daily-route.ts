import type { TitleMode } from '../../types'
import { CATALOG_GUESS_DAILY_MODE_IDS } from '@shoditsa/contracts'

export const DAILY_MODE_ORDER: TitleMode[] = [...CATALOG_GUESS_DAILY_MODE_IDS]
export const DIAGNOSIS_RESULT_MODE_ORDER: readonly TitleMode[] = ['animal', 'character', 'book']

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

export const nextResultMode = (
  currentMode: TitleMode,
  completedModes: readonly TitleMode[],
): TitleMode | null => {
  if (currentMode !== 'diagnosis') return nextDailyMode(currentMode, completedModes)
  const completed = new Set(completedModes)
  return DIAGNOSIS_RESULT_MODE_ORDER.find((mode) => !completed.has(mode))
    ?? nextDailyMode(currentMode, completedModes)
}

export const resultRecommendedModes = (currentMode: TitleMode, primaryMode: TitleMode | null): TitleMode[] => (
  currentMode === 'diagnosis'
    ? DIAGNOSIS_RESULT_MODE_ORDER.filter((mode) => mode !== primaryMode)
    : []
)
