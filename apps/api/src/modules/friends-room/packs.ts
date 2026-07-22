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
