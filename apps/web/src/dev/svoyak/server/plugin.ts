import type { Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage } from 'node:http'
import { EditorialQuestionBank } from './bank'
import { SqliteRoomRepository } from './repository'
import { RoomError, RoomService } from './service'
import { assertClubRoomCreator } from './creator-access'

async function body(request: IncomingMessage) {
  let length = 0; const chunks: Buffer[] = []
  for await (const chunk of request) {
    length += chunk.length
    if (length > 16_384) throw new RoomError('BODY_TOO_LARGE', 'Слишком большой запрос.', 413)
    chunks.push(Buffer.from(chunk))
  }
  if (!request.headers['content-type']?.startsWith('application/json')) throw new RoomError('JSON_REQUIRED', 'Ожидается JSON.')
  try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value }
  catch { throw new RoomError('INVALID_JSON', 'Не удалось прочитать запрос.') }
}

/** Local integration boundary, registered before the autonomous preview's API block. */
export function svoyakLocalPlugin(enabled: boolean): Plugin {
  return {
    name: 'svoyak-local-integration', apply: 'serve',
    configureServer(server) {
      if (!enabled) return
      const repository = new SqliteRoomRepository(fileURLToPath(new URL('../../../../../../archive/local/svoyak-game/rooms.sqlite3', import.meta.url)))
      const service = new RoomService(repository, new EditorialQuestionBank())
      server.httpServer?.once('close', () => { service.dispose(); repository.close() })
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const isPage = url.pathname === '/games/svoyak' || /^\/svoyak\/(?:create|join\/[A-Za-z0-9]+|rooms\/[A-Za-z0-9]+(?:\/result)?)\/?$/.test(url.pathname)
        if (isPage && request.method === 'GET') { request.url = `/index.html${url.search}`; response.setHeader('X-Robots-Tag', 'noindex, nofollow'); return next() }
        if (!url.pathname.startsWith('/api/v1/svoyak')) return next()
        const send = (value: unknown, status = 200) => {
          response.statusCode = status; response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.end(JSON.stringify(value))
        }
        try {
          const host = request.headers.host ?? ''
          if (!/^(?:localhost|127\.0\.0\.1):\d+$/.test(host)) throw new RoomError('LOCAL_ONLY', 'Этот сервер комнат работает локально.', 403)
          const pathname = url.pathname.slice('/api/v1/svoyak'.length)
          const token = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
          if (request.method === 'GET') {
            if (pathname === '/catalog') return send(await service.catalog())
            const match = pathname.match(/^\/rooms\/([A-F0-9]{6})$/)
            if (match) return send(await service.get(match[1], token))
          } else if (request.method === 'POST') {
            if (request.headers.origin !== `http://${host}`) throw new RoomError('ORIGIN_REJECTED', 'Запрос разрешён только из этой игры.', 403)
            const payload = await body(request)
            if (pathname === '/rooms') { await assertClubRoomCreator(request); return send(await service.create(payload), 201) }
            const match = pathname.match(/^\/rooms\/([A-F0-9]{6})\/(join|commands)$/)
            if (match?.[2] === 'join') return send(await service.join(match[1], payload), 201)
            if (match?.[2] === 'commands') return send(await service.command(match[1], token, payload.command, payload.commandId))
          }
          send({ code: 'NOT_FOUND', message: 'Такого действия нет.' }, 404)
        } catch (error) {
          const known = error instanceof RoomError
          send({ code: known ? error.code : 'BANK_UNAVAILABLE', message: error instanceof Error ? error.message : 'Не удалось выполнить действие.' }, known ? error.status : 503)
        }
      })
    },
  }
}
