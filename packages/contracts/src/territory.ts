import { Type, type Static } from '@sinclair/typebox'

export const TERRITORY_PLAYER_COUNT = 2 as const
export const TERRITORY_MIN_CELL_COUNT = 11 as const
export const TERRITORY_DEFAULT_CELL_COUNT = 12 as const
export const TERRITORY_MAX_CELL_COUNT = 13 as const
export const TERRITORY_MAX_DUELS = 20 as const
export const TERRITORY_MAX_QUESTION_COUNT = 80 as const
export const TERRITORY_QUESTION_TIME_MS = 20_000 as const
export const TERRITORY_CAPTURE_TIME_MS = 10_000 as const
export const TERRITORY_SPEED_TIE_WINDOW_MS = 150 as const
export const TERRITORY_CAPITAL_TOWERS = 3 as const
export const TERRITORY_RULES_VERSION = 2 as const
export const TERRITORY_MAP_VERSION = 1 as const

export const TERRITORY_PHASES = ['countdown', 'question', 'reveal', 'capture', 'finished'] as const
export const TERRITORY_DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export const TERRITORY_DUEL_KINDS = ['regular', 'siege'] as const
export const TERRITORY_ANSWER_RULES = ['exact', 'numeric_closest'] as const
export const TERRITORY_DUEL_RESULTS = ['single_correct', 'closer', 'faster', 'speed_tie', 'no_correct'] as const
export const TERRITORY_FINISH_REASONS = ['capital', 'majority', 'territories', 'territory_value', 'correct_answers', 'correct_time', 'draw', 'forfeit'] as const

export type TerritoryPhase = typeof TERRITORY_PHASES[number]
export type TerritoryDifficulty = typeof TERRITORY_DIFFICULTIES[number]
export type TerritoryDuelKind = typeof TERRITORY_DUEL_KINDS[number]
export type TerritoryAnswerRule = typeof TERRITORY_ANSWER_RULES[number]
export type TerritoryDuelResultReason = typeof TERRITORY_DUEL_RESULTS[number]
export type TerritoryFinishReason = typeof TERRITORY_FINISH_REASONS[number]

export const TerritoryQuestionOptionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_-]+$' }),
  text: Type.String({ minLength: 1, maxLength: 160 }),
}, { additionalProperties: false })

export const TerritoryQuestionOptionsSchema = Type.Tuple([
  TerritoryQuestionOptionSchema,
  TerritoryQuestionOptionSchema,
  TerritoryQuestionOptionSchema,
  TerritoryQuestionOptionSchema,
])

export const TerritoryQuestionCategorySchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 60, pattern: '^[a-z0-9_-]+$' }),
  label: Type.String({ minLength: 1, maxLength: 80 }),
}, { additionalProperties: false })

export const TerritoryQuestionProvenanceSchema = Type.Object({
  dataset: Type.String({ minLength: 1, maxLength: 160 }),
  sourceTitle: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  sourceUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  license: Type.String({ minLength: 1, maxLength: 120 }),
  licenseUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  attribution: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  sourceQuestionId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  retrievedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  entityIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 20, uniqueItems: true })),
  propertyIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 20, uniqueItems: true })),
  verificationClaims: Type.Optional(Type.Array(Type.Object({
    entityId: Type.String({ minLength: 1, maxLength: 160 }),
    propertyId: Type.String({ minLength: 1, maxLength: 160 }),
    expectedValueType: Type.String({ minLength: 1, maxLength: 40 }),
    expectedValue: Type.Unknown(),
  }, { additionalProperties: false }), { maxItems: 40 })),
}, { additionalProperties: false })

/** Canonical release-content payload. The correct option is server-only. */
export const TerritoryQuestionItemSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 160 }),
  externalId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  mode: Type.Optional(Type.Literal('territory')),
  schemaVersion: Type.Literal(1),
  locale: Type.String({ minLength: 2, maxLength: 16 }),
  questionType: Type.Literal('choice'),
  type: Type.Optional(Type.Literal('multiple_choice')),
  titleRu: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  titleOriginal: Type.Optional(Type.String({ maxLength: 500 })),
  alternativeTitles: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 20 })),
  prompt: Type.String({ minLength: 10, maxLength: 500 }),
  options: TerritoryQuestionOptionsSchema,
  correctOptionId: Type.String({ minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_-]+$' }),
  explanation: Type.String({ minLength: 1, maxLength: 800 }),
  category: TerritoryQuestionCategorySchema,
  difficulty: Type.Union(TERRITORY_DIFFICULTIES.map((value) => Type.Literal(value))),
  provenance: TerritoryQuestionProvenanceSchema,
  contentStatus: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  allowedInGame: Type.Optional(Type.Boolean()),
  popularityScore: Type.Optional(Type.Number()),
}, { additionalProperties: false })

