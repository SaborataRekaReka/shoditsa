export const ECONOMY_RULES_VERSION = 2 as const

export const ECONOMY_RULE_SET = {
  version: ECONOMY_RULES_VERSION,
  rewards: {
    completion: 5,
    win: 5,
    efficiency: {
      upTo3Attempts: 3,
      upTo6Attempts: 2,
      upTo9Attempts: 1,
    },
    firstGame: 5,
    route3: 10,
    fullRoute: 20,
  },
  streakMilestones: {
    day3: 3,
    day7: 7,
    day14: 12,
    day30: 20,
    every30Days: 20,
  },
  freePlay: {
    base: 60,
    step: 20,
  },
  periodUnlock: 120,
  danetki: {
    dailyFreeRooms: 1,
    ownerDailyCompletionReward: 10,
    clubExtraRooms: 2,
    solo: { base: 90, step: 30 },
    group: { base: 120, step: 30 },
    questionWarningAt: 35,
    questionLimit: 40,
  },
} as const

export type EconomyRuleSet = typeof ECONOMY_RULE_SET

const nonNegativeInteger = (value: number) => Math.max(0, Math.trunc(Number(value) || 0))

export const economyFreePlayCost = (launchesToday: number, rules: EconomyRuleSet = ECONOMY_RULE_SET) => (
  rules.freePlay.base + nonNegativeInteger(launchesToday) * rules.freePlay.step
)

export const economyEfficiencyReward = (won: boolean, attemptsCount: number, rules: EconomyRuleSet = ECONOMY_RULE_SET) => {
  if (!won) return 0
  const attempts = nonNegativeInteger(attemptsCount)
  if (attempts <= 3) return rules.rewards.efficiency.upTo3Attempts
  if (attempts <= 6) return rules.rewards.efficiency.upTo6Attempts
  if (attempts <= 9) return rules.rewards.efficiency.upTo9Attempts
  return 0
}

export const economyStreakMilestoneReward = (streak: number, rules: EconomyRuleSet = ECONOMY_RULE_SET) => {
  const day = nonNegativeInteger(streak)
  if (day === 3) return rules.streakMilestones.day3
  if (day === 7) return rules.streakMilestones.day7
  if (day === 14) return rules.streakMilestones.day14
  if (day >= 30 && day % 30 === 0) return rules.streakMilestones.every30Days
  return 0
}

export const economyDanetkiCost = (
  roomMode: 'solo' | 'group',
  paidLaunchesToday: number,
  rules: EconomyRuleSet = ECONOMY_RULE_SET,
) => {
  const ladder = rules.danetki[roomMode]
  return ladder.base + nonNegativeInteger(paidLaunchesToday) * ladder.step
}
