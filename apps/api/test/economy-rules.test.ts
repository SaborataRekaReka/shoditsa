import { describe, expect, it } from 'vitest'
import {
  ECONOMY_RULE_SET_V3,
  ECONOMY_RULE_SET_V4,
  economyDanetkiCost,
  economyFreePlayCost,
  economyFriendsRoomCost,
  isEconomyRuleSet,
} from '@shoditsa/contracts'
import { fallbackEconomyRules, stableEconomyBucket } from '../src/modules/economy/rules.js'
import { settlePositiveWalletCredit } from '../src/modules/economy/wallet-credit.js'

describe('economy v4 rules', () => {
  it('validates the shipped fallback and rejects incomplete database JSON', () => {
    expect(isEconomyRuleSet(ECONOMY_RULE_SET_V4)).toBe(true)
    expect(isEconomyRuleSet({ version: 4, rewards: {} })).toBe(false)
    expect(fallbackEconomyRules({ version: 4 })).toBe(ECONOMY_RULE_SET_V4)
  })

  it('caps independent free-play and friends-room ladders', () => {
    expect([0, 1, 2, 3, 4, 20].map((value) => economyFreePlayCost(value))).toEqual([60, 80, 100, 120, 120, 120])
    expect([0, 1, 2, 3, 4, 20].map((value) => economyFriendsRoomCost(value))).toEqual([60, 80, 100, 120, 120, 120])
  })

  it('keeps the v3 control cohort on its legacy linear pricing', () => {
    expect(isEconomyRuleSet(ECONOMY_RULE_SET_V3)).toBe(true)
    expect(economyFreePlayCost(4, ECONOMY_RULE_SET_V3)).toBe(140)
    expect(economyDanetkiCost('solo', 2, ECONOMY_RULE_SET_V3)).toBe(150)
    expect(economyDanetkiCost('group', 2, ECONOMY_RULE_SET_V3)).toBe(180)
  })

  it('assigns a stable percentage bucket to a user', () => {
    expect(stableEconomyBucket('user-a')).toBe(stableEconomyBucket('user-a'))
    expect(stableEconomyBucket('user-a')).toBeGreaterThanOrEqual(0)
    expect(stableEconomyBucket('user-a')).toBeLessThan(100)
  })

  it('settles purchase debt before exposing a positive credit as spendable', () => {
    expect(settlePositiveWalletCredit({ balance: 7, purchaseDebt: 12 }, 10)).toEqual({
      grossAmount: 10,
      spendableAmount: 0,
      debtAdded: 0,
      debtSettled: 10,
      balanceAfter: 7,
      purchaseDebtAfter: 2,
    })
    expect(settlePositiveWalletCredit({ balance: 7, purchaseDebt: 2 }, 10)).toEqual({
      grossAmount: 10,
      spendableAmount: 8,
      debtAdded: 0,
      debtSettled: 2,
      balanceAfter: 15,
      purchaseDebtAfter: 0,
    })
  })
})
