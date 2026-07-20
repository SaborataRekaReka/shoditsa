import { ECONOMY_RULE_SET, economyFreePlayCost, economyStreakMilestoneReward, type EconomyRuleSet } from '@shoditsa/contracts'

export const freePlayCost = economyFreePlayCost

export const streakMilestoneReward = economyStreakMilestoneReward
export const nextStreakMilestoneAt = (days: number) => {
  const safeDays = Math.max(0, Math.trunc(Number(days) || 0))
  if (safeDays < 3) return 3
  if (safeDays < 7) return 7
  if (safeDays < 14) return 14
  if (safeDays < 30) return 30
  return (Math.floor(safeDays / 30) + 1) * 30
}
export const nextStreakMilestoneReward = (days: number, rules: EconomyRuleSet = ECONOMY_RULE_SET) => (
  streakMilestoneReward(nextStreakMilestoneAt(days), rules) || rules.streakMilestones.every30Days
)

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
