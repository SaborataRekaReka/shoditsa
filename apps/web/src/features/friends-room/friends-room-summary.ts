import type { FriendsRoomPhase, FriendsRoomSummary, PlayableCatalogGuessModeId } from '@shoditsa/contracts'

const modeLabels: Record<PlayableCatalogGuessModeId, string> = {
  movie: 'Кино',
  series: 'Сериалы',
  anime: 'Аниме',
  game: 'Игры',
  city: 'Города',
  music: 'Музыка',
  diagnosis: 'Диагнозы',
  animal: 'Животные',
  book: 'Книги',
  character: 'Персонажи',
}

export const friendsRoomSummaryTitle = (room: FriendsRoomSummary) => {
  if (room.gameType === 'danetki') return 'Данетки'
  if (room.gameType === 'territory') return 'Захват'
  if (room.packs.length > 1) return `${room.packs.length} пака: ${room.packs.map((pack) => modeLabels[pack.mode]).join(', ')}`
  const mode = room.packs[0]?.mode ?? room.mode
  return modeLabels[mode]
}

export const friendsRoomPhaseLabel = (phase: FriendsRoomPhase) => ({
  lobby: 'Ждёт игроков',
  countdown: 'Игра начинается',
  active: 'Игра идёт',
  results: 'Результаты раунда',
  intermission: 'Перерыв между блоками',
  finished: 'Игра завершена',
})[phase]

export const friendsRoomActionLabel = (room: FriendsRoomSummary) =>
  room.phase === 'lobby' ? 'Открыть лобби' : room.phase === 'finished' ? 'Открыть результаты' : 'Вернуться в игру'
