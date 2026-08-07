import { Type, type Static } from '@sinclair/typebox'
import { PlayableCatalogGuessModeSchema } from './schemas.js'
import { PLAYABLE_CATALOG_GUESS_MODE_IDS } from './game-modes.js'
import type { PublicContentItem } from './api.js'
import type { EconomyQuote } from './economy.js'

export type FriendsRoomPhase = 'lobby' | 'countdown' | 'active' | 'results' | 'intermission' | 'finished'
export type FriendsRoomGameType = 'quiz' | 'danetki'
export type FriendsRoomDanetkiLaunch = {
  kind: 'daily' | 'archive' | 'free_play'
  puzzleDate?: string
}

export const FRIENDS_ROOM_CAPACITY = 8
export const FRIENDS_ROOM_DANETKI_CAPACITY = 4

export type FriendsRoomPackVariant = {
  id: string
  label: string
  description: string
}

export const FRIENDS_ROOM_PACK_VARIANTS = {
  movie: [
    { id: 'all', label: 'Все годы', description: 'Фильмы без ограничения по году' },
    { id: 'from_2020', label: '2020+', description: 'Фильмы с 2020 года' },
    { id: 'from_2010', label: '2010+', description: 'Фильмы с 2010 года' },
    { id: 'from_2000', label: '2000+', description: 'Фильмы с 2000 года' },
    { id: 'from_1990', label: '1990+', description: 'Фильмы с 1990 года' },
    { id: 'from_1980', label: '1980+', description: 'Фильмы с 1980 года' },
    { id: 'from_1960', label: '1960+', description: 'Фильмы с 1960 года' },
  ],
  series: [
    { id: 'all', label: 'Все годы', description: 'Сериалы без ограничения по году' },
    { id: 'from_2020', label: '2020+', description: 'Сериалы с 2020 года' },
    { id: 'from_2010', label: '2010+', description: 'Сериалы с 2010 года' },
    { id: 'from_2000', label: '2000+', description: 'Сериалы с 2000 года' },
    { id: 'from_1990', label: '1990+', description: 'Сериалы с 1990 года' },
    { id: 'from_1980', label: '1980+', description: 'Сериалы с 1980 года' },
    { id: 'from_1960', label: '1960+', description: 'Сериалы с 1960 года' },
  ],
  anime: [
    { id: 'all', label: 'Все годы', description: 'Аниме без ограничения по году' },
    { id: 'from_2020', label: '2020+', description: 'Аниме с 2020 года' },
    { id: 'from_2010', label: '2010+', description: 'Аниме с 2010 года' },
    { id: 'from_2000', label: '2000+', description: 'Аниме с 2000 года' },
    { id: 'from_1990', label: '1990+', description: 'Аниме с 1990 года' },
    { id: 'from_1980', label: '1980+', description: 'Аниме с 1980 года' },
    { id: 'from_1960', label: '1960+', description: 'Аниме с 1960 года' },
  ],
  game: [
    { id: 'all', label: 'Весь каталог', description: 'В основной игре нет отдельных режимов' },
  ],
  city: [
    { id: 'capitals', label: 'Столицы', description: 'Только столицы государств' },
    { id: 'capitals-popular', label: 'Столицы +', description: 'Столицы и популярные города' },
    { id: 'all', label: 'Все города', description: 'Полный набор городов' },
  ],
  music: [
    { id: 'easy', label: 'Лёгкий', description: 'Мировые и национальные звёзды' },
    { id: 'medium', label: 'Средний', description: 'Известные современные и классические артисты' },
    { id: 'hard', label: 'Сложный', description: 'Жанровые исполнители' },
    { id: 'expert', label: 'Эксперт', description: 'Редкие имена и необычные проекты' },
  ],
  diagnosis: [
    { id: 'all', label: 'Весь каталог', description: 'В основной игре нет отдельных режимов' },
  ],
  animal: [
    { id: 'all', label: 'Весь каталог', description: '300 животных основного набора' },
  ],
  book: [
    { id: 'all', label: 'Весь каталог', description: '277 известных книг разных эпох и жанров' },
  ],
  character: [
    { id: 'all', label: 'Весь каталог', description: '20 узнаваемых персонажей первого набора' },
  ],
} as const satisfies Record<Static<typeof PlayableCatalogGuessModeSchema>, readonly FriendsRoomPackVariant[]>

export const FRIENDS_ROOM_DEFAULT_PACK_VARIANTS = {
  movie: 'all',
  series: 'all',
  anime: 'all',
  game: 'all',
  city: 'capitals',
  music: 'medium',
  diagnosis: 'all',
  animal: 'all',
  book: 'all',
  character: 'all',
} as const satisfies Record<Static<typeof PlayableCatalogGuessModeSchema>, string>

export type FriendsRoomPackSelection = {
  mode: Static<typeof PlayableCatalogGuessModeSchema>
  variant: string
}

export const FriendsRoomPackSelectionSchema = Type.Object({
  mode: PlayableCatalogGuessModeSchema,
  variant: Type.String({ minLength: 1, maxLength: 40 }),
}, { additionalProperties: false })

export const FriendsRoomRoundsTotalSchema = Type.Integer({ minimum: 3, maximum: 30, multipleOf: 3 })
export const friendsRoomMinimumRounds = (packCount: number) => Math.max(3, Math.ceil(packCount / 3) * 3)

