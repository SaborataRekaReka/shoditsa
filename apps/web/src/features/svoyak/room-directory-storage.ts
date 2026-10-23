import type { FriendsRoomSummary } from '@shoditsa/contracts'
import type { Credentials, RoomView } from './contracts'

export type SvoyakRoomSummary = Omit<FriendsRoomSummary, 'gameType'> & { gameType: 'svoyak' }
const DIRECTORY_KEY = 'svoyak:directory:v1'
const credentialKey = (code: string) => `svoyak:room:v1:${code}`
const validCredentials = (value: unknown): value is Credentials => {
  if (!value || typeof value !== 'object') return false
  const item = value as Credentials
  return /^[A-F0-9]{6}$/.test(item.code) && typeof item.token === 'string' && !!item.token && typeof item.memberId === 'string' && !!item.memberId
}
export function roomCredentials(code: string): Credentials | null {
  try { const value: unknown = JSON.parse(sessionStorage.getItem(credentialKey(code)) ?? 'null'); return validCredentials(value) && value.code === code ? value : null } catch { return null }
}
export function rememberRoom(credentials: Credentials) {
  if (!validCredentials(credentials)) return
  try { sessionStorage.setItem(credentialKey(credentials.code), JSON.stringify(credentials)) } catch { /* The active page still has its credentials. */ }
}
export function knownRoomCredentials(): Credentials[] {
  try {
    return Object.keys(sessionStorage).filter(key => key.startsWith('svoyak:room:v1:')).map(key => roomCredentials(key.slice('svoyak:room:v1:'.length))).filter((value): value is Credentials => !!value)
  } catch { return [] }
}
export function savedSvoyakRooms(): SvoyakRoomSummary[] {
  try {
    const values: unknown = JSON.parse(sessionStorage.getItem(DIRECTORY_KEY) ?? '[]')
    return Array.isArray(values) ? values.filter((value): value is SvoyakRoomSummary => value?.gameType === 'svoyak' && /^[A-F0-9]{6}$/.test(value.code) && typeof value.updatedAt === 'string') : []
  } catch { return [] }
}
function saveSummary(summary: SvoyakRoomSummary) {
  try {
    const rooms = [summary, ...savedSvoyakRooms().filter(room => room.id !== summary.id)].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 30)
    sessionStorage.setItem(DIRECTORY_KEY, JSON.stringify(rooms))
  } catch { /* Storage is optional. */ }
}
export function observeSvoyakRoom(room: RoomView, credentials: Credentials, left = false, resume = false) {
  const previous = savedSvoyakRooms().find(value => value.code === room.code)
  if (!room.me && !previous) return
  const now = new Date(room.serverNow).toISOString()
  const departed = left || !room.me || Boolean(previous?.leftAt && !resume)
  saveSummary({
    id: `svoyak:${room.code}`, code: room.code, gameType: 'svoyak', mode: 'movie', packs: [],
    players: room.members.length, capacity: 13, phase: room.stage === 'lobby' ? 'lobby' : room.stage === 'playing' ? 'active' : 'finished',
    currentRound: Math.min(room.settings.rounds, Math.floor(room.played / (room.settings.themesPerRound * 5)) + 1), roundsTotal: room.settings.rounds,
    isHost: room.hostId === credentials.memberId, joinedAt: previous?.joinedAt ?? now,
    updatedAt: previous && previous.phase === (room.stage === 'lobby' ? 'lobby' : room.stage === 'playing' ? 'active' : 'finished') && previous.players === room.members.length && Boolean(previous.leftAt) === departed && Boolean(previous.closedAt) === (room.stage === 'closed') ? previous.updatedAt : now,
    ...(departed ? { leftAt: previous?.leftAt ?? now } : {}), ...(room.stage === 'closed' ? { closedAt: previous?.closedAt ?? now } : {}),
    participantCount: Math.max(previous?.participantCount ?? 0, room.members.length),
  })
}
export function markSvoyakUnavailable(code: string) {
  const room = savedSvoyakRooms().find(value => value.code === code)
  if (room) saveSummary({ ...room, closedAt: room.closedAt ?? new Date().toISOString() })
}
