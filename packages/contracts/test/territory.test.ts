import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'
import {
  CONTENT_MODE_IDS,
  FriendsRoomCreateBodySchema,
  PLAYABLE_MODE_IDS,
  TERRITORY_MAX_DUELS,
  TERRITORY_RULES_VERSION,
  TerritoryPublicSnapshotSchema,
  TerritoryQuestionItemSchema,
  type TerritoryMapSnapshot,
  type TerritoryQuestionSnapshot,
} from '../src/index.js'

const options = [
  { id: 'o1', text: 'Первый' },
  { id: 'o2', text: 'Второй' },
  { id: 'o3', text: 'Третий' },
  { id: 'o4', text: 'Четвёртый' },
] as const

const mapFixture = (): TerritoryMapSnapshot => {
  const cellCount = 11
  return {
    version: 1,
    seed: 'contract-seed',
    generation: 'fallback',
    viewBox: { x: 0, y: 0, width: 1_000, height: 720 },
    cellCount,
    baseCellIds: ['t01', 't06'],
    cells: Array.from({ length: cellCount }, (_, index) => ({
      id: `t${String(index + 1).padStart(2, '0')}`,
      value: [100, 150, 200][index % 3] as 100 | 150 | 200,
      center: [500, 360] as [number, number],
      polygon: [[500, 360], [600, 300], [600, 420]] as Array<[number, number]>,
      adjacentCellIds: [
        `t${String((index - 1 + cellCount) % cellCount + 1).padStart(2, '0')}`,
        `t${String((index + 1) % cellCount + 1).padStart(2, '0')}`,
      ],
    })),
  }
}

const questionSnapshot = (): TerritoryQuestionSnapshot => ({
  matchId: 'match-1',
  matchNumber: 1,
  rulesVersion: TERRITORY_RULES_VERSION,
  serverTime: '2026-08-27T12:00:00.000Z',
  phaseStartedAt: '2026-08-27T12:00:00.000Z',
  phaseEndsAt: '2026-08-27T12:00:20.000Z',
  duelNumber: 1,
  maxDuels: TERRITORY_MAX_DUELS,
  map: mapFixture(),
  ownership: Object.fromEntries(mapFixture().cells.map((cell) => [cell.id, null])),
  siege: { active: null, towersRemaining: { t01: 3, t06: 3 } },
  players: [
    { userId: 'player-1', displayName: 'Игрок 1', baseCellId: 't01', territoryCount: 1, territoryValueTotal: 100, correctAnswers: 0, totalCorrectAnswerTimeMs: 0 },
    { userId: 'player-2', displayName: 'Игрок 2', baseCellId: 't06', territoryCount: 1, territoryValueTotal: 100, correctAnswers: 0, totalCorrectAnswerTimeMs: 0 },
  ],
  winnerUserId: null,
  finishReason: null,
  rematchReadyUserIds: [],
  phase: 'question',
  question: {
    duelId: 'duel-1',
    position: 1,
    duelKind: 'regular',
    answerRule: 'exact',
    prompt: 'Какой вариант является правильным?',
    category: { id: 'general', label: 'Общее' },
    difficulty: 'easy',
    options: [...options],
    startedAt: '2026-08-27T12:00:00.000Z',
    endsAt: '2026-08-27T12:00:20.000Z',
    ownOptionId: null,
    opponentAnswered: false,
  },
  reveal: null,
  capture: null,
})

describe('territory contracts', () => {
  it('keeps territory as content-only and accepts the specialized room type', () => {
    expect(CONTENT_MODE_IDS).toContain('territory')
    expect(PLAYABLE_MODE_IDS).not.toContain('territory')
    expect(Value.Check(FriendsRoomCreateBodySchema, { gameType: 'territory' })).toBe(true)
  })

  it('accepts a canonical choice question with machine-readable provenance', () => {
    expect(Value.Check(TerritoryQuestionItemSchema, {
      id: 'territory:test:1',
      mode: 'territory',
      schemaVersion: 1,
      locale: 'ru-RU',
      questionType: 'choice',
      prompt: 'Какой город является столицей Франции?',
      options,
      correctOptionId: 'o2',
      explanation: 'Париж является столицей Франции.',
      category: { id: 'geography', label: 'География' },
      difficulty: 'easy',
      provenance: {
        dataset: 'Wikidata',
        sourceTitle: 'France',
        sourceUrl: 'https://www.wikidata.org/wiki/Q142',
        license: 'CC0-1.0',
        entityIds: ['Q142'],
        propertyIds: ['P36'],
        verificationClaims: [{ entityId: 'Q142', propertyId: 'P36', expectedValueType: 'wikibase-item', expectedValue: 'Q90' }],
      },
    })).toBe(true)
  })

  it('rejects correctOptionId in an open-question snapshot', () => {
    const snapshot = questionSnapshot()
    expect(Value.Check(TerritoryPublicSnapshotSchema, snapshot)).toBe(true)
    const leaked = structuredClone(snapshot) as typeof snapshot & { question: typeof snapshot.question & { correctOptionId: string } }
    leaked.question.correctOptionId = 'o2'
    expect(Value.Check(TerritoryPublicSnapshotSchema, leaked)).toBe(false)
  })
})
