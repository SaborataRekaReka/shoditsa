import { SvoyakError, svoyakClient } from './client'
import { knownRoomCredentials, markSvoyakUnavailable, observeSvoyakRoom, savedSvoyakRooms } from './room-directory-storage'

export const svoyakDirectoryKey = ['svoyak', 'directory'] as const
/** Membership is verified with the room token; no private room listing is exposed. */
export async function loadSvoyakDirectory() {
  const credentials = knownRoomCredentials()
  for (const room of savedSvoyakRooms()) if (!credentials.some(value => value.code === room.code)) markSvoyakUnavailable(room.code)
  await Promise.all(credentials.map(async credentials => {
    const previous = savedSvoyakRooms().find(room => room.code === credentials.code)
    if (previous?.closedAt) return
    try { observeSvoyakRoom(await svoyakClient.room(credentials.code, credentials.token), credentials) }
    catch (error) {
      if (error instanceof SvoyakError && [401, 403, 404].includes(error.status)) markSvoyakUnavailable(credentials.code)
      else throw error
    }
  }))
  return savedSvoyakRooms()
}
