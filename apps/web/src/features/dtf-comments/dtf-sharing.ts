export function dtfShareText(attempts: number, maxAttempts: number, won: boolean) {
  const usedAttempts = Math.max(0, Math.min(maxAttempts, attempts))
  const misses = Math.max(0, usedAttempts - (won ? 1 : 0))
  const attemptRow = `${'⬛'.repeat(misses)}${won ? '🟩' : ''}` || '⬜'

  return [
    'Сходится! · Спецпоказ DTF',
    'Угадайте игру по комментариям игроков',
    `🎮 ${won ? usedAttempts : 'X'}/${maxAttempts}`,
    attemptRow,
  ].join('\n')
}
