import { ensureServerSession } from '../../hooks/use-server-runtime'
import { SVOYAK_API, type AvatarId, type Catalog, type Command, type Credentials, type RoomSettings, type RoomView } from './contracts'
import { observeSvoyakRoom, rememberRoom } from './room-directory-storage'
export { rememberRoom, roomCredentials } from './room-directory-storage'

export class SvoyakError extends Error { constructor(public code: string, message: string, public status: number) { super(message) } }
let sessionReady: Promise<unknown> | undefined
async function request<T>(path: string, token?: string, payload?: unknown): Promise<T> {
  if (payload !== undefined || token) {
    sessionReady ??= ensureServerSession().catch(error => { sessionReady = undefined; throw error })
    await sessionReady
  }
  const response = await fetch(`${SVOYAK_API}${path}`, {
    method: payload === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(60_000),
  })
  const value = await response.json()
  const failure = value.error ?? value
  if (!response.ok) throw new SvoyakError(failure.code ?? 'REQUEST_FAILED', failure.message ?? 'Не удалось загрузить игру.', response.status)
  return value
}
async function enter(path: string, payload: unknown) {
  const result = await request<{ credentials: Credentials; room: RoomView }>(path, undefined, payload)
  rememberRoom(result.credentials)
  observeSvoyakRoom(result.room, result.credentials, false, true)
  return result
}
export const svoyakClient = {
  catalog: () => request<Catalog>('/catalog'),
  create: (name: string, avatar: AvatarId, settings: RoomSettings) => enter('/rooms', { name, avatar, settings }),
  join: (code: string, name: string, avatar: AvatarId) => enter(`/rooms/${code}/join`, { name, avatar }),
  room: (code: string, token?: string) => request<RoomView>(`/rooms/${code}`, token),
  command: async (credentials: Credentials, command: Command) => {
    const room = await request<RoomView>(`/rooms/${credentials.code}/commands`, credentials.token, { command, commandId: crypto.randomUUID() })
    observeSvoyakRoom(room, credentials, command.type === 'leave')
    return room
  },
}
