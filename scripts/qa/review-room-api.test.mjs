import { createServer } from 'node:http'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReviewRoomApi } from './review-room-api.mjs'

test('local room review preserves setup, enforces host rights and starts only explicitly', async () => {
  let savedRooms = []
  let handle = createReviewRoomApi({ onChange: rooms => { savedRooms = structuredClone(rooms) } })
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    if (!await handle(request, response, url, request.headers['x-scenario'] ?? 'club')) { response.statusCode = 501; response.end('{}') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const call = async (path, method = 'GET', body, scenario = 'club') => {
    const response = await fetch(`${origin}/api/v1/friends/rooms${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-scenario': scenario }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  try {
    const config = { gameType: 'quiz', mode: 'anime', packs: [{ mode: 'anime', variant: 'from_2010' }, { mode: 'movie', variant: 'all' }], roundsTotal: 12, answerTimeSeconds: 20, shufflePacks: true }
    const created = await call('', 'POST', config)
    assert.equal(created.status, 200)
    const room = created.body.room
    assert.equal(room.phase, 'lobby')
    assert.equal(room.members.length, 1)
    assert.match(room.code, /^[A-Z2-9]{5}$/)
    for (const key of ['packs', 'roundsTotal', 'answerTimeSeconds', 'shufflePacks']) assert.deepEqual(room[key], config[key])
    const reload = await call(`/${room.id}/snapshot`)
    assert.deepEqual(reload.body.room.packs, config.packs)
    assert.equal((await call(`/${room.id}`, 'PATCH', { answerTimeSeconds: 45 }, 'member')).status, 403)
    assert.equal((await call(`/${room.id}/start`, 'POST', {}, 'member')).status, 403)
    assert.equal((await call('', 'GET', undefined, 'member')).body.rooms.length, 0)
    assert.equal((await call(`/code/${room.code}`, 'GET', undefined, 'member')).body.code, room.code)
    const joined = await call(`/code/${room.code}/join`, 'POST', {}, 'member')
    assert.equal(joined.status, 200)
    assert.equal(joined.body.room.isHost, false)
    assert.equal(joined.body.room.members.length, 2)
    assert.equal((await call('', 'GET', undefined, 'member')).body.rooms.length, 1)
    const edited = await call(`/${room.id}`, 'PATCH', { answerTimeSeconds: 45 })
    assert.equal(edited.body.room.answerTimeSeconds, 45)
    assert.equal(edited.body.room.phase, 'lobby')
    assert.equal((await call(`/${room.id}`, 'PATCH', { answerTimeSeconds: 99 })).status, 400)
    const started = await call(`/${room.id}/start`, 'POST', {})
    assert.equal(started.body.room.phase, 'active')
    // A preview-server restart must preserve the user's review link and settings.
    handle = createReviewRoomApi({ initialRooms: savedRooms })
    const restored = await call(`/${room.id}/snapshot`)
    assert.equal(restored.body.room.code, room.code)
    assert.equal(restored.body.room.phase, 'active')
    assert.equal(restored.body.room.answerTimeSeconds, 45)
    assert.equal((await call(`/${room.id}`, 'PATCH', { answerTimeSeconds: 15 })).status, 409)
    assert.equal((await call('/unknown/unsupported', 'POST', {})).status, 501)
    const second = await call('', 'POST', {})
    assert.equal(second.body.room.code, room.code, 'creating twice must resume the existing room, just like production')
    assert.equal((await call('', 'GET')).body.rooms.length, 1)
    assert.equal((await call(`/${room.id}/leave`, 'POST', {})).status, 200)
    assert.equal((await call('', 'GET')).body.rooms.length, 0)
    assert.equal((await call(`/code/${room.code}`)).status, 404)
    const replacement = await call('', 'POST', {})
    assert.notEqual(replacement.body.room.code, room.code)
    assert.equal((await call('', 'POST', {}, 'guest')).status, 403)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