export const FriendsRoomCreateBodySchema = Type.Object({
  gameType: Type.Optional(Type.Union([Type.Literal('quiz'), Type.Literal('danetki')])),
  mode: Type.Optional(PlayableCatalogGuessModeSchema),
  packs: Type.Optional(Type.Array(FriendsRoomPackSelectionSchema, { minItems: 1, maxItems: PLAYABLE_CATALOG_GUESS_MODE_IDS.length })),
  roundsTotal: Type.Optional(FriendsRoomRoundsTotalSchema),
  shufflePacks: Type.Optional(Type.Boolean()),
  answerTimeSeconds: Type.Optional(Type.Union([Type.Literal(15), Type.Literal(20), Type.Literal(30), Type.Literal(45)])),
  danetkiLaunch: Type.Optional(Type.Object({
    kind: Type.Union([Type.Literal('daily'), Type.Literal('archive'), Type.Literal('free_play')]),
    puzzleDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  }, { additionalProperties: false })),
}, { additionalProperties: false })

export const FriendsRoomJoinBodySchema = Type.Object({
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
}, { additionalProperties: false })

export const FriendsRoomConfigBodySchema = Type.Partial(Type.Object({
  gameType: Type.Union([Type.Literal('quiz'), Type.Literal('danetki')]),
  mode: PlayableCatalogGuessModeSchema,
  packs: Type.Array(FriendsRoomPackSelectionSchema, { minItems: 1, maxItems: PLAYABLE_CATALOG_GUESS_MODE_IDS.length }),
  roundsTotal: FriendsRoomRoundsTotalSchema,
  shufflePacks: Type.Boolean(),
  answerTimeSeconds: Type.Union([Type.Literal(15), Type.Literal(20), Type.Literal(30), Type.Literal(45)]),
  danetkiLaunch: Type.Object({
    kind: Type.Union([Type.Literal('daily'), Type.Literal('archive'), Type.Literal('free_play')]),
    puzzleDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  }, { additionalProperties: false }),
}, { additionalProperties: false }), { minProperties: 1 })

export const FriendsRoomAnswerBodySchema = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 160 }),
  itemId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  idempotencyKey: Type.String({ minLength: 8, maxLength: 120 }),
}, { additionalProperties: false })

export const FriendsRoomMessageBodySchema = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 300 }),
  idempotencyKey: Type.String({ minLength: 8, maxLength: 120 }),
}, { additionalProperties: false })

export const FriendsRoomMutationBodySchema = Type.Object({
  idempotencyKey: Type.String({ minLength: 8, maxLength: 120 }),
}, { additionalProperties: false })

export type FriendsRoomCreateBody = Static<typeof FriendsRoomCreateBodySchema>
export type FriendsRoomJoinBody = Static<typeof FriendsRoomJoinBodySchema>
export type FriendsRoomConfigBody = Static<typeof FriendsRoomConfigBodySchema>
export type FriendsRoomAnswerBody = Static<typeof FriendsRoomAnswerBodySchema>
export type FriendsRoomMessageBody = Static<typeof FriendsRoomMessageBodySchema>

export type FriendsRoomMember = {
  userId: string
  role: 'owner' | 'player'
  displayName: string
  colorKey: string
  score: number
  answered: boolean
  joinedAt: string
  leftAt: string | null
  lastSeenAt: string
  connected: boolean
}

export type FriendsRoomAnswer = {
  userId: string
  displayName: string
  text: string
  correct: boolean
  points: number
  scoreBreakdown: FriendsRoomScorePart[]
  submittedAt: string
}

export type FriendsRoomScorePart = {
  key: string
  label: string
  status: 'exact' | 'match' | 'close' | 'partial'
  points: number
  maxPoints: number
}

export type FriendsRoomMessage = {
  id: string
  seq: number
  userId: string
  displayName: string
  colorKey: string
  text: string
  createdAt: string
}

export type FriendsRoomRound = {
  position: number
  mode: Static<typeof PlayableCatalogGuessModeSchema>
  variant: string
  prompt: string
  hints: string[]
  startedAt: string | null
  endsAt: string | null
  answer: string | null
  answerOriginal: string | null
  answerCard: PublicContentItem | null
}

export type FriendsRoomSnapshot = {
  id: string
  code: string
  gameType: FriendsRoomGameType
  danetkiSessionId: string | null
  danetkiLaunchCost: number
  danetkiLaunch: FriendsRoomDanetkiLaunch
  mode: Static<typeof PlayableCatalogGuessModeSchema>
  packs: FriendsRoomPackSelection[]
  capacity: number
  roundsTotal: number
  shufflePacks: boolean
  answerTimeSeconds: 15 | 20 | 30 | 45
  phase: FriendsRoomPhase
  rulesVersion: number
  currentRound: number
  version: number
  currentUserId: string
  isHost: boolean
  serverTime: string
  members: FriendsRoomMember[]
  round: FriendsRoomRound | null
  answers: FriendsRoomAnswer[]
  messages: FriendsRoomMessage[]
  continuation: {
    canContinue: boolean
    roundsAdded: 6
    nextRoundsTotal: number | null
    accessSource: 'free' | 'tickets' | 'club' | 'unavailable'
    cost: number
    balance: number | null
    shortage: number
    quote: EconomyQuote | null
  }
}

export type FriendsRoomResponse = { room: FriendsRoomSnapshot }
export type FriendsRoomSummary = {
  id: string
  code: string
  gameType: FriendsRoomGameType
  mode: Static<typeof PlayableCatalogGuessModeSchema>
  packs: FriendsRoomPackSelection[]
  players: number
  capacity: number
  phase: FriendsRoomPhase
  currentRound: number
  roundsTotal: number
  isHost: boolean
  joinedAt: string
  updatedAt: string
}
export type FriendsRoomListResponse = { rooms: FriendsRoomSummary[] }
export type FriendsRoomPreview = {
  code: string
  hostName: string
  gameType: FriendsRoomGameType
  danetkiLaunchCost: number
  mode: Static<typeof PlayableCatalogGuessModeSchema>
  packs: FriendsRoomPackSelection[]
  players: number
  capacity: number
  phase: FriendsRoomPhase
}