export type TerritoryQuestionOption = Static<typeof TerritoryQuestionOptionSchema>
export type TerritoryQuestionCategory = Static<typeof TerritoryQuestionCategorySchema>
export type TerritoryQuestionProvenance = Static<typeof TerritoryQuestionProvenanceSchema>
export type TerritoryQuestionItem = Static<typeof TerritoryQuestionItemSchema>

export const TerritoryMapPointSchema = Type.Tuple([Type.Number(), Type.Number()])

export const TerritoryMapCellSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 24, pattern: '^[a-z0-9_-]+$' }),
  value: Type.Union([Type.Literal(100), Type.Literal(150), Type.Literal(200)]),
  center: TerritoryMapPointSchema,
  polygon: Type.Array(TerritoryMapPointSchema, { minItems: 3, maxItems: 64 }),
  adjacentCellIds: Type.Array(Type.String({ minLength: 1, maxLength: 24, pattern: '^[a-z0-9_-]+$' }), {
    minItems: 1,
    maxItems: TERRITORY_MAX_CELL_COUNT - 1,
    uniqueItems: true,
  }),
}, { additionalProperties: false })

export const TerritoryMapSnapshotSchema = Type.Object({
  version: Type.Literal(TERRITORY_MAP_VERSION),
  seed: Type.String({ minLength: 1, maxLength: 200 }),
  generation: Type.Union([Type.Literal('procedural'), Type.Literal('fallback')]),
  viewBox: Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number({ exclusiveMinimum: 0 }),
    height: Type.Number({ exclusiveMinimum: 0 }),
  }, { additionalProperties: false }),
  cellCount: Type.Integer({ minimum: TERRITORY_MIN_CELL_COUNT, maximum: TERRITORY_MAX_CELL_COUNT }),
  baseCellIds: Type.Tuple([
    Type.String({ minLength: 1, maxLength: 24 }),
    Type.String({ minLength: 1, maxLength: 24 }),
  ]),
  cells: Type.Array(TerritoryMapCellSchema, { minItems: TERRITORY_MIN_CELL_COUNT, maxItems: TERRITORY_MAX_CELL_COUNT }),
}, { additionalProperties: false })

export type TerritoryMapPoint = Static<typeof TerritoryMapPointSchema>
export type TerritoryMapCell = Static<typeof TerritoryMapCellSchema>
export type TerritoryMapSnapshot = Static<typeof TerritoryMapSnapshotSchema>
export type TerritoryOwnership = Record<string, string | null>

export const TerritorySiegeStateSchema = Type.Object({
  active: Type.Union([
    Type.Object({
      attackerUserId: Type.String({ minLength: 1, maxLength: 160 }),
      targetCellId: Type.String({ minLength: 1, maxLength: 24, pattern: '^[a-z0-9_-]+$' }),
    }, { additionalProperties: false }),
    Type.Null(),
  ]),
  towersRemaining: Type.Record(
    Type.String({ minLength: 1, maxLength: 24, pattern: '^[a-z0-9_-]+$' }),
    Type.Integer({ minimum: 0, maximum: TERRITORY_CAPITAL_TOWERS }),
  ),
}, { additionalProperties: false })

export type TerritorySiegeState = Static<typeof TerritorySiegeStateSchema>

export const TerritoryPlayerSnapshotSchema = Type.Object({
  userId: Type.String({ minLength: 1, maxLength: 160 }),
  displayName: Type.String({ minLength: 1, maxLength: 40 }),
  baseCellId: Type.String({ minLength: 1, maxLength: 24 }),
  territoryCount: Type.Integer({ minimum: 0, maximum: TERRITORY_MAX_CELL_COUNT }),
  territoryValueTotal: Type.Integer({ minimum: 0 }),
  correctAnswers: Type.Integer({ minimum: 0, maximum: TERRITORY_MAX_DUELS }),
  totalCorrectAnswerTimeMs: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })

