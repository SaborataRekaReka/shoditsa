/** Fixed UI states. Pure data/geometry/scoring helpers only; no database/service IO. */
import { readFileSync } from 'node:fs'
import {
  ECONOMY_RULES_VERSION, TERRITORY_CAPITAL_TOWERS, TERRITORY_MAX_DUELS,
  TERRITORY_RULES_VERSION, type FriendsRoomSnapshot, type FriendsRoomSummary,
  type TerritoryDuelReveal, type TerritoryPublicSnapshot, type TerritoryQuestionItem, type TitleItem,
} from '../../packages/contracts/src/index.js'
import {
  applyTerritoryCapture, createInitialTerritoryOwnership, createTerritoryMap,
  legalTerritoryCaptures, resolveTerritoryDuel, resolveTerritoryMatch,
  territoryCountForPlayer, territoryValueForPlayer,
} from '../../packages/game-core/src/territory.js'
import { scoreFriendsRoomGuess } from '../../apps/api/src/modules/friends-room/scoring.js'

export const ROOM_SCENARIOS = [
  'room-active', 'room-results', 'room-finished',
  'territory-question', 'territory-reveal', 'territory-capture', 'territory-finished',
] as const

const playerIds: [string, string] = ['visual-owner', 'visual-friend']
const names = ['Полуночный сеанс', 'Тихий зритель']
const map = createTerritoryMap('reference-qa-stable-map-v1', 12)
const questions = JSON.parse(readFileSync(new URL('../../public/data/libraries/territory/items.json', import.meta.url), 'utf8')) as TerritoryQuestionItem[]
const question = questions[0]
const isoAfter = (now: string, milliseconds: number) => new Date(Date.parse(now) + milliseconds).toISOString()

export function territoryFixture(phase: 'question' | 'reveal' | 'capture' | 'finished', now: string): TerritoryPublicSnapshot {
  let ownership = createInitialTerritoryOwnership(map, playerIds)
  // Populate a mid-match board through the real adjacency/capture rules. No
  // capital changes are fabricated; both original bases stay with their owner.
  const captureOne = (player: string) => {
    const cell = legalTerritoryCaptures(map, ownership, player).find(id => !map.baseCellIds.includes(id) && ownership[id] === null)
    if (cell) ownership = applyTerritoryCapture(map, ownership, player, cell)
  }
  captureOne(playerIds[0]); captureOne(playerIds[1]); captureOne(playerIds[0])
  if (phase === 'finished') {
    while (territoryCountForPlayer(map, ownership, playerIds[0]) < 7) {
      const before = territoryCountForPlayer(map, ownership, playerIds[0])
      captureOne(playerIds[0])
      if (before === territoryCountForPlayer(map, ownership, playerIds[0])) break
    }
  }
  const players = playerIds.map((userId, index) => ({
    userId, displayName: names[index], baseCellId: map.baseCellIds[index],
    territoryCount: territoryCountForPlayer(map, ownership, userId),
    territoryValueTotal: territoryValueForPlayer(map, ownership, userId),
    correctAnswers: index === 0 ? phase === 'finished' ? 8 : 3 : 2,
    totalCorrectAnswerTimeMs: index === 0 ? phase === 'finished' ? 32_000 : 14_000 : 18_000,
  })) as TerritoryPublicSnapshot['players']
  const common = {
    matchId: 'qa-territory-match', matchNumber: 1, rulesVersion: TERRITORY_RULES_VERSION,
    serverTime: now, phaseStartedAt: now, duelNumber: phase === 'finished' ? 12 : 4,
    maxDuels: TERRITORY_MAX_DUELS, map, ownership,
    siege: { active: null, towersRemaining: Object.fromEntries(map.baseCellIds.map(id => [id, TERRITORY_CAPITAL_TOWERS])) }, players,
  }
  const questionFields = {
    duelId: '77bc78ea-74bf-4b90-b437-43708c0be117', position: common.duelNumber,
    duelKind: 'regular' as const, answerRule: 'exact' as const,
    prompt: question.prompt, category: question.category, difficulty: question.difficulty,
    options: question.options, startedAt: phase === 'question' ? now : isoAfter(now, -7_000),
  }
  const nonFinished = { winnerUserId: null, finishReason: null, rematchReadyUserIds: [] as [] }
  if (phase === 'question') return {
    ...common, ...nonFinished, phase, phaseEndsAt: isoAfter(now, 20_000),
    question: { ...questionFields, endsAt: isoAfter(now, 20_000), ownOptionId: null, opponentAnswered: true },
    reveal: null, capture: null,
  }
  const answers: TerritoryDuelReveal['answers'] = [
    { userId: playerIds[0], optionId: question.correctOptionId, correct: true, distance: 0, elapsedMs: 4_200 },
    { userId: playerIds[1], optionId: question.options.find(option => option.id !== question.correctOptionId)!.id, correct: false, distance: null, elapsedMs: 6_700 },
  ]
  const reveal: TerritoryDuelReveal = {
    ...questionFields, endedAt: now, correctOptionId: question.correctOptionId,
    explanation: question.explanation,
    provenance: { dataset: question.provenance.dataset, sourceUrl: question.provenance.sourceUrl ?? null, license: question.provenance.license, licenseUrl: question.provenance.licenseUrl ?? null, attribution: question.provenance.attribution ?? null },
    answers, ...resolveTerritoryDuel({ playerIds, answers }), capturedCellId: null, previousOwnerUserId: null,
  }
  if (phase === 'reveal') return { ...common, ...nonFinished, phase, phaseEndsAt: isoAfter(now, 3_000), question: null, reveal, capture: null }
  if (phase === 'capture') return {
    ...common, ...nonFinished, phase, phaseEndsAt: isoAfter(now, 10_000), question: null, reveal,
    capture: { actorUserId: playerIds[0], legalCellIds: legalTerritoryCaptures(map, ownership, playerIds[0]) },
  }
  const finish = resolveTerritoryMatch({ map, ownership, players, duelCount: common.duelNumber })
  if (finish.status !== 'finished' || !finish.finishReason) throw new Error('QA territory fixture must use a real terminal position')
  return { ...common, phase: 'finished', phaseEndsAt: null, question: null, reveal, capture: null, winnerUserId: finish.winnerUserId, finishReason: finish.finishReason, rematchReadyUserIds: [] }
}

