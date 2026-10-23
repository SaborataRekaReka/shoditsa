import type { IncomingMessage } from 'node:http'
import { RoomError } from './service'

/** Verify against the account API through this same trusted local server. Never trust the body. */
export async function assertClubRoomCreator(request: Pick<IncomingMessage, 'headers'>, read: typeof fetch = fetch) {
  const host = request.headers.host ?? ''
  if (!/^(?:localhost|127\.0\.0\.1):\d+$/.test(host)) throw new RoomError('LOCAL_ONLY', 'Этот сервер комнат работает локально.', 403)
  const cookie = request.headers.cookie
  if (!cookie) throw new RoomError('CLUB_REQUIRED', 'Создание комнаты доступно с клубным билетом.', 403)
  let response: Response
  try { response = await read(`http://${host}/api/v1/me/commerce`, { headers: { Cookie: cookie, Accept: 'application/json', Origin: `http://${host}` }, redirect: 'error', signal: AbortSignal.timeout(5_000) }) }
  catch { throw new RoomError('ACCESS_UNAVAILABLE', 'Не удалось проверить клубный билет. Повтори попытку.', 503) }
  if ([401, 403].includes(response.status)) throw new RoomError('CLUB_REQUIRED', 'Создание комнаты доступно с клубным билетом.', 403)
  if (!response.ok) throw new RoomError('ACCESS_UNAVAILABLE', 'Не удалось проверить клубный билет. Повтори попытку.', 503)
  let active = false
  try { active = (await response.json()).membership?.active === true }
  catch { throw new RoomError('ACCESS_UNAVAILABLE', 'Не удалось проверить клубный билет. Повтори попытку.', 503) }
  if (!active) throw new RoomError('CLUB_REQUIRED', 'Создание комнаты доступно с клубным билетом.', 403)
}