const TerritoryQuestionPublicFields = {
  duelId: Type.String({ minLength: 1, maxLength: 160 }),
  position: Type.Integer({ minimum: 1, maximum: TERRITORY_MAX_QUESTION_COUNT }),
  duelKind: Type.Union(TERRITORY_DUEL_KINDS.map((value) => Type.Literal(value))),
  answerRule: Type.Union(TERRITORY_ANSWER_RULES.map((value) => Type.Literal(value))),
  prompt: Type.String({ minLength: 1, maxLength: 500 }),
  category: TerritoryQuestionCategorySchema,
  difficulty: Type.Union(TERRITORY_DIFFICULTIES.map((value) => Type.Literal(value))),
  options: TerritoryQuestionOptionsSchema,
  startedAt: Type.String({ minLength: 1, maxLength: 64 }),
} as const

/** Public while answers are open. It intentionally has no correctOptionId. */
export const TerritoryPublicQuestionSchema = Type.Object({
  ...TerritoryQuestionPublicFields,
  endsAt: Type.String({ minLength: 1, maxLength: 64 }),
  ownOptionId: Type.Union([Type.String({ minLength: 1, maxLength: 40 }), Type.Null()]),
  opponentAnswered: Type.Boolean(),
}, { additionalProperties: false })

export const TerritoryPublicProvenanceSchema = Type.Object({
  dataset: Type.String({ minLength: 1, maxLength: 160 }),
  sourceUrl: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
  license: Type.String({ minLength: 1, maxLength: 120 }),
  licenseUrl: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
  attribution: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
}, { additionalProperties: false })

export const TerritoryRevealedAnswerSchema = Type.Object({
  userId: Type.String({ minLength: 1, maxLength: 160 }),
  optionId: Type.Union([Type.String({ minLength: 1, maxLength: 40 }), Type.Null()]),
  correct: Type.Boolean(),
  distance: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  elapsedMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
}, { additionalProperties: false })

export const TerritoryDuelRevealSchema = Type.Object({
  ...TerritoryQuestionPublicFields,
  endedAt: Type.String({ minLength: 1, maxLength: 64 }),
  correctOptionId: Type.String({ minLength: 1, maxLength: 40 }),
  explanation: Type.String({ minLength: 1, maxLength: 800 }),
  provenance: TerritoryPublicProvenanceSchema,
  answers: Type.Tuple([TerritoryRevealedAnswerSchema, TerritoryRevealedAnswerSchema]),
  result: Type.Union(TERRITORY_DUEL_RESULTS.map((value) => Type.Literal(value))),
  winnerUserId: Type.Union([Type.String({ minLength: 1, maxLength: 160 }), Type.Null()]),
  capturedCellId: Type.Union([Type.String({ minLength: 1, maxLength: 24 }), Type.Null()]),
  previousOwnerUserId: Type.Union([Type.String({ minLength: 1, maxLength: 160 }), Type.Null()]),
}, { additionalProperties: false })

export const TerritoryCaptureTurnSchema = Type.Object({
  actorUserId: Type.String({ minLength: 1, maxLength: 160 }),
  legalCellIds: Type.Array(Type.String({ minLength: 1, maxLength: 24 }), { minItems: 1, maxItems: TERRITORY_MAX_CELL_COUNT }),
}, { additionalProperties: false })

export type TerritoryPlayerSnapshot = Static<typeof TerritoryPlayerSnapshotSchema>
export type TerritoryPublicQuestion = Static<typeof TerritoryPublicQuestionSchema>
export type TerritoryPublicProvenance = Static<typeof TerritoryPublicProvenanceSchema>
export type TerritoryRevealedAnswer = Static<typeof TerritoryRevealedAnswerSchema>
export type TerritoryDuelReveal = Static<typeof TerritoryDuelRevealSchema>
export type TerritoryCaptureTurn = Static<typeof TerritoryCaptureTurnSchema>

const TerritorySnapshotCommonFields = {
  matchId: Type.String({ minLength: 1, maxLength: 160 }),
  matchNumber: Type.Integer({ minimum: 1 }),
  rulesVersion: Type.Integer({ minimum: 1, maximum: TERRITORY_RULES_VERSION }),
  serverTime: Type.String({ minLength: 1, maxLength: 64 }),
  phaseStartedAt: Type.String({ minLength: 1, maxLength: 64 }),
  duelNumber: Type.Integer({ minimum: 0, maximum: TERRITORY_MAX_QUESTION_COUNT }),
  maxDuels: Type.Literal(TERRITORY_MAX_DUELS),
  map: TerritoryMapSnapshotSchema,
  ownership: Type.Record(Type.String({ minLength: 1, maxLength: 24 }), Type.Union([
    Type.String({ minLength: 1, maxLength: 160 }),
    Type.Null(),
  ])),
  siege: TerritorySiegeStateSchema,
  players: Type.Tuple([TerritoryPlayerSnapshotSchema, TerritoryPlayerSnapshotSchema]),
} as const