/** Complete current FriendsRoomSnapshot, adapted from responsive-layout.spec.ts. */
export function roomFixture(scenario: string, items: TitleItem[], now: string): FriendsRoomSnapshot {
  const territoryPhase = scenario.startsWith('territory-') ? scenario.slice('territory-'.length) as Parameters<typeof territoryFixture>[0] : null
  const phase = scenario === 'room-active' ? 'active' : scenario === 'room-results' ? 'results' : scenario === 'room-finished' || territoryPhase === 'finished' ? 'finished' : territoryPhase ? 'active' : 'lobby'
  const answer = items[0]
  const guesses = [answer, items[1]]
  const scores = guesses.map((guess, index) => scoreFriendsRoomGuess({ answer, guess, elapsedSeconds: 8 + index * 3, answerTimeSeconds: 30 }))
  const visibleAnswers = phase === 'results' || phase === 'finished'
  const members: FriendsRoomSnapshot['members'] = playerIds.map((userId, index) => ({
    userId, role: index === 0 ? 'owner' : 'player', displayName: names[index], colorKey: `player-${index + 1}`,
    score: phase === 'lobby' ? 0 : scores[index].points * (phase === 'finished' ? 6 : 2),
    answered: visibleAnswers || phase === 'active' && index === 1,
    joinedAt: now, leftAt: null, lastSeenAt: now, connected: true,
  }))
  const round: FriendsRoomSnapshot['round'] = phase === 'lobby' || territoryPhase ? null : {
    position: phase === 'finished' ? 6 : 3, mode: 'movie', variant: 'all',
    prompt: 'Какой фильм соответствует этим подсказкам?',
    // Same movie fields and labels as buildFriendsRoomHints; do not import its
    // service module because it also owns database mutations.
    hints: [answer.year ? `Год: ${answer.year}` : '', answer.countries?.length ? `Страны: ${answer.countries.slice(0, 2).join(', ')}` : '', answer.genres?.length ? `Жанры: ${answer.genres.slice(0, 3).join(', ')}` : '', answer.directors?.length ? `Режиссёр: ${answer.directors[0].nameRu || answer.directors[0].nameOriginal}` : ''].filter(Boolean),
    startedAt: now, endsAt: isoAfter(now, 30_000),
    answer: visibleAnswers ? answer.titleRu : null, answerOriginal: visibleAnswers ? answer.titleOriginal : null,
    answerCard: visibleAnswers ? { ...answer, year: answer.year ?? null, posterUrl: '/images/home-doodle/movie.webp' } : null,
  }
  return {
    id: territoryPhase ? 'room-territory-visual' : 'room-visual', code: territoryPhase ? 'MAPQA7' : 'SEANS7',
    gameType: territoryPhase ? 'territory' : 'quiz', mode: territoryPhase ? 'territory' : 'movie',
    danetkiSessionId: null, danetkiLaunchCost: 0, danetkiLaunch: { kind: 'daily' },
    packs: [{ mode: 'movie', variant: 'all' }, { mode: 'series', variant: 'from_2020' }], capacity: territoryPhase ? 2 : 8,
    roundsTotal: territoryPhase ? TERRITORY_MAX_DUELS : 6, shufflePacks: true, answerTimeSeconds: 30,
    phase, rulesVersion: territoryPhase ? TERRITORY_RULES_VERSION : ECONOMY_RULES_VERSION,
    currentRound: territoryPhase ? territoryPhase === 'finished' ? 12 : 4 : round?.position ?? 0,
    version: 1, currentUserId: playerIds[0], isHost: true, serverTime: now, members, round,
    answers: visibleAnswers && !territoryPhase ? members.map((member, index) => ({ userId: member.userId, displayName: member.displayName, text: guesses[index].titleRu, correct: scores[index].correct, points: scores[index].points, scoreBreakdown: scores[index].breakdown, submittedAt: now })) : [],
    messages: phase === 'lobby' ? [] : [{ id: 'qa-room-message', seq: 1, userId: playerIds[1], displayName: names[1], colorKey: 'player-2', text: 'Знакомая история! Попробуем вспомнить вместе.', createdAt: now }],
    territory: territoryPhase ? territoryFixture(territoryPhase, now) : null,
    continuation: { canContinue: false, roundsAdded: 6, nextRoundsTotal: null, accessSource: 'unavailable', cost: 0, balance: 248, shortage: 0, quote: null },
  }
}

export function roomSummary(room: FriendsRoomSnapshot): FriendsRoomSummary {
  return { id: room.id, code: room.code, gameType: room.gameType, mode: room.mode, packs: room.packs, players: room.members.length, capacity: room.capacity, phase: room.phase, currentRound: room.currentRound, roundsTotal: room.roundsTotal, isHost: room.isHost, joinedAt: room.serverTime, updatedAt: room.serverTime }
}
