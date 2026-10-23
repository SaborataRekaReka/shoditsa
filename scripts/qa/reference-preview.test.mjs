import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { Value } from '@sinclair/typebox/value'
import { tsImport } from 'tsx/esm/api'
import { createReferencePreviewServer } from './reference-preview.mjs'
import { MODES, SCENARIOS, ROOM_SCENARIOS, roomForScenario } from './reference-fixtures.mjs'

const { TerritoryPublicSnapshotSchema } = await tsImport('../../packages/contracts/src/index.ts', import.meta.url)

test('QA harness rejects any non-local frontend origin', () => {
  for (const viteOrigin of ['https://shoditsa.ru', 'http://localhost:3001', 'http://user:password@localhost:5177', 'http://localhost:5177/api']) {
    assert.throws(() => createReferencePreviewServer({ viteOrigin }), /local Vite/)
  }
})

test('all fixture API routes are local and unknown writes fail closed', async t => {
  const server = createReferencePreviewServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const get = async path => {
    const response = await fetch(`${origin}${path}`)
    assert.equal(response.status, 200, path)
    return response.json()
  }
  for (const scenario of SCENARIOS) {
    const me = await get(`/api/v1/me?qa=${scenario}`)
    assert.equal(me.user.isAnonymous, scenario === 'guest')
    const dashboard = await fetch(`${origin}/api/v1/me/dashboard?qa=${scenario}`)
    assert.equal(dashboard.status, scenario === 'error' ? 503 : 200)
  }
  assert.equal((await get('/api/v1/me/commerce?qa=club')).membership.active, true)
  assert.equal((await get('/api/v1/archive?qa=empty')).items.length, 0)
  const ranking = await get('/api/v1/leaderboard?qa=member&period=all&limit=5')
  assert.equal(ranking.viewerState, 'ranked')
  assert.equal(ranking.entries.length, 5)
  assert.equal(ranking.nextOffset, 5)
  assert.equal((await get('/api/v1/leaderboard?qa=guest')).viewerState, 'guest')
  assert.equal((await get('/api/v1/leaderboard?qa=empty')).participantCount, 0)
  assert.equal((await fetch(`${origin}/api/v1/leaderboard?qa=error`)).status, 503)
  const packs = await get('/api/v1/packs?qa=club')
  assert.equal(packs.items.length, 2)
  for (const pack of packs.items) assert.equal((await get(`/api/v1/packs/${pack.id}?qa=club`)).pack.access, 'club')
  for (const mode of [...MODES, 'connections', 'danetki']) {
    for (const status of ['playing', 'won', 'lost']) {
      const response = await get(`/api/v1/games/qa-${mode}-${status}`)
      assert.equal(response.session.mode, mode)
      assert.equal(response.session.status, status)
      if (MODES.includes(mode)) assert.equal(response.session.attempts.length, status === 'playing' ? 2 : status === 'won' ? 3 : 10)
    }
  }
  const start = await fetch(`${origin}/api/v1/games/start`, { method: 'POST', body: JSON.stringify({ mode: 'movie', kind: 'daily' }) })
  assert.equal((await start.json()).session.id, 'qa-movie-playing')
  for (const [method, path] of [
    ['POST', '/api/v1/commerce/checkout'], ['PATCH', '/api/v1/me/profile'], ['POST', '/api/auth/sign-in/email'],
    ['POST', '/api/v1/games/qa-movie-playing/attempts'], ['POST', '/api/v1/private-game-orders'], ['DELETE', '/api/anything'],
    ['GET', '/api/not-a-fixture'], ['GET', '/%61pi/not-a-fixture'], ['GET', '/API/not-a-fixture'],
  ]) {
    const response = await fetch(`${origin}${path}`, { method, headers: { Cookie: 'production-cookie=must-not-forward', Authorization: 'must-not-forward' } })
    assert.equal(response.status, 501, `${method} ${path}`)
    assert.equal((await response.json()).code, 'QA_FIXTURE_NOT_IMPLEMENTED')
  }
  for (const path of ['/%2fapi/unknown', '/%2561pi/unknown', '/%5capi/unknown']) assert.equal((await fetch(`${origin}${path}`)).status, 400)
  assert.equal((await fetch(`${origin}/media/nonlocal.webp`)).status, 404)
  assert.equal((await fetch(`${origin}/data/libraries/movies/items.json`)).status, 404)
  const status = await get('/__qa/status')
  assert.equal(status.apiForwarding, false)
  assert.equal(status.counts.frontendRequests, 0, 'No API, media, or malformed request reached Vite')
})

