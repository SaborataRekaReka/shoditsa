const FREE_PLAY_BASE_COST = 45
const FREE_PLAY_COST_STEP = 15

export const freePlayCost = (launchesToday: number) => {
  const safeLaunches = Math.max(0, Math.trunc(Number(launchesToday) || 0))
  return FREE_PLAY_BASE_COST + safeLaunches * FREE_PLAY_COST_STEP
}

export const streakMultiplier = (days: number) => days >= 30 ? 1.6 : days >= 14 ? 1.4 : days >= 7 ? 1.25 : days >= 3 ? 1.1 : 1
export const nextMultiplierAt = (days: number) => days < 3 ? 3 : days < 7 ? 7 : days < 14 ? 14 : days < 30 ? 30 : null
export const formatMultiplier = (value: number) => `×${value.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}`

export const countWord = (count: number, forms: [string, string, string]) => {
  const mod100 = Math.abs(count) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 19) return forms[2]
  if (mod10 === 1) return forms[0]
  if (mod10 >= 2 && mod10 <= 4) return forms[1]
  return forms[2]
}

export const formatTickets = (count: number) => `${count} ${countWord(count, ['билет', 'билета', 'билетов'])}`
export const formatArtists = (count: number) => `${count} ${countWord(count, ['артист', 'артиста', 'артистов'])}`
