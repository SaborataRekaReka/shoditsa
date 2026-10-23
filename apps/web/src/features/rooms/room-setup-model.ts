import { FRIENDS_ROOM_DEFAULT_PACK_VARIANTS, FRIENDS_ROOM_PACK_VARIANTS, friendsRoomMinimumRounds, type FriendsRoomCreateBody, type FriendsRoomGameType, type FriendsRoomPackSelection } from '@shoditsa/contracts'

export type RoomSetupValue = {
  gameType: FriendsRoomGameType
  packs: FriendsRoomPackSelection[]
  roundsTotal: number
  answerTimeSeconds: 15 | 20 | 30 | 45
  shufflePacks: boolean
}
export type SetupMode = FriendsRoomGameType | 'svoyak'
export const ROOM_CATEGORIES = [
  { id: 'movie', label: 'Кино' }, { id: 'series', label: 'Сериалы' }, { id: 'anime', label: 'Аниме' },
  { id: 'game', label: 'Видеоигры' }, { id: 'city', label: 'Города' }, { id: 'music', label: 'Музыка' },
  { id: 'diagnosis', label: 'Диагнозы' }, { id: 'animal', label: 'Животные' }, { id: 'book', label: 'Книги' }, { id: 'character', label: 'Персонажи' },
] as const
export const ROOM_SETUP_MODES = [
  { id: 'quiz', title: 'Викторина', detail: 'До 8 игроков', art: 'game' },
  { id: 'danetki', title: 'Данетки', detail: 'До 4 игроков', art: 'yes-no' },
  { id: 'territory', title: 'Захват', detail: 'Дуэль на двоих', art: 'territory' },
  { id: 'svoyak', title: 'Своя игра', detail: 'От 3 человек, с ведущим', art: 'svoyak' },
] as const
export function normalizeRoomSetup(value: RoomSetupValue): RoomSetupValue {
  const seen = new Set<string>()
  const packs = value.packs.filter(pack => {
    if (!(pack.mode in FRIENDS_ROOM_PACK_VARIANTS) || seen.has(pack.mode)) return false
    seen.add(pack.mode)
    return true
  }).map(pack => ({ ...pack, variant: FRIENDS_ROOM_PACK_VARIANTS[pack.mode].some(variant => variant.id === pack.variant) ? pack.variant : FRIENDS_ROOM_DEFAULT_PACK_VARIANTS[pack.mode] }))
  if (!packs.length) packs.push({ mode: 'movie', variant: 'all' })
  return { ...value, packs, roundsTotal: Math.min(30, Math.max(friendsRoomMinimumRounds(packs.length), Math.ceil(value.roundsTotal / 3) * 3)) }
}
export const defaultRoomSetup = (): RoomSetupValue => ({ gameType: 'quiz', packs: [{ mode: 'movie', variant: 'all' }], roundsTotal: 6, answerTimeSeconds: 30, shufflePacks: false })
export function roomSetupPayload(value: RoomSetupValue): FriendsRoomCreateBody {
  const setup = normalizeRoomSetup(value)
  return setup.gameType === 'quiz' ? { ...setup, mode: setup.packs[0].mode } : { gameType: setup.gameType }
}
