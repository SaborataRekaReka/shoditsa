import { emptyStats } from './game'
import type { SavedGame, Stats, TitleMode } from './types'

const GAME_PREFIX = 'seans:v1:game:'
const STATS_PREFIX = 'seans:v1:stats:'
export const gameKey = (mode: string, period: string, date: string) => `${mode}|${period}|${date}`

export const loadGame = (key: string): SavedGame | null => {
  try { const value = localStorage.getItem(GAME_PREFIX + key); return value ? JSON.parse(value) : null } catch { return null }
}
export const saveGame = (game: SavedGame) => localStorage.setItem(GAME_PREFIX + game.key, JSON.stringify(game))
export const removeGame = (key: string) => localStorage.removeItem(GAME_PREFIX + key)
export const allGames = (): SavedGame[] => Object.keys(localStorage).filter((key) => key.startsWith(GAME_PREFIX))
  .map((key) => { try { return JSON.parse(localStorage.getItem(key) || '') as SavedGame } catch { return null } })
  .filter((game): game is SavedGame => Boolean(game)).sort((a, b) => b.date.localeCompare(a.date))
export const loadStats = (mode: TitleMode): Stats => {
  try { const value = localStorage.getItem(STATS_PREFIX + mode); return value ? JSON.parse(value) : emptyStats() } catch { return emptyStats() }
}
export const saveStats = (mode: TitleMode, stats: Stats) => localStorage.setItem(STATS_PREFIX + mode, JSON.stringify(stats))