test('scenario selection, CSP and inert HMR stay inside the harness', async t => {
  const server = createReferencePreviewServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const index = await fetch(`${origin}/__qa?qa=club`)
  assert.match(index.headers.get('set-cookie'), /reference_qa_scenario=club/)
  assert.match(index.headers.get('content-security-policy'), /connect-src 'self'/)
  assert.match(await index.text(), /данные примера/)
  const me = await fetch(`${origin}/api/v1/me/commerce`, { headers: { Cookie: 'reference_qa_scenario=club' } })
  assert.equal((await me.json()).membership.active, true)
  const client = await fetch(`${origin}/@vite/client`)
  const source = await client.text()
  assert.match(source, /export function updateStyle/)
  assert.doesNotMatch(source, /WebSocket|fetch\(/)
})

test('room phases preserve answer visibility and Territory uses the public schema and real terminal rules', () => {
  for (const scenario of ROOM_SCENARIOS) {
    const room = roomForScenario(scenario)
    assert.deepEqual(room, roomForScenario(scenario), `${scenario} must be deterministic`)
    assert.equal(room.members.length, 2)
    assert.equal(room.currentUserId, room.members[0].userId)
    assert.equal(room.continuation.canContinue, false)
    if (room.territory) {
      const snapshot = room.territory
      assert.equal(Value.Check(TerritoryPublicSnapshotSchema, snapshot), true, JSON.stringify([...Value.Errors(TerritoryPublicSnapshotSchema, snapshot)]))
      assert.equal(snapshot.phase, scenario.slice('territory-'.length))
      for (const player of snapshot.players) assert.equal(player.territoryCount, Object.values(snapshot.ownership).filter(id => id === player.userId).length)
      if (snapshot.phase === 'question') {
        assert.equal('correctOptionId' in snapshot.question, false)
        assert.equal('explanation' in snapshot.question, false)
        assert.equal(snapshot.reveal, null)
      } else {
        assert.equal(snapshot.reveal.winnerUserId, room.currentUserId)
        assert.ok(Date.parse(snapshot.reveal.endedAt) <= Date.parse(snapshot.phaseStartedAt))
      }
      if (snapshot.phase === 'capture') assert.ok(snapshot.capture.legalCellIds.length > 0)
      if (snapshot.phase === 'finished') {
        assert.equal(snapshot.finishReason, 'majority')
        assert.equal(snapshot.winnerUserId, room.currentUserId)
        assert.ok(snapshot.players[0].territoryCount > snapshot.map.cells.length / 2)
      }
    } else if (scenario === 'room-active') {
      assert.equal(room.phase, 'active')
      assert.equal(room.round.answer, null)
      assert.equal(room.round.answerCard, null)
      assert.deepEqual(room.answers, [])
    } else {
      assert.equal(room.phase, scenario === 'room-results' ? 'results' : 'finished')
      assert.equal(room.answers.length, room.members.length)
      assert.ok(room.round.answerCard.titleRu)
      assert.equal(room.answers[0].correct, true)
      assert.ok(room.answers[0].points > 0)
      assert.ok(room.answers[0].scoreBreakdown)
    }
  }
})

test('room deep links, fixed SSE and rejected phase mutations never reach the frontend proxy', async t => {
  const server = createReferencePreviewServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const origin = `http://127.0.0.1:${server.address().port}`
  const index = await (await fetch(`${origin}/__qa`)).text()
  for (const scenario of ROOM_SCENARIOS) {
    const fixture = roomForScenario(scenario)
    assert.ok(index.includes(`room=${fixture.code}&amp;qa=${scenario}`), `${scenario} has a deep link`)
    // The initial navigation saves only a local harness scenario cookie. The
    // normal app then lists rooms and reloads the matching room by its ID.
    const selection = await fetch(`${origin}/__qa?qa=${scenario}`)
    const cookie = selection.headers.get('set-cookie').split(';')[0]
    const headers = { Cookie: cookie }
    const directory = await (await fetch(`${origin}/api/v1/friends/rooms`, { headers })).json()
    assert.equal(directory.rooms[0].code, fixture.code)
    assert.equal(directory.rooms[0].phase, fixture.phase)
    const snapshot = await (await fetch(`${origin}/api/v1/friends/rooms/${fixture.id}/snapshot`, { headers })).json()
    assert.equal(snapshot.room.territory?.phase ?? snapshot.room.phase, fixture.territory?.phase ?? fixture.phase)
    const preview = await (await fetch(`${origin}/api/v1/friends/rooms/code/${fixture.code}`, { headers })).json()
    assert.equal(preview.gameType, fixture.gameType)
    const controller = new AbortController()
    try {
      const events = await fetch(`${origin}/api/v1/friends/rooms/${fixture.id}/events`, { headers, signal: controller.signal })
      assert.equal(events.status, 200)
      assert.match(events.headers.get('content-type'), /text\/event-stream/)
      const reader = events.body.getReader()
      const chunk = new TextDecoder().decode((await reader.read()).value)
      assert.match(chunk, /^event: room\.snapshot\ndata: /)
      const emitted = JSON.parse(chunk.split('\ndata: ')[1].trim())
      assert.equal(emitted.id, fixture.id)
      assert.equal(emitted.territory?.phase ?? emitted.phase, fixture.territory?.phase ?? fixture.phase)
      await reader.cancel()
    } finally { controller.abort() }
    for (const action of ['start', 'answers', 'reveal', 'next', 'continue', 'restart', 'leave', 'messages', 'territory/answers', 'territory/captures', 'territory/rematch']) {
      const rejected = await fetch(`${origin}/api/v1/friends/rooms/${fixture.id}/${action}`, { method: 'POST', headers })
      assert.equal(rejected.status, 501)
      assert.equal((await rejected.json()).code, 'QA_FIXTURE_NOT_IMPLEMENTED')
    }
    assert.equal((await fetch(`${origin}/api/v1/friends/rooms/unknown-room/snapshot`, { headers })).status, 501)
  }
  const status = await (await fetch(`${origin}/__qa/status`)).json()
  assert.equal(status.apiForwarding, false)
  assert.equal(status.counts.frontendRequests, 0)
})
