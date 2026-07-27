export type EconomyRuleSet = {
  version: number
  rewards: {
    completion: number
    win: number
    finalChoiceWin: number
    efficiency: {
      upTo3Attempts: number
      upTo6Attempts: number
      upTo9Attempts: number
    }
    firstGame: number
    route3: number
    fullRoute: number
  }
  streakMilestones: {
    day3: number
    day7: number
    day14: number
    day30: number
    every30Days: number
  }
  freePlay: {
    ladder: readonly number[]
    max: number
    legacyLinear?: {
      base: number
      step: number
    }
  }
  periodUnlock: number
  friendsRoom: {
    freeBlocksPerDay: number
    roundsPerBlock: number
    maxRoundsPerRoom: number
    ladder: readonly number[]
    max: number
  }
  danetki: {
    dailyFreeRooms: number
    ownerDailyCompletionReward: number
    clubExtraRooms: number
    ladder: readonly number[]
    max: number
    questionWarningAt: number
    questionLimit: number
    legacyLinear?: {
      solo: { base: number; step: number }
      group: { base: number; step: number }
    }
  }
}

export const ECONOMY_RULE_SET_V3: EconomyRuleSet = {
  version: 3,
  rewards: {
    completion: 5,
    win: 5,
    finalChoiceWin: 5,
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
    ladder: [60, 80, 100, 120],
    max: 2_147_483_647,
    legacyLinear: { base: 60, step: 20 },
  },
  periodUnlock: 120,
  friendsRoom: {
    freeBlocksPerDay: 2_147_483_647,
    roundsPerBlock: 6,
    maxRoundsPerRoom: 30,
    ladder: [0],
    max: 0,
  },
  danetki: {
    dailyFreeRooms: 1,
    ownerDailyCompletionReward: 10,
    clubExtraRooms: 2,
    ladder: [90, 120, 150],
    max: 2_147_483_647,
    questionWarningAt: 35,
    questionLimit: 40,
    legacyLinear: {
      solo: { base: 90, step: 30 },
      group: { base: 120, step: 30 },
    },
  },
}

export const ECONOMY_RULE_SET_V4: EconomyRuleSet = {
  ...ECONOMY_RULE_SET_V3,
  version: 4,
  freePlay: {
    ladder: [60, 80, 100, 120],
    max: 120,
  },
  friendsRoom: {
    freeBlocksPerDay: 1,
    roundsPerBlock: 6,
    maxRoundsPerRoom: 30,
    ladder: [60, 80, 100, 120],
    max: 120,
  },
  danetki: {
    dailyFreeRooms: 1,
    ownerDailyCompletionReward: 10,
    clubExtraRooms: 2,
    ladder: [90, 120, 150],
    max: 150,
    questionWarningAt: 35,
    questionLimit: 40,
  },
}

export const ECONOMY_RULES_VERSION = 4 as const
export const ECONOMY_RULE_SET: EconomyRuleSet = ECONOMY_RULE_SET_V4

const nonNegativeInteger = (value: number) => Math.max(0, Math.trunc(Number(value) || 0))
const positiveInteger = (value: unknown) => Number.isInteger(value) && Number(value) >= 0
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const integerArray = (value: unknown): value is number[] => (
  Array.isArray(value) && value.length > 0 && value.every(positiveInteger)
)

export const isEconomyRuleSet = (value: unknown): value is EconomyRuleSet => {
  if (!record(value) || !positiveInteger(value.version)) return false
  const rewards = value.rewards
  const streak = value.streakMilestones
  const freePlay = value.freePlay
  const friendsRoom = value.friendsRoom
  const danetki = value.danetki
  if (!record(rewards) || !record(rewards.efficiency) || !record(streak) || !record(freePlay) || !record(friendsRoom) || !record(danetki)) return false
  const legacyFreePlay = freePlay.legacyLinear
  const legacyDanetki = danetki.legacyLinear
  if (legacyFreePlay !== undefined && (
    !record(legacyFreePlay)
    || !positiveInteger(legacyFreePlay.base)
    || !positiveInteger(legacyFreePlay.step)
  )) return false
  if (legacyDanetki !== undefined && (
    !record(legacyDanetki)
    || !record(legacyDanetki.solo)
    || !record(legacyDanetki.group)
    || !positiveInteger(legacyDanetki.solo.base)
    || !positiveInteger(legacyDanetki.solo.step)
    || !positiveInteger(legacyDanetki.group.base)
    || !positiveInteger(legacyDanetki.group.step)
  )) return false
  return [
    rewards.completion,
    rewards.win,
    rewards.finalChoiceWin,
    rewards.efficiency.upTo3Attempts,
    rewards.efficiency.upTo6Attempts,
    rewards.efficiency.upTo9Attempts,
    rewards.firstGame,
    rewards.route3,
    rewards.fullRoute,
    streak.day3,
    streak.day7,
    streak.day14,
    streak.day30,
    streak.every30Days,
    freePlay.max,
    value.periodUnlock,
    friendsRoom.freeBlocksPerDay,
    friendsRoom.roundsPerBlock,
    friendsRoom.maxRoundsPerRoom,
    friendsRoom.max,
    danetki.dailyFreeRooms,
    danetki.ownerDailyCompletionReward,
    danetki.clubExtraRooms,
    danetki.max,
    danetki.questionWarningAt,
    danetki.questionLimit,
  ].every(positiveInteger)
    && integerArray(freePlay.ladder)
    && integerArray(friendsRoom.ladder)
    && integerArray(danetki.ladder)
    && Number(freePlay.max) >= Math.max(...freePlay.ladder)
    && Number(friendsRoom.max) >= Math.max(...friendsRoom.ladder)
    && Number(danetki.max) >= Math.max(...danetki.ladder)
    && Number(danetki.questionWarningAt) < Number(danetki.questionLimit)
}

export const economyLadderCost = (paidUsesToday: number, ladder: readonly number[], max: number) => (
  ladder[nonNegativeInteger(paidUsesToday)] ?? max
)

export const economyFreePlayCost = (launchesToday: number, rules: EconomyRuleSet = ECONOMY_RULE_SET) => (
  rules.freePlay.legacyLinear
    ? rules.freePlay.legacyLinear.base + nonNegativeInteger(launchesToday) * rules.freePlay.legacyLinear.step
    : economyLadderCost(launchesToday, rules.freePlay.ladder, rules.freePlay.max)
)

export const economyFriendsRoomCost = (paidBlocksToday: number, rules: EconomyRuleSet = ECONOMY_RULE_SET) => (
  economyLadderCost(paidBlocksToday, rules.friendsRoom.ladder, rules.friendsRoom.max)
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
  const legacy = rules.danetki.legacyLinear?.[roomMode]
  return legacy
    ? legacy.base + nonNegativeInteger(paidLaunchesToday) * legacy.step
    : economyLadderCost(paidLaunchesToday, rules.danetki.ladder, rules.danetki.max)
}

export type EconomySink = 'free-play' | 'friends-room-block' | 'danetki-room' | 'period-unlock'
export type EconomyQuote = {
  sink: EconomySink
  allowed: boolean
  accessSource: 'free' | 'tickets' | 'club'
  cost: number
  balance: number
  shortage: number
  paidUsesToday: number
  rulesVersion: number
}
