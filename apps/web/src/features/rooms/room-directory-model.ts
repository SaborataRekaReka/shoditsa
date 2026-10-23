import type { FriendsRoomSummary } from '@shoditsa/contracts'
import type { SvoyakRoomSummary } from '../svoyak/room-directory-storage'
import { svoyakHref } from '../svoyak/contracts'
import { friendsRoomActionLabel, friendsRoomSummaryTitle } from '../friends-room/friends-room-summary'

export type DirectoryRoom = FriendsRoomSummary | SvoyakRoomSummary

export const isCurrentRoom = (room: DirectoryRoom) => !room.leftAt && !room.closedAt
export const canRejoinRoom = (room: DirectoryRoom) => Boolean(room.leftAt) && !room.closedAt && (room.phase === 'lobby' || room.gameType === 'svoyak')
export const roomDirectoryHref = (room: DirectoryRoom) => room.gameType === 'svoyak' ? svoyakHref.room(room.code) : `/games/together?room=${encodeURIComponent(room.code)}`
export const roomInvitationHref = (room: DirectoryRoom) => room.gameType === 'svoyak' ? svoyakHref.join(room.code) : roomDirectoryHref(room)
export const roomDirectoryTitle = (room: DirectoryRoom) => room.gameType === 'svoyak' ? 'Своя игра' : friendsRoomSummaryTitle(room)
export const roomDirectoryAction = (room: DirectoryRoom) => room.gameType === 'svoyak' ? room.phase === 'finished' ? 'Открыть результаты' : room.phase === 'lobby' ? 'Открыть лобби' : 'Вернуться в игру' : friendsRoomActionLabel(room)

export function mergeRoomDirectory(current: DirectoryRoom[], recent: DirectoryRoom[]) {
  const byId = new Map(recent.map(room => [room.id, room]))
  for (const room of current) byId.set(room.id, room)
  return [...byId.values()].sort((a, b) => Number(isCurrentRoom(b)) - Number(isCurrentRoom(a)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

export function roomLeavePresentation(room: DirectoryRoom) {
  if (room.gameType === 'svoyak' && room.isHost) return { action: 'Закрыть комнату', title: 'Закрыть комнату?', description: 'Комната закроется для всех участников и останется в истории. Продолжить игру в ней не получится.' }
  if (room.gameType === 'svoyak') return { action: 'Выйти', title: 'Выйти из комнаты?', description: room.phase === 'lobby' ? 'Ты сможешь вернуться по приглашению, пока комната открыта и есть свободные места.' : 'Твоё место и очки сохранятся. Вернуться можно по той же ссылке в этом браузере.' }
  if (room.gameType === 'territory' && room.phase !== 'lobby' && room.phase !== 'finished') return {
    action: 'Сдаться и выйти', title: 'Сдаться и выйти из дуэли?',
    description: 'Соперник получит победу. Результат останется в истории комнат.',
  }
  if (room.isHost && room.phase !== 'finished') return {
    action: 'Закрыть комнату', title: 'Закрыть комнату?',
    description: 'Игра закончится для всех участников. Открыть эту комнату снова не получится. Она останется в истории.',
  }
  return {
    action: 'Выйти', title: 'Выйти из комнаты?',
    description: room.phase === 'lobby' ? 'Ты сможешь вернуться по приглашению, пока комната открыта и есть свободные места.' : 'Вернуться в эту игру после выхода не получится. Комната останется в истории.',
  }
}
