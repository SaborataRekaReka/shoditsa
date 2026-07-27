import type { ConnectionsColor, ConnectionsGameState } from '@shoditsa/contracts'
import { dayNumber } from '../../game/day-number'

const square: Record<ConnectionsColor, string> = {
  yellow: '🟨',
  green: '🟩',
  blue: '🟦',
  purple: '🟪',
}

export const connectionsShareText = (date: string, state: ConnectionsGameState) => {
  const rows = state.guesses
    .flatMap((guess) => guess.colorRow ? [guess.colorRow.map((color) => square[color]).join('')] : [])
  return [
    `Сходится! Связи №${dayNumber(date)}`,
    ...rows,
    '',
    'shoditsa.ru/games/connections',
  ].join('\n')
}
