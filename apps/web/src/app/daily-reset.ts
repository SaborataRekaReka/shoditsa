import { getMoscowDate } from '@shoditsa/game-core'

/** Daily catalogue puzzles change at midnight in Moscow, regardless of the viewer's timezone. */
export function getDailyReset(now = Date.now()) {
  const date = getMoscowDate(new Date(now))
  const resetAt = Date.parse(`${date}T00:00:00+03:00`) + 86_400_000
  const remainingMs = resetAt - now
  const minutes = Math.ceil(remainingMs / 60_000)
  const hours = Math.floor(minutes / 60)
  const label = remainingMs < 60_000 ? '< 1 мин' : hours
    ? `${hours} ч${minutes % 60 ? ` ${minutes % 60} мин` : ''}`
    : `${minutes} мин`
  return { date, resetAt, label }
}
