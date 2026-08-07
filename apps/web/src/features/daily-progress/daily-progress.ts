import type { DailyAttendance, SavedGame, TitleMode } from '../../types'
import type { DailyHubState, DailyRewardState } from './daily-progress.types'
import {
  ECONOMY_RULE_SET,
  FULL_HOUSE_MODE_IDS,
  GAME_MODE_MANIFEST,
  KPOP_ARTISTS_PACK_ID,
  type FullHouseModeId,
} from '@shoditsa/contracts'

export const DAILY_MODE_ORDER: FullHouseModeId[] = [...FULL_HOUSE_MODE_IDS]

export const DAILY_MODE_LABELS = Object.fromEntries(
  DAILY_MODE_ORDER.map((mode) => [mode, GAME_MODE_MANIFEST[mode].label]),
) as Record<FullHouseModeId, string>

const MODE_ACCUSATIVE: Record<TitleMode, string> = {
  movie: 'кино', series: 'сериалы', anime: 'аниме', game: 'игры', city: 'города', music: 'музыку', diagnosis: 'диагнозы', animal: 'животных', book: 'книги', character: 'персонажей',
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

export const isMainRouteGame = (game: Pick<SavedGame, 'mode' | 'variantKey'>) => !(
  game.mode === 'music' && game.variantKey === KPOP_ARTISTS_PACK_ID
)

export const savedGameAttemptCount = (game: SavedGame | null | undefined) => {
  const storedIds = Array.isArray(game?.attemptTitleIds) ? game.attemptTitleIds.length : 0
  return storedIds || game?.attempts.length || 0
}

export const dailyCompletedCopy = (count: number, total = DAILY_MODE_ORDER.length) => {
  const suffix = count === 0 ? 'завершено' : count === 1 ? 'завершена' : 'завершены'
  return `${count} из ${total} ${suffix}`
}

export const dailyRewardState = (completedCount: number, fullHouseTarget = DAILY_MODE_ORDER.length): DailyRewardState => {
  if (completedCount >= fullHouseTarget) return { fullHouse: true, remaining: 0, reward: ECONOMY_RULE_SET.rewards.fullRoute, milestone: fullHouseTarget }
  if (completedCount >= 3) return { fullHouse: false, remaining: fullHouseTarget - completedCount, reward: ECONOMY_RULE_SET.rewards.fullRoute, milestone: fullHouseTarget }
  return { fullHouse: false, remaining: 3 - completedCount, reward: ECONOMY_RULE_SET.rewards.route3, milestone: 3 }
}

export const buildDailyHubState = (
  attendance: DailyAttendance,
  games: SavedGame[],
  preferredMode: TitleMode,
  globalDailySalt = 0,
): DailyHubState => {
  const dailyModes = DAILY_MODE_ORDER
  const completedSet = new Set<FullHouseModeId>([
    ...attendance.completedModes.filter((mode): mode is FullHouseModeId => FULL_HOUSE_MODE_IDS.includes(mode as FullHouseModeId)),
  ])
  const completedModes = dailyModes.filter((mode) => completedSet.has(mode))
  const activeGames = games.filter((game) => isMainRouteGame(game) && (game.status === 'playing' || game.status === 'final_choice') && savedGameAttemptCount(game) > 0 && isDailySession(game, attendance.date, globalDailySalt)).sort(newestFirst)
  const finishedGames = games
    .filter((game) => isMainRouteGame(game) && isDailySession(game, attendance.date, globalDailySalt) && (game.status === 'won' || game.status === 'lost'))
    .sort(newestFirst)
  const activeGame = activeGames[0] ?? null
  const unfinishedModes = dailyModes.filter((mode) => !completedSet.has(mode))
  const recommendedMode = unfinishedModes.find((mode) => mode === preferredMode) ?? unfinishedModes[0] ?? dailyModes[0] ?? preferredMode
  const completedCount = completedModes.length

  return {
    completedModes,
    dailyModes,
    completedCount,
    activeGame,
    activeGamesByMode: byMode(activeGames),
    finishedGamesByMode: byMode(finishedGames),
    recommendedMode,
    primaryLabel: activeGame ? `Продолжить ${MODE_ACCUSATIVE[activeGame.mode]}` : 'Играть сейчас',
    primaryMeta: activeGame ? `${savedGameAttemptCount(activeGame)} из 10 попыток` : null,
    punchesCaption: activeGame
      ? `${GAME_MODE_MANIFEST[activeGame.mode].label} в процессе`
      : completedCount === 0 ? 'Выберите первую игру' : completedCount < dailyModes.length ? 'Выберите следующую игру' : 'Все игры дня завершены',
    reward: dailyRewardState(completedCount, dailyModes.length),
  }
}
