import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLUB_PRODUCTS,
  ECONOMY_RULE_SET_V4,
  type CommerceProduct,
  type MetaResponse,
} from '@shoditsa/contracts'
import {
  buildClubPageViewModel,
  clubMembershipStatus,
  dailyPriceMinor,
  inclusiveCalendarDays,
} from './club-page-model'

const meta: MetaResponse = {
  serverTime: '2026-07-27T09:00:00.000Z',
  moscowDate: '2026-07-27',
  apiVersion: 'v1',
  rulesVersion: 4,
  activeRevision: null,
  modes: [
    { mode: 'movie', count: 100 },
    { mode: 'series', count: 100 },
    { mode: 'anime', count: 100 },
    { mode: 'game', count: 100 },
    { mode: 'music', count: 100 },
    { mode: 'diagnosis', count: 100 },
    { mode: 'city', count: 100 },
  ],
  minimumFrontendVersion: '0.1.0',
  buildSha: 'test',
  auth: {
    emailPassword: true,
    emailVerification: true,
    passwordReset: true,
    yandex: true,
  },
  commerce: {
    enabled: true,
    provider: 'stub',
    currency: 'RUB',
    archiveFirstDate: '2026-07-01',
    freeArchiveDays: 7,
  },
  features: {
    danetkiEnabled: true,
    danetkiMultiplayerEnabled: true,
    finalChoiceEnabled: true,
  },
}

describe('club page model', () => {
  it('distinguishes guest, active and expired membership', () => {
    const now = new Date('2026-07-27T12:00:00.000Z')
    expect(clubMembershipStatus(null, now)).toBe('guest')
    expect(clubMembershipStatus({ active: true, endsAt: '2026-08-01T00:00:00.000Z' }, now)).toBe('active')
    expect(clubMembershipStatus({ active: false, endsAt: '2026-07-20T00:00:00.000Z' }, now)).toBe('expired')
  })

  it('uses the current economy rules instead of duplicating limits in the page', () => {
    const model = buildClubPageViewModel({
      authenticated: true,
      membership: { active: false, endsAt: null },
      meta,
      economyRules: ECONOMY_RULE_SET_V4,
    })

    expect(model.stats.archiveDays).toBe(27)
    expect(model.stats.archiveGames).toBe(189)
    expect(model.stats.freePlayModes).toBe(7)
    expect(model.stats.danetkiPerDay).toBe(
      ECONOMY_RULE_SET_V4.danetki.dailyFreeRooms + ECONOMY_RULE_SET_V4.danetki.clubExtraRooms,
    )
    expect(model.stats.guestFriendRoomRoundLimit).toBe(
      ECONOMY_RULE_SET_V4.friendsRoom.freeBlocksPerDay * ECONOMY_RULE_SET_V4.friendsRoom.roundsPerBlock,
    )
    expect(model.stats.friendRoomRoundLimit).toBe(ECONOMY_RULE_SET_V4.friendsRoom.maxRoundsPerRoom)
  })

  it('keeps monthly and annual products separate and calculates daily price and savings', () => {
    const monthly: CommerceProduct = { ...DEFAULT_CLUB_PRODUCTS[0], priceMinor: 20_000 }
    const annual: CommerceProduct = { ...DEFAULT_CLUB_PRODUCTS[1], priceMinor: 180_000 }
    const model = buildClubPageViewModel({
      authenticated: false,
      products: [annual, monthly],
      meta,
    })

    expect(model.pricing.monthly.id).toBe('club_30d')
    expect(model.pricing.annual.id).toBe('club_365d')
    expect(dailyPriceMinor(model.pricing.monthly)).toBeCloseTo(666.67, 1)
    expect(model.pricing.annualSavingsMinor).toBe(60_000)
    expect(model.pricing.annualDiscountPercent).toBe(25)
  })

  it('counts archive dates inclusively', () => {
    expect(inclusiveCalendarDays('2026-07-01', '2026-07-01')).toBe(1)
    expect(inclusiveCalendarDays('2026-07-01', '2026-07-27')).toBe(27)
  })
})
