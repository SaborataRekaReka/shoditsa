import type { DailyAttendance, SavedGame, TitleMode } from '../../types'
import type { DailyHubState, DailyRewardState } from './daily-progress.types'

export const DAILY_MODE_ORDER: TitleMode[] = ['movie', 'series', 'anime', 'game', 'music', 'diagnosis']

export const DAILY_MODE_LABELS: Record<TitleMode, string> = {
  movie: 'Кино', series: 'Сериалы', anime: 'Аниме', game: 'Игры', music: 'Музыка', diagnosis: 'Диагнозы',
}

const MODE_ACCUSATIVE: Record<TitleMode, string> = {
  movie: 'кино', series: 'сериалы', anime: 'аниме', game: 'игры', music: 'музыку', diagnosis: 'диагнозы',
}

const newestFirst = (left: SavedGame, right: SavedGame) => right.updatedAt - left.updatedAt
const byMode = (games: SavedGame[]) => games.reduce<Partial<Record<TitleMode, SavedGame>>>((result, game) => {
  if (!result[game.mode]) result[game.mode] = game
  return result
}, {})

export const dailyCompletedCopy = (count: number) => {
  const suffix = count === 0 ? 'завершено' : count === 1 ? 'завершена' : 'завершены'
  return `${count} из 6 ${suffix}`
}

export const dailyRewardState = (completedCount: number): DailyRewardState => {
  if (completedCount >= 6) return { fullHouse: true, remaining: 0, reward: 25, milestone: 6 }
  if (completedCount >= 3) return { fullHouse: false, remaining: 6 - completedCount, reward: 25, milestone: 6 }
  return { fullHouse: false, remaining: 3 - completedCount, reward: 10, milestone: 3 }
}

export const buildDailyHubState = (attendance: DailyAttendance, games: SavedGame[], preferredMode: TitleMode): DailyHubState => {
  const completedSet = new Set(attendance.completedModes)
  const completedModes = DAILY_MODE_ORDER.filter((mode) => completedSet.has(mode))
  const activeGames = games.filter((game) => game.status === 'playing' && game.attempts.length > 0).sort(newestFirst)
  const finishedGames = games
    .filter((game) => game.date === attendance.date && (game.status === 'won' || game.status === 'lost'))
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
    primaryMeta: activeGame ? `${activeGame.attempts.length} из 10 попыток` : null,
    punchesCaption: activeGame
      ? `${DAILY_MODE_LABELS[activeGame.mode]} в процессе`
      : completedCount === 0 ? 'Выберите первую игру' : completedCount < 6 ? 'Выберите следующую игру' : 'Все игры дня завершены',
    reward: dailyRewardState(completedCount),
  }
}
