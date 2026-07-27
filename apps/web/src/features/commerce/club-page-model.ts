import {
  DEFAULT_CLUB_PRODUCTS,
  ECONOMY_RULE_SET,
  type CommerceProduct,
  type ContentPack,
  type EconomyRuleSet,
  type MembershipSummary,
  type MetaResponse,
} from '@shoditsa/contracts'

export type ClubMembershipStatus = 'guest' | 'active' | 'expired'

export type ClubPageViewModel = {
  user: {
    isAuthenticated: boolean
    firstName?: string
  }
  membership: {
    status: ClubMembershipStatus
    expiresAt?: string
  }
  pricing: {
    monthly: CommerceProduct
    annual: CommerceProduct
    autoRenewal: false
    annualSavingsMinor: number
    annualDiscountPercent: number
  }
  stats: {
    archiveGames: number
    archiveDays: number
    freePlayModes: number
    freeArchiveDays: number
    guestFreePlayCost: number
    guestDanetkiPerDay: number
    danetkiPerDay: number
    guestFriendRoomRoundLimit: number
    friendRoomRoundLimit: number
  }
  currentSpecial?: ContentPack
}

type MembershipInput =
  | MembershipSummary
  | { active: boolean; endsAt: string | null }
  | null
  | undefined

const fallbackMonthly = DEFAULT_CLUB_PRODUCTS.find((product) => product.id === 'club_30d')!
const fallbackAnnual = DEFAULT_CLUB_PRODUCTS.find((product) => product.id === 'club_365d')!

const utcDate = (value: string) => {
  const dateOnly = value.slice(0, 10)
  return new Date(`${dateOnly}T12:00:00.000Z`)
}

export const inclusiveCalendarDays = (from: string, to: string) => {
  const difference = utcDate(to).getTime() - utcDate(from).getTime()
  return Math.max(1, Math.floor(difference / 86_400_000) + 1)
}

export const clubMembershipStatus = (
  membership: MembershipInput,
  now = new Date(),
): ClubMembershipStatus => {
  if (membership?.active) return 'active'
  if (membership?.endsAt && new Date(membership.endsAt).getTime() <= now.getTime()) return 'expired'
  return 'guest'
}

export const dailyPriceMinor = (product: CommerceProduct) => (
  product.durationDays ? product.priceMinor / product.durationDays : 0
)

export function buildClubPageViewModel(input: {
  authenticated: boolean
  firstName?: string
  membership?: MembershipInput
  products?: CommerceProduct[]
  meta?: MetaResponse | null
  economyRules?: EconomyRuleSet | null
  currentSpecial?: ContentPack
  now?: Date
}): ClubPageViewModel {
  const products = input.products ?? []
  const monthly = products.find((product) => product.id === 'club_30d') ?? fallbackMonthly
  const annual = products.find((product) => product.id === 'club_365d') ?? fallbackAnnual
  const rules = input.economyRules ?? ECONOMY_RULE_SET
  const freePlayModes = input.meta?.modes.filter((entry) => (
    String(entry.mode) !== 'danetki' && entry.count > 0
  )).length ?? 7
  const archiveDays = input.meta
    ? inclusiveCalendarDays(input.meta.commerce.archiveFirstDate, input.meta.moscowDate)
    : 1
  const annualComparisonMinor = monthly.priceMinor * 12
  const annualSavingsMinor = Math.max(0, annualComparisonMinor - annual.priceMinor)

  return {
    user: {
      isAuthenticated: input.authenticated,
      ...(input.firstName ? { firstName: input.firstName } : {}),
    },
    membership: {
      status: clubMembershipStatus(input.membership, input.now),
      ...(input.membership?.endsAt ? { expiresAt: input.membership.endsAt } : {}),
    },
    pricing: {
      monthly,
      annual,
      autoRenewal: false,
      annualSavingsMinor,
      annualDiscountPercent: annualComparisonMinor > 0
        ? Math.round(annualSavingsMinor / annualComparisonMinor * 100)
        : 0,
    },
    stats: {
      archiveGames: archiveDays * freePlayModes,
      archiveDays,
      freePlayModes,
      freeArchiveDays: input.meta?.commerce.freeArchiveDays ?? 7,
      guestFreePlayCost: rules.freePlay.ladder[0] ?? rules.freePlay.max,
      guestDanetkiPerDay: rules.danetki.dailyFreeRooms,
      danetkiPerDay: rules.danetki.dailyFreeRooms + rules.danetki.clubExtraRooms,
      guestFriendRoomRoundLimit: rules.friendsRoom.freeBlocksPerDay * rules.friendsRoom.roundsPerBlock,
      friendRoomRoundLimit: rules.friendsRoom.maxRoundsPerRoom,
    },
    ...(input.currentSpecial ? { currentSpecial: input.currentSpecial } : {}),
  }
}