const nonFinishedFields = {
  winnerUserId: Type.Null(),
  finishReason: Type.Null(),
  rematchReadyUserIds: Type.Tuple([]),
} as const

export const TerritoryCountdownSnapshotSchema = Type.Object({
  ...TerritorySnapshotCommonFields,
  ...nonFinishedFields,
  phase: Type.Literal('countdown'),
  phaseEndsAt: Type.String({ minLength: 1, maxLength: 64 }),
  question: Type.Null(),
  reveal: Type.Null(),
  capture: Type.Null(),
}, { additionalProperties: false })

export const TerritoryQuestionSnapshotSchema = Type.Object({
  ...TerritorySnapshotCommonFields,
  ...nonFinishedFields,
  phase: Type.Literal('question'),
  phaseEndsAt: Type.String({ minLength: 1, maxLength: 64 }),
  question: TerritoryPublicQuestionSchema,
  reveal: Type.Null(),
  capture: Type.Null(),
}, { additionalProperties: false })

export const TerritoryRevealSnapshotSchema = Type.Object({
  ...TerritorySnapshotCommonFields,
  ...nonFinishedFields,
  phase: Type.Literal('reveal'),
  phaseEndsAt: Type.String({ minLength: 1, maxLength: 64 }),
  question: Type.Null(),
  reveal: TerritoryDuelRevealSchema,
  capture: Type.Null(),
}, { additionalProperties: false })

export const TerritoryCapturePhaseSnapshotSchema = Type.Object({
  ...TerritorySnapshotCommonFields,
  ...nonFinishedFields,
  phase: Type.Literal('capture'),
  phaseEndsAt: Type.String({ minLength: 1, maxLength: 64 }),
  question: Type.Null(),
  reveal: TerritoryDuelRevealSchema,
  capture: TerritoryCaptureTurnSchema,
}, { additionalProperties: false })

export const TerritoryFinishedSnapshotSchema = Type.Object({
  ...TerritorySnapshotCommonFields,
  phase: Type.Literal('finished'),
  phaseEndsAt: Type.Null(),
  question: Type.Null(),
  reveal: Type.Union([TerritoryDuelRevealSchema, Type.Null()]),
  capture: Type.Null(),
  winnerUserId: Type.Union([Type.String({ minLength: 1, maxLength: 160 }), Type.Null()]),
  finishReason: Type.Union(TERRITORY_FINISH_REASONS.map((value) => Type.Literal(value))),
  rematchReadyUserIds: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: TERRITORY_PLAYER_COUNT, uniqueItems: true }),
}, { additionalProperties: false })

export const TerritoryPublicSnapshotSchema = Type.Union([
  TerritoryCountdownSnapshotSchema,
  TerritoryQuestionSnapshotSchema,
  TerritoryRevealSnapshotSchema,
  TerritoryCapturePhaseSnapshotSchema,
  TerritoryFinishedSnapshotSchema,
])

export type TerritoryCountdownSnapshot = Static<typeof TerritoryCountdownSnapshotSchema>
export type TerritoryQuestionSnapshot = Static<typeof TerritoryQuestionSnapshotSchema>
export type TerritoryRevealSnapshot = Static<typeof TerritoryRevealSnapshotSchema>
export type TerritoryCapturePhaseSnapshot = Static<typeof TerritoryCapturePhaseSnapshotSchema>
export type TerritoryFinishedSnapshot = Static<typeof TerritoryFinishedSnapshotSchema>
export type TerritoryPublicSnapshot = Static<typeof TerritoryPublicSnapshotSchema>

export const TerritoryAnswerBodySchema = Type.Object({
  duelId: Type.String({ format: 'uuid' }),
  optionId: Type.String({ minLength: 1, maxLength: 40 }),
}, { additionalProperties: false })

export const TerritoryCaptureBodySchema = Type.Object({
  cellId: Type.String({ minLength: 1, maxLength: 24 }),
}, { additionalProperties: false })

export const TerritoryRematchBodySchema = Type.Object({}, { additionalProperties: false })

export type TerritoryAnswerBody = Static<typeof TerritoryAnswerBodySchema>
export type TerritoryCaptureBody = Static<typeof TerritoryCaptureBodySchema>
export type TerritoryRematchBody = Static<typeof TerritoryRematchBodySchema>
