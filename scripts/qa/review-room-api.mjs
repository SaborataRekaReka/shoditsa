/** In-memory setup interaction for the unified LOCAL review server only.
 * Fixed phase scenarios still use reference-preview. No request is forwarded.
 */
import { tsImport } from 'tsx/esm/api'
import { Value } from '@sinclair/typebox/value'
import { roomForScenario, SCENARIOS } from './reference-fixtures.mjs'
const { FriendsRoomCreateBodySchema, FriendsRoomConfigBodySchema, FRIENDS_ROOM_DEFAULT_PACK_VARIANTS, FRIENDS_ROOM_PACK_VARIANTS, friendsRoomMinimumRounds } = await tsImport('../../packages/contracts/src/index.ts', import.meta.url)
const { roomSummary } = await tsImport('./reference-room-fixtures.ts', import.meta.url)
const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); return true }
async function bodyOf(request) {
  let source = ''
  for await (const chunk of request) { source += chunk; if (source.length > 16_384) throw new Error('Body too large') }
  return source ? JSON.parse(source) : {}
}
export function createReviewRoomApi({ initialRooms = [], onChange = () => {} } = {}) {
  const rooms = new Map(initialRooms.map(room => [room.id, room])), listeners = new Map()
  let nextRoom = Math.max(0, ...initialRooms.map(room => Number(room.id.replace('review-room-', '')) || 0))
  const save = () => onChange([...rooms.values()])
  const now = () => new Date().toISOString()
  const userId = scenario => scenario === 'club' ? 'visual-owner' : 'visual-friend'
  const memberships = scenario => [...rooms.values()].reverse().filter(room => room.members.some(member => member.userId === userId(scenario) && !member.leftAt))
  const project = (room, scenario) => ({ ...room, isHost: scenario === 'club', currentUserId: scenario === 'club' ? 'visual-owner' : 'visual-friend', serverTime: now() })
  const broadcast = room => { save(); for (const listener of listeners.get(room.id) ?? []) listener(room) }
  const configure = (room, config) => {
    const packs = config.packs ?? room.packs
    if (!packs.length || new Set(packs.map(pack => pack.mode)).size !== packs.length || packs.some(pack => !FRIENDS_ROOM_PACK_VARIANTS[pack.mode]?.some(variant => variant.id === pack.variant))) throw new Error('Invalid category selection')
    Object.assign(room, config, { packs, mode: packs[0].mode, version: room.version + 1 })
    room.capacity = room.gameType === 'territory' ? 2 : room.gameType === 'danetki' ? 4 : 8
    room.roundsTotal = Math.max(friendsRoomMinimumRounds(packs.length), room.roundsTotal)
    return room
  }
  return async (request, response, url, scenario) => {
    if (!url.pathname.startsWith('/api/v1/friends/rooms')) return false
    if (SCENARIOS.includes(scenario) && (scenario.startsWith('room-') || scenario.startsWith('territory-'))) return false
    const path = url.pathname.slice('/api/v1/friends/rooms'.length), method = request.method ?? 'GET'
    try {
      if (!path && method === 'GET') return json(response, 200, { rooms: memberships(scenario).slice(0, 1).map(room => roomSummary(project(room, scenario))) })
      if (!path && method === 'POST') {
        if (scenario !== 'club') return json(response, 403, { code: 'CLUB_REQUIRED', message: 'Для создания комнаты нужен Клуб.' })
        const config = await bodyOf(request)
        if (!Value.Check(FriendsRoomCreateBodySchema, config)) return json(response, 400, { code: 'INVALID_ROOM_CONFIG', message: 'Проверь настройки комнаты.' })
        const existing = memberships(scenario)[0]
        if (existing) return json(response, 200, { room: project(existing, scenario) })
        const room = roomForScenario('club', now())
        nextRoom += 1
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        const code = `Q${[15, 10, 5, 0].map(shift => alphabet[(nextRoom >>> shift) & 31]).join('')}`
        Object.assign(room, { id: `review-room-${nextRoom}`, code, members: [room.members[0]], messages: [], shufflePacks: false, packs: [{ mode: config.mode ?? 'movie', variant: FRIENDS_ROOM_DEFAULT_PACK_VARIANTS[config.mode ?? 'movie'] }] })
        room.continuation.accessSource = 'club'
        configure(room, config)
        rooms.set(room.id, room); save()
        return json(response, 200, { room: project(room, scenario) })
      }
      const match = path.match(/^\/([^/]+)(?:\/(snapshot|events|start|messages|join|leave))?$/)
      const codeMatch = path.match(/^\/code\/([^/]+)(?:\/(join))?$/)
      const room = codeMatch ? [...rooms.values()].find(room => room.code === codeMatch[1]) : match ? rooms.get(match[1]) : null
      if (!room) return false
      if (method === 'POST' && match?.[2] === 'leave') {
        const owner = room.members.find(member => member.userId === userId(scenario))?.role === 'owner'
        for (const member of room.members) if (owner || member.userId === userId(scenario)) { member.leftAt = now(); member.connected = false }
        if (owner || room.members.every(member => member.leftAt)) room.phase = 'finished'
        room.version += 1; broadcast(room)
        return json(response, 200, { left: true })
      }
      if (room.members.every(member => member.leftAt)) return json(response, 404, { code: 'FRIENDS_ROOM_NOT_FOUND', message: 'Комната закрыта.' })
      if (codeMatch && method === 'GET') return json(response, 200, { code: room.code, hostName: room.members[0].displayName, gameType: room.gameType, danetkiLaunchCost: room.danetkiLaunchCost, mode: room.mode, packs: room.packs, players: room.members.length, capacity: room.capacity, phase: room.phase })
      if (codeMatch?.[2] === 'join' && method === 'POST') {
        if (memberships(scenario).some(current => current.id !== room.id)) return json(response, 409, { code: 'FRIENDS_ROOM_ALREADY_OPEN', message: 'Сначала покиньте текущую комнату.' })
        const body = await bodyOf(request)
        const returning = room.members.find(member => member.userId === userId(scenario))
        if (!returning || returning.leftAt) {
          if (room.members.filter(member => !member.leftAt).length >= room.capacity) return json(response, 409, { code: 'ROOM_FULL' })
          const person = roomForScenario('club', now()).members[1]
          if (body.displayName) person.displayName = String(body.displayName).slice(0, 40)
          if (returning) { returning.leftAt = null; returning.connected = true } else room.members.push(person)
          room.version += 1; broadcast(room)
        }
        return json(response, 200, { room: project(room, scenario) })
      }
      const action = match?.[2]
      if (action === 'snapshot' && method === 'GET') return json(response, 200, { room: project(room, scenario) })
      if (action === 'events' && method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' })
        const send = value => response.write(`event: room.snapshot\ndata: ${JSON.stringify(project(value, scenario))}\n\n`)
        const subscriptions = listeners.get(room.id) ?? new Set()
        subscriptions.add(send); listeners.set(room.id, subscriptions); send(room)
        const heartbeat = setInterval(() => response.write(': local review\n\n'), 15_000); heartbeat.unref()
        response.on('close', () => { clearInterval(heartbeat); subscriptions.delete(send) })
        return true
      }
      if (method === 'PATCH' && !action) {
        if (scenario !== 'club') return json(response, 403, { code: 'HOST_ONLY', message: 'Настройки меняет создатель комнаты.' })
        if (room.phase !== 'lobby') return json(response, 409, { code: 'GAME_STARTED', message: 'Игра уже началась.' })
        const config = await bodyOf(request)
        if (!Value.Check(FriendsRoomConfigBodySchema, config)) return json(response, 400, { code: 'INVALID_ROOM_CONFIG', message: 'Проверь настройки комнаты.' })
        configure(room, config); broadcast(room)
        return json(response, 200, { room: project(room, scenario) })
      }
      if (method === 'POST' && action === 'start') {
        if (scenario !== 'club') return json(response, 403, { code: 'HOST_ONLY', message: 'Игру запускает создатель комнаты.' })
        if (room.gameType === 'territory' && room.members.filter(member => !member.leftAt && member.connected).length !== 2) return json(response, 409, { code: 'SECOND_PLAYER_REQUIRED', message: 'Дождись второго игрока.' })
        const active = roomForScenario(room.gameType === 'territory' ? 'territory-question' : 'room-active', now())
        Object.assign(room, { phase: 'active', currentRound: 1, version: room.version + 1, round: room.gameType === 'quiz' ? { ...active.round, position: 1, mode: room.packs[0].mode, variant: room.packs[0].variant } : null, territory: active.territory, danetkiSessionId: room.gameType === 'danetki' ? 'qa-danetki-playing' : null })
        broadcast(room)
        return json(response, 200, { room: project(room, scenario) })
      }
      if (method === 'POST' && action === 'messages') {
        const body = await bodyOf(request), text = String(body.text ?? '').trim()
        if (!text || text.length > 300) return json(response, 400, { code: 'INVALID_MESSAGE' })
        const person = room.members.find(member => member.userId === project(room, scenario).currentUserId)
        if (!person) return json(response, 403, { code: 'JOIN_FIRST' })
        room.messages.push({ id: `review-message-${room.messages.length + 1}`, seq: room.messages.length + 1, userId: person.userId, displayName: person.displayName, colorKey: person.colorKey, text, createdAt: now() })
        room.version += 1; broadcast(room)
        return json(response, 200, { room: project(room, scenario) })
      }
      return false
    } catch { return json(response, 400, { code: 'INVALID_LOCAL_REVIEW_REQUEST', message: 'Не удалось применить настройки локального примера.' }) }
  }
}
