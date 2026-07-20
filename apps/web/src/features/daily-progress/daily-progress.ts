import type { DailyAttendance, SavedGame, TitleMode } from '../../types'
import type { DailyHubState, DailyRewardState } from './daily-progress.types'
import { DAILY_MODE_IDS, GAME_MODE_MANIFEST } from '@shoditsa/contracts'

export const DAILY_MODE_ORDER: TitleMode[] = [...DAILY_MODE_IDS]

export const DAILY_MODE_LABELS = Object.fromEntries(
  DAILY_MODE_ORDER.map((mode) => [mode, GAME_MODE_MANIFEST[mode].label]),
) as Record<TitleMode, string>

const MODE_ACCUSATIVE: Record<TitleMode, string> = {
  movie: 'кино', series: 'сериалы', anime: 'аниме', game: 'игры', city: 'города', music: 'музыку', diagnosis: 'диагнозы',
}

const newestFirst = (left: SavedGame, right: SavedGame) => right.updatedAt - left.updatedAt
const byMode = (games: SavedGame[]) => games.reduce<Partial<Record<TitleMode, SavedGame>>>((result, game) => {
  if (!result[game.mode]) result[game.mode] = game
  return result
}, {})
const isDailySession = (game: SavedGame, date: string, globalDailySalt: number) => {
  if (game.date !== date) return false
  const saltMatch = game.key.match(/\|salt:(-?\d+)$/)
  if (globalDailySalt === 0) return !saltMatch
  return Number(saltMatch?.[1]) === globalDailySalt
}

export const savedGameAttemptCount = (game: SavedGame | null | undefined) => {
  const storedIds = Array.isArray(game?.attemptTitleIds) ? game.attemptTitleIds.length : 0
  return storedIds || game?.attempts.length || 0
}

export const dailyCompletedCopy = (count: number) => {
  const suffix = count === 0 ? 'завершено' : count === 1 ? 'завершена' : 'завершены'
  return `${count} из ${DAILY_MODE_ORDER.length} ${suffix}`
}

export const dailyRewardState = (completedCount: number): DailyRewardState => {
  const fullHouseTarget = DAILY_MODE_ORDER.length
  if (completedCount >= fullHouseTarget) return { fullHouse: true, remaining: 0, reward: 20, milestone: fullHouseTarget }
  if (completedCount >= 3) return { fullHouse: false, remaining: fullHouseTarget - completedCount, reward: 20, milestone: fullHouseTarget }
  return { fullHouse: false, remaining: 3 - completedCount, reward: 10, milestone: 3 }
}

export const buildDailyHubState = (attendance: DailyAttendance, games: SavedGame[], preferredMode: TitleMode, globalDailySalt = 0): DailyHubState => {
  const completedSet = new Set(attendance.completedModes)
  const completedModes = DAILY_MODE_ORDER.filter((mode) => completedSet.has(mode))
  const activeGames = games.filter((game) => game.status === 'playing' && savedGameAttemptCount(game) > 0 && isDailySession(game, attendance.date, globalDailySalt)).sort(newestFirst)
  const finishedGames = games
    .filter((game) => isDailySession(game, attendance.date, globalDailySalt) && (game.status === 'won' || game.status === 'lost'))
    .sort(newestFirst)
  const activeGame = activeGames[0] ?? null
  const unfinishedModes = DAILY_MODE_ORDER.filter((mode) => !completedSet.has(mode))
  const recommendedMode = unfinishedModes.includes(preferredMode) ? preferredMode : unfinishedModes[0] ?? preferredMode
  const completedCount = completedModes.length

  return {
    completedModes,
    completedCount,
    activeGame,
    activeGamesByMode: byMode(activeGames),
    finishedGamesByMode: byMode(finishedGames),
    recommendedMode,
    primaryLabel: activeGame ? `Продолжить ${MODE_ACCUSATIVE[activeGame.mode]}` : 'Играть сейчас',
    primaryMeta: activeGame ? `${savedGameAttemptCount(activeGame)} из 10 попыток` : null,
    punchesCaption: activeGame
      ? `${DAILY_MODE_LABELS[activeGame.mode]} в процессе`
      : completedCount === 0 ? 'Выберите первую игру' : completedCount < DAILY_MODE_ORDER.length ? 'Выберите следующую игру' : 'Все игры дня завершены',
    reward: dailyRewardState(completedCount),
  }
}
