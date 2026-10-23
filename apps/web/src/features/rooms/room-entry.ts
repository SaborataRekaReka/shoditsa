import { api, ApiClientError } from '../../api/client'
import { SVOYAK_ENABLED } from '../svoyak/SvoyakHomeCard'
import { loadSvoyakDirectory } from '../svoyak/room-directory-client'
import { isCurrentRoom } from './room-directory-model'

/** Direct invitations obey the same one-room rule as the shared lobby. */
export async function assertRoomEntryAvailable(code: string) {
  const [standard, svoyak] = await Promise.all([
    api.friendsRoomList().catch(error => { if (error instanceof ApiClientError && error.status === 401) return { rooms: [] }; throw error }),
    SVOYAK_ENABLED ? loadSvoyakDirectory() : Promise.resolve([]),
  ])
  if ([...standard.rooms, ...svoyak].some(room => isCurrentRoom(room) && room.code !== code)) throw new Error('Ты уже в другой комнате. Вернись в лобби и выйди из неё, чтобы присоединиться к новой компании.')
}
