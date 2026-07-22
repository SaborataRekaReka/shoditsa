import {
  FRIENDS_ROOM_DEFAULT_PACK_VARIANTS,
  FRIENDS_ROOM_PACK_VARIANTS,
  type FriendsRoomPackSelection,
  type PlayableMode,
  type TitleItem,
} from '@shoditsa/contracts'
import { ApiError } from '../../lib/errors.js'

export const defaultFriendsRoomPack = (mode: PlayableMode): FriendsRoomPackSelection => ({
  mode,
  variant: FRIENDS_ROOM_DEFAULT_PACK_VARIANTS[mode],
})

export const normalizeFriendsRoomPacks = (
  packs: FriendsRoomPackSelection[] | null | undefined,
  legacyMode: PlayableMode = 'series',
): FriendsRoomPackSelection[] => {
  const source = packs?.length ? packs : [defaultFriendsRoomPack(legacyMode)]
  const seen = new Set<PlayableMode>()
  const result: FriendsRoomPackSelection[] = []
  for (const pack of source) {
    if (seen.has(pack.mode)) continue
    const variant = pack.mode === 'music' && (pack.variant === 'all' || pack.variant === 'active')
      ? 'medium'
      : ['movie', 'anime'].includes(pack.mode) && pack.variant === 'modern'
        ? 'from_2000'
        : pack.mode !== 'city' && ['classic', 'short', 'long', 'infectious', 'acute'].includes(pack.variant)
          ? 'all'
          : pack.variant
    const variants = FRIENDS_ROOM_PACK_VARIANTS[pack.mode]
    if (!variants.some((entry) => entry.id === variant)) {
      throw new ApiError(422, 'FRIENDS_ROOM_PACK_VARIANT_INVALID', `Режим «${pack.variant}» недоступен для выбранного пака`)
    }
    seen.add(pack.mode)
    result.push({ mode: pack.mode, variant })
  }
  if (!result.length) throw new ApiError(422, 'FRIENDS_ROOM_PACK_REQUIRED', 'Выберите хотя бы один игровой пак')
  return result
}

export const friendsRoomItemMatchesPack = (item: TitleItem, pack: FriendsRoomPackSelection) => {
  if (item.mode !== pack.mode) return false
  if (pack.variant === 'all') return true
  if (pack.variant.startsWith('from_')) {
    const fromYear = Number(pack.variant.slice('from_'.length))
    return Number.isFinite(fromYear) && item.year != null && item.year >= fromYear
  }
  if (pack.mode === 'city' && pack.variant === 'capitals') return item.capital === true
  if (pack.mode === 'city' && pack.variant === 'capitals-popular') return item.capital === true || item.popular === true
  if (pack.mode === 'music' && ['easy', 'medium', 'hard', 'expert'].includes(pack.variant)) return true
  return false
}

const seededOrder = (seed: string) => {
  let state = 0x811c9dc5
  for (const character of seed) {
    state ^= character.codePointAt(0) ?? 0
    state = Math.imul(state, 0x01000193)
  }
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Builds a balanced pack rotation for one room. Every selected pack is used
 * once before any pack repeats. The host may preserve the selected order or
 * enable a stable shuffle for the whole game.
 */
export const buildFriendsRoomPackSchedule = (
  packs: FriendsRoomPackSelection[],
  roundsTotal: number,
  seed: string,
  shuffle = false,
) => {
  if (!packs.length || roundsTotal <= 0) return []
  const shuffled = [...packs]
  if (shuffle) {
    const random = seededOrder(`${seed}:${packs.map((pack) => `${pack.mode}/${pack.variant}`).join('|')}`)
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1))
      ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
    }
  }
  return Array.from({ length: roundsTotal }, (_, index) => shuffled[index % shuffled.length])
}
