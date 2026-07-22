import { Type, type Static } from '@sinclair/typebox'
import { PlayableModeSchema } from './schemas.js'
import type { PublicContentItem } from './api.js'

export type FriendsRoomPhase = 'lobby' | 'countdown' | 'active' | 'results' | 'finished'

export const FRIENDS_ROOM_CAPACITY = 8

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
} as const satisfies Record<Static<typeof PlayableModeSchema>, readonly FriendsRoomPackVariant[]>

export const FRIENDS_ROOM_DEFAULT_PACK_VARIANTS = {
  movie: 'all',
  series: 'all',
  anime: 'all',
  game: 'all',
  city: 'capitals',
  music: 'medium',
  diagnosis: 'all',
} as const satisfies Record<Static<typeof PlayableModeSchema>, string>

export type FriendsRoomPackSelection = {
  mode: Static<typeof PlayableModeSchema>
  variant: string
}

export const FriendsRoomPackSelectionSchema = Type.Object({
  mode: PlayableModeSchema,
  variant: Type.String({ minLength: 1, maxLength: 40 }),
}, { additionalProperties: false })

export const FriendsRoomCreateBodySchema = Type.Object({
  mode: Type.Optional(PlayableModeSchema),
  packs: Type.Optional(Type.Array(FriendsRoomPackSelectionSchema, { minItems: 1, maxItems: 7 })),
  roundsTotal: Type.Optional(Type.Union([Type.Literal(3), Type.Literal(5), Type.Literal(7)])),
  answerTimeSeconds: Type.Optional(Type.Union([Type.Literal(15), Type.Literal(20), Type.Literal(30), Type.Literal(45)])),
}, { additionalProperties: false })

export const FriendsRoomJoinBodySchema = Type.Object({
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
}, { additionalProperties: false })

export const FriendsRoomConfigBodySchema = Type.Partial(Type.Object({
  mode: PlayableModeSchema,
  packs: Type.Array(FriendsRoomPackSelectionSchema, { minItems: 1, maxItems: 7 }),
  roundsTotal: Type.Union([Type.Literal(3), Type.Literal(5), Type.Literal(7)]),
  answerTimeSeconds: Type.Union([Type.Literal(15), Type.Literal(20), Type.Literal(30), Type.Literal(45)]),
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
  mode: Static<typeof PlayableModeSchema>
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
  mode: Static<typeof PlayableModeSchema>
  packs: FriendsRoomPackSelection[]
  capacity: number
  roundsTotal: 3 | 5 | 7
  answerTimeSeconds: 15 | 20 | 30 | 45
  phase: FriendsRoomPhase
  currentRound: number
  version: number
  currentUserId: string
  isHost: boolean
  serverTime: string
  members: FriendsRoomMember[]
  round: FriendsRoomRound | null
  answers: FriendsRoomAnswer[]
  messages: FriendsRoomMessage[]
}

export type FriendsRoomResponse = { room: FriendsRoomSnapshot }
export type FriendsRoomPreview = {
  code: string
  hostName: string
  mode: Static<typeof PlayableModeSchema>
  packs: FriendsRoomPackSelection[]
  players: number
  capacity: number
  phase: FriendsRoomPhase
}
