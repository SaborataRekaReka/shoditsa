import { createHash, randomBytes } from 'node:crypto'
import { and, asc, desc, eq, isNull, notInArray, sql } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import type {
  FriendsRoomConfigBody,
  FriendsRoomCreateBody,
  FriendsRoomPackSelection,
  FriendsRoomSnapshot,
  DifficultyKey,
  PlayableMode,
  TitleItem,
} from '@shoditsa/contracts'
import { FRIENDS_ROOM_CAPACITY, friendsRoomMinimumRounds } from '@shoditsa/contracts'
import { musicDifficultyPool } from '@shoditsa/game-core'
import {
  contentItemVersions,
  contentRevisions,
  friendsRoomAnswers,
  friendsRoomMembers,
  friendsRoomMessages,
  friendsRoomRounds,
  friendsRooms,
  type Database,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { publicCard } from '../games/service.js'
import { buildFriendsRoomPackSchedule, defaultFriendsRoomPack, friendsRoomItemMatchesPack, normalizeFriendsRoomPacks } from './packs.js'
import { scoreFriendsRoomGuess } from './scoring.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReadDatabase = Pick<Database, 'select' | 'update'>
type RoomRow = typeof friendsRooms.$inferSelect
type RequestUser = { id: string; name: string; role: 'player' | 'admin' }

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COUNTDOWN_MS = 3_000

const modePrompt: Record<PlayableMode, string> = {
  movie: 'Какой фильм соответствует этим подсказкам?',
  series: 'Какой сериал соответствует этим подсказкам?',
  anime: 'Какое аниме соответствует этим подсказкам?',
  game: 'Какая игра соответствует этим подсказкам?',
  city: 'Какой город соответствует этим подсказкам?',
  music: 'Какой исполнитель соответствует этим подсказкам?',
  diagnosis: 'Какой диагноз соответствует этим признакам?',
}

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const first = (value: unknown) => Array.isArray(value) ? value.map(clean).filter(Boolean)[0] ?? '' : ''
const list = (value: unknown, limit = 2) => Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, limit).join(', ') : ''
const hint = (label: string, value: unknown) => clean(value) ? `${label}: ${clean(value)}` : ''

export const buildFriendsRoomHints = (item: TitleItem): string[] => {
  const candidates = item.mode === 'game'
    ? [hint('Год', item.year), hint('Жанры', list(item.genres)), hint('Разработчик', first(item.developers)), hint('Платформы', list(item.platforms, 3))]
    : item.mode === 'city'
      ? [hint('Страна', item.country), hint('Континент', item.continent), hint('Языки', list(item.languages, 3)), item.population ? `Население: ${new Intl.NumberFormat('ru-RU').format(item.population)}` : '']
      : item.mode === 'music'
        ? [hint('Начало карьеры', item.activityStartYear), hint('Страны', list(item.countries)), hint('Жанры', list(item.genres, 3)), hint('Известный трек', item.topTracks?.[0]?.title)]
        : item.mode === 'diagnosis'
          ? [hint('Системы организма', list(item.bodySystems, 2)), hint('Симптомы', list(item.keySymptoms, 3)), hint('Диагностика', first(item.diagnostics)), hint('Группа МКБ', item.icdGroup)]
          : item.mode === 'anime'
            ? [hint('Год', item.year), hint('Формат', item.animeKind), hint('Студия', first(item.studios)), hint('Жанры', list(item.genres, 3))]
            : [hint('Год', item.year), hint('Страны', list(item.countries)), hint('Жанры', list(item.genres, 3)), hint(item.mode === 'series' ? 'Шоураннер' : 'Режиссёр', first(item.mode === 'series' ? item.showrunners?.map((person) => person.nameRu || person.nameOriginal) : item.directors?.map((person) => person.nameRu || person.nameOriginal)))]
  const result = candidates.filter(Boolean).slice(0, 4)
  if (result.length < 3 && clean(item.plotHint)) result.push(clean(item.plotHint).slice(0, 180))
  return result.length ? result : ['Подсказки появятся после обновления контента']
}

export const normalizeFriendsRoomAnswer = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

export const isFriendsRoomAnswerCorrect = (value: string, item: TitleItem) => {
  const normalized = normalizeFriendsRoomAnswer(value)
  if (!normalized) return false
  return [item.titleRu, item.titleOriginal, ...(item.alternativeTitles ?? []), ...(item.aliases ?? [])]
    .map(normalizeFriendsRoomAnswer)
    .some((candidate) => candidate === normalized)
}

const stableIndex = (value: string, length: number) => createHash('sha256').update(value).digest().readUInt32BE(0) % length
const colorFor = (userId: string) => `player-${stableIndex(userId, 12) + 1}`
const safeName = (value: string) => clean(value).slice(0, 40) || 'Игрок'
const roomCode = () => [...randomBytes(5)].map((byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join('')
const iso = (value: Date | null) => value?.toISOString() ?? null

export const assertFriendsRoomAccess = (config: AppConfig, isAnonymous: boolean) => {
  if (config.production && isAnonymous && !config.friendsRoomPreview) {
    throw new ApiError(403, 'FRIENDS_ROOM_ACCOUNT_REQUIRED', 'Сначала зарегистрируйтесь, чтобы играть с друзьями')
  }
}

const activeRevisionId = async (db: Pick<Database, 'select'>) => {
  const rows = await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!rows[0]) throw new ApiError(503, 'CONTENT_NOT_READY', 'Активная ревизия контента не настроена')
  return rows[0].id
}

const activeMember = async (db: Pick<Database, 'select'>, roomId: string, userId: string) => {
  const rows = await db.select().from(friendsRoomMembers).where(and(
    eq(friendsRoomMembers.roomId, roomId), eq(friendsRoomMembers.userId, userId), isNull(friendsRoomMembers.leftAt),
  )).limit(1)
  if (!rows[0]) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
  return rows[0]
}

const hostRoom = async (tx: Transaction, roomId: string, userId: string) => {
  const rows = await tx.select().from(friendsRooms).where(eq(friendsRooms.id, roomId)).for('update').limit(1)
  const room = rows[0]
  if (!room) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
  const member = await activeMember(tx, roomId, userId)
  if (member.role !== 'owner') throw new ApiError(403, 'FRIENDS_ROOM_HOST_REQUIRED', 'Действие доступно только ведущему комнаты')
  return room
}

const roomPacks = (room: RoomRow) => normalizeFriendsRoomPacks(
  Array.isArray(room.packs) ? room.packs as FriendsRoomPackSelection[] : null,
  room.mode as PlayableMode,
)

const createRound = async (tx: Transaction, room: RoomRow, position: number) => {
  const packs = roomPacks(room)
  const pack = buildFriendsRoomPackSchedule(packs, room.roundsTotal, room.id, room.shufflePacks)[position - 1]
  if (!pack) throw new ApiError(500, 'FRIENDS_ROOM_PACK_SCHEDULE_INVALID', 'Не удалось распределить игровые паки')
  const used = await tx.select({ id: friendsRoomRounds.contentItemVersionId }).from(friendsRoomRounds).where(eq(friendsRoomRounds.roomId, room.id))
  const filters = [
    eq(contentItemVersions.revisionId, room.revisionId),
    eq(contentItemVersions.mode, pack.mode),
    eq(contentItemVersions.allowedInGame, true),
    ...(used.length ? [notInArray(contentItemVersions.id, used.map((entry) => entry.id))] : []),
  ]
  const matchingCandidates = (await tx.select({ id: contentItemVersions.id, payload: contentItemVersions.payload })
    .from(contentItemVersions).where(and(...filters)).orderBy(sql`random()`))
    .filter((entry) => friendsRoomItemMatchesPack(entry.payload as TitleItem, pack))
  const musicIds = pack.mode === 'music'
    ? new Set(musicDifficultyPool(
        matchingCandidates.map((entry) => entry.payload as TitleItem),
        pack.variant as DifficultyKey,
      ).map((entry) => entry.id))
    : null
  const candidates = musicIds
    ? matchingCandidates.filter((entry) => musicIds.has((entry.payload as TitleItem).id))
    : matchingCandidates
  const selected = candidates[0]
  if (!selected) throw new ApiError(503, 'FRIENDS_ROOM_CONTENT_EMPTY', 'Для выбранного режима пака недостаточно карточек')
  const item = selected.payload as TitleItem
  if (!item || item.mode !== pack.mode || !clean(item.titleRu)) throw new ApiError(500, 'FRIENDS_ROOM_CONTENT_INVALID', 'Карточка раунда повреждена')
  const inserted = await tx.insert(friendsRoomRounds).values({
    roomId: room.id,
    position,
    contentItemVersionId: selected.id,
    packVariant: pack.variant,
    prompt: modePrompt[pack.mode],
    hints: buildFriendsRoomHints(item),
  }).returning()
  return inserted[0]
}

const advanceRoomClock = async (db: Database, roomId: string) => db.transaction(async (tx) => {
  const room = (await tx.select().from(friendsRooms).where(eq(friendsRooms.id, roomId)).for('update').limit(1))[0]
  if (!room || room.closedAt) return
  const now = new Date()
  if (room.phase === 'countdown' && room.phaseEndsAt && room.phaseEndsAt <= now) {
    const endsAt = new Date(now.getTime() + room.answerTimeSeconds * 1_000)
    await tx.update(friendsRooms).set({
      phase: 'active', phaseStartedAt: now, phaseEndsAt: endsAt, version: sql`${friendsRooms.version} + 1`, updatedAt: now,
    }).where(eq(friendsRooms.id, room.id))
    await tx.update(friendsRoomRounds).set({ startedAt: now }).where(and(eq(friendsRoomRounds.roomId, room.id), eq(friendsRoomRounds.position, room.currentRound)))
    return
  }
  if (room.phase !== 'active') return
  const currentRound = (await tx.select({ id: friendsRoomRounds.id }).from(friendsRoomRounds).where(and(
    eq(friendsRoomRounds.roomId, room.id), eq(friendsRoomRounds.position, room.currentRound),
  )).limit(1))[0]
  if (!currentRound) return
  const [members, answers] = await Promise.all([
    tx.select({ userId: friendsRoomMembers.userId }).from(friendsRoomMembers).where(and(eq(friendsRoomMembers.roomId, room.id), isNull(friendsRoomMembers.leftAt))),
    tx.select({ userId: friendsRoomAnswers.userId }).from(friendsRoomAnswers).where(eq(friendsRoomAnswers.roundId, currentRound.id)),
  ])
  if ((room.phaseEndsAt && room.phaseEndsAt <= now) || (members.length > 0 && answers.length >= members.length)) {
    await tx.update(friendsRooms).set({ phase: 'results', phaseEndsAt: null, version: sql`${friendsRooms.version} + 1`, updatedAt: now }).where(eq(friendsRooms.id, room.id))
    await tx.update(friendsRoomRounds).set({ revealedAt: now }).where(eq(friendsRoomRounds.id, currentRound.id))
  }
})

const buildSnapshot = async (db: ReadDatabase, roomId: string, currentUserId: string): Promise<FriendsRoomSnapshot> => {
  const room = (await db.select().from(friendsRooms).where(eq(friendsRooms.id, roomId)).limit(1))[0]
  if (!room) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
  const membership = await activeMember(db, roomId, currentUserId)
  await db.update(friendsRoomMembers).set({ lastSeenAt: new Date() }).where(and(
    eq(friendsRoomMembers.roomId, roomId), eq(friendsRoomMembers.userId, currentUserId),
    sql`${friendsRoomMembers.lastSeenAt} < now() - interval '20 seconds'`,
  ))
  const round = room.currentRound > 0
    ? (await db.select().from(friendsRoomRounds).where(and(eq(friendsRoomRounds.roomId, roomId), eq(friendsRoomRounds.position, room.currentRound))).limit(1))[0] ?? null
    : null
  const [members, answerRows, messageRows, content] = await Promise.all([
    db.select().from(friendsRoomMembers).where(eq(friendsRoomMembers.roomId, roomId)).orderBy(asc(friendsRoomMembers.joinedAt)),
    round ? db.select().from(friendsRoomAnswers).where(eq(friendsRoomAnswers.roundId, round.id)).orderBy(asc(friendsRoomAnswers.submittedAt)) : Promise.resolve([]),
    db.select().from(friendsRoomMessages).where(eq(friendsRoomMessages.roomId, roomId)).orderBy(desc(friendsRoomMessages.seq)).limit(100),
    round ? db.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, round.contentItemVersionId)).limit(1) : Promise.resolve([]),
  ])
  const memberById = new Map(members.map((entry) => [entry.userId, entry]))
  const answered = new Set(answerRows.map((entry) => entry.userId))
  const reveal = room.phase === 'results' || room.phase === 'finished'
  const item = content[0]?.payload as TitleItem | undefined
  const packs = roomPacks(room)
  return {
    id: room.id,
    code: room.code,
    mode: room.mode as PlayableMode,
    packs,
    capacity: FRIENDS_ROOM_CAPACITY,
    roundsTotal: room.roundsTotal,
    shufflePacks: room.shufflePacks,
    answerTimeSeconds: room.answerTimeSeconds as 15 | 20 | 30 | 45,
    phase: room.phase,
    currentRound: room.currentRound,
    version: room.version,
    currentUserId,
    isHost: membership.role === 'owner',
    serverTime: new Date().toISOString(),
    members: members.map((entry) => ({
      userId: entry.userId,
      role: entry.role,
      displayName: entry.displayNameSnapshot,
      colorKey: entry.colorKey,
      score: entry.score,
      answered: answered.has(entry.userId),
      joinedAt: entry.joinedAt.toISOString(),
      leftAt: iso(entry.leftAt),
      lastSeenAt: entry.lastSeenAt.toISOString(),
    })),
    round: round ? {
      position: round.position,
      mode: item?.mode ?? packs[0].mode,
      variant: round.packVariant,
      prompt: round.prompt,
      hints: Array.isArray(round.hints) ? round.hints.filter((entry): entry is string => typeof entry === 'string') : [],
      startedAt: iso(round.startedAt),
      endsAt: room.phase === 'active' || room.phase === 'countdown' ? iso(room.phaseEndsAt) : null,
      answer: reveal ? item?.titleRu ?? null : null,
      answerOriginal: reveal ? clean(item?.titleOriginal) || null : null,
      answerCard: reveal && item ? {
        ...publicCard(item),
        posterUrl: item.posterUrl || item.headerUrl || item.backdropUrl
          ? `/api/v1/friends/rooms/${room.id}/answer-image`
          : null,
      } : null,
    } : null,
    answers: reveal ? answerRows.map((entry) => ({
      userId: entry.userId,
      displayName: memberById.get(entry.userId)?.displayNameSnapshot ?? 'Игрок',
      text: entry.text,
      correct: entry.isCorrect,
      points: entry.points,
      scoreBreakdown: Array.isArray(entry.scoreBreakdown) ? entry.scoreBreakdown : [],
      submittedAt: entry.submittedAt.toISOString(),
    })) : [],
    messages: [...messageRows].reverse().map((entry) => ({
      id: entry.id,
      seq: entry.seq,
      userId: entry.userId,
      displayName: memberById.get(entry.userId)?.displayNameSnapshot ?? 'Игрок',
      colorKey: memberById.get(entry.userId)?.colorKey ?? 'player-1',
      text: entry.text,
      createdAt: entry.createdAt.toISOString(),
    })),
  }
}

export const getFriendsRoom = async (db: Database, roomId: string, userId: string) => {
  await advanceRoomClock(db, roomId)
  return buildSnapshot(db, roomId, userId)
}

export const getFriendsRoomAnswerMediaSource = async (db: Database, roomId: string, userId: string) => {
  await activeMember(db, roomId, userId)
  const room = (await db.select().from(friendsRooms).where(eq(friendsRooms.id, roomId)).limit(1))[0]
  if (!room) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
  if (room.phase !== 'results' && room.phase !== 'finished') {
    throw new ApiError(409, 'FRIENDS_ROOM_ANSWER_HIDDEN', 'Изображение ответа откроется после завершения раунда')
  }
  const round = (await db.select().from(friendsRoomRounds).where(and(
    eq(friendsRoomRounds.roomId, roomId), eq(friendsRoomRounds.position, room.currentRound),
  )).limit(1))[0]
  if (!round) throw new ApiError(404, 'FRIENDS_ROOM_ROUND_NOT_FOUND', 'Раунд не найден')
  const content = (await db.select({ payload: contentItemVersions.payload }).from(contentItemVersions)
    .where(eq(contentItemVersions.id, round.contentItemVersionId)).limit(1))[0]
  const item = content?.payload as TitleItem | undefined
  const source = clean(item?.posterUrl) || clean(item?.headerUrl) || clean(item?.backdropUrl)
  if (!source) throw new ApiError(404, 'FRIENDS_ROOM_ANSWER_IMAGE_NOT_FOUND', 'Для ответа нет изображения')
  return source
}

export const previewFriendsRoom = async (db: Database, code: string) => {
  const room = (await db.select().from(friendsRooms).where(eq(friendsRooms.code, code.trim().toUpperCase())).limit(1))[0]
  if (!room || room.closedAt) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
  const members = await db.select().from(friendsRoomMembers).where(and(eq(friendsRoomMembers.roomId, room.id), isNull(friendsRoomMembers.leftAt)))
  const owner = members.find((entry) => entry.role === 'owner')
  return {
    code: room.code,
    hostName: owner?.displayNameSnapshot ?? 'Ведущий',
    mode: room.mode as PlayableMode,
    packs: roomPacks(room),
    players: members.length,
    capacity: FRIENDS_ROOM_CAPACITY,
    phase: room.phase,
  }
}

export const createFriendsRoom = async (db: Database, user: RequestUser, input: FriendsRoomCreateBody = {}) => {
  const revisionId = await activeRevisionId(db)
  const packs = normalizeFriendsRoomPacks(input.packs, input.mode ?? 'series')
  const mode = packs[0].mode
  const roundsTotal = input.roundsTotal ?? Math.max(6, friendsRoomMinimumRounds(packs.length))
  if (roundsTotal < packs.length) throw new ApiError(422, 'FRIENDS_ROOM_ROUNDS_TOO_FEW', 'На каждый выбранный пак нужен хотя бы один раунд')
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = roomCode()
    const room = await db.transaction(async (tx) => {
      const inserted = await tx.insert(friendsRooms).values({
        code, ownerUserId: user.id, revisionId, mode, packs, roundsTotal, shufflePacks: input.shufflePacks ?? false, answerTimeSeconds: input.answerTimeSeconds ?? 30,
      }).onConflictDoNothing().returning()
      if (!inserted[0]) return null
      await tx.insert(friendsRoomMembers).values({ roomId: inserted[0].id, userId: user.id, role: 'owner', displayNameSnapshot: safeName(user.name), colorKey: colorFor(user.id) })
      return inserted[0]
    })
    if (room) return buildSnapshot(db, room.id, user.id)
  }
  throw new ApiError(503, 'FRIENDS_ROOM_CODE_UNAVAILABLE', 'Не удалось подобрать код комнаты')
}

export const joinFriendsRoom = async (db: Database, user: RequestUser, code: string, displayName?: string) => {
  const roomId = await db.transaction(async (tx) => {
    const room = (await tx.select().from(friendsRooms).where(eq(friendsRooms.code, code.trim().toUpperCase())).for('update').limit(1))[0]
    if (!room || room.closedAt) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
    const existing = await tx.select().from(friendsRoomMembers).where(and(eq(friendsRoomMembers.roomId, room.id), eq(friendsRoomMembers.userId, user.id))).limit(1)
    if (room.phase !== 'lobby') {
      if (existing[0] && !existing[0].leftAt) {
        await tx.update(friendsRoomMembers).set({ lastSeenAt: new Date() }).where(and(eq(friendsRoomMembers.roomId, room.id), eq(friendsRoomMembers.userId, user.id)))
        return room.id
      }
      throw new ApiError(409, 'FRIENDS_ROOM_ALREADY_STARTED', 'Игра в этой комнате уже началась')
    }
    const members = await tx.select().from(friendsRoomMembers).where(and(eq(friendsRoomMembers.roomId, room.id), isNull(friendsRoomMembers.leftAt)))
    if (!existing[0] && members.length >= FRIENDS_ROOM_CAPACITY) throw new ApiError(409, 'FRIENDS_ROOM_FULL', 'В комнате уже восемь игроков')
    await tx.insert(friendsRoomMembers).values({
      roomId: room.id, userId: user.id, role: user.id === room.ownerUserId ? 'owner' : 'player', displayNameSnapshot: safeName(displayName ?? user.name), colorKey: colorFor(user.id),
    }).onConflictDoUpdate({ target: [friendsRoomMembers.roomId, friendsRoomMembers.userId], set: { displayNameSnapshot: safeName(displayName ?? user.name), leftAt: null, lastSeenAt: new Date() } })
    await tx.update(friendsRooms).set({ version: sql`${friendsRooms.version} + 1`, updatedAt: new Date() }).where(eq(friendsRooms.id, room.id))
    return room.id
  })
  return buildSnapshot(db, roomId, user.id)
}

export const configureFriendsRoom = async (db: Database, userId: string, roomId: string, input: FriendsRoomConfigBody) => {
  await db.transaction(async (tx) => {
    const room = await hostRoom(tx, roomId, userId)
    if (room.phase !== 'lobby') throw new ApiError(409, 'FRIENDS_ROOM_ALREADY_STARTED', 'Настройки нельзя менять после запуска')
    const { packs: requestedPacks, mode: requestedMode, ...rules } = input
    const packs = requestedPacks
      ? normalizeFriendsRoomPacks(requestedPacks, room.mode as PlayableMode)
      : requestedMode
        ? [defaultFriendsRoomPack(requestedMode)]
        : null
    const nextPacks = packs ?? roomPacks(room)
    const nextRoundsTotal = rules.roundsTotal ?? room.roundsTotal
    if (nextRoundsTotal < nextPacks.length) throw new ApiError(422, 'FRIENDS_ROOM_ROUNDS_TOO_FEW', 'На каждый выбранный пак нужен хотя бы один раунд')
    await tx.update(friendsRooms).set({
      ...rules,
      ...(packs ? { packs, mode: packs[0].mode } : {}),
      version: sql`${friendsRooms.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(friendsRooms.id, roomId))
  })
  return buildSnapshot(db, roomId, userId)
}

export const startFriendsRoom = async (db: Database, userId: string, roomId: string) => {
  await db.transaction(async (tx) => {
    const room = await hostRoom(tx, roomId, userId)
    if (room.phase !== 'lobby') throw new ApiError(409, 'FRIENDS_ROOM_ALREADY_STARTED', 'Игра уже запущена')
    await createRound(tx, room, 1)
    const now = new Date()
    await tx.update(friendsRoomMembers).set({ score: 0 }).where(eq(friendsRoomMembers.roomId, roomId))
    await tx.update(friendsRooms).set({ phase: 'countdown', currentRound: 1, phaseStartedAt: now, phaseEndsAt: new Date(now.getTime() + COUNTDOWN_MS), version: sql`${friendsRooms.version} + 1`, updatedAt: now }).where(eq(friendsRooms.id, roomId))
  })
  return buildSnapshot(db, roomId, userId)
}

export const submitFriendsRoomAnswer = async (
  db: Database,
  userId: string,
  roomId: string,
  text: string,
  idempotencyKey: string,
  itemId?: string,
) => {
  const answerText = clean(text)
  if (!answerText) throw new ApiError(400, 'FRIENDS_ROOM_ANSWER_REQUIRED', 'Введите ответ')
  await advanceRoomClock(db, roomId)
  await db.transaction(async (tx) => {
    const room = (await tx.select().from(friendsRooms).where(eq(friendsRooms.id, roomId)).for('update').limit(1))[0]
    if (!room) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
    await activeMember(tx, roomId, userId)
    const replay = await tx.select().from(friendsRoomAnswers).where(and(eq(friendsRoomAnswers.roomId, roomId), eq(friendsRoomAnswers.userId, userId), eq(friendsRoomAnswers.idempotencyKey, idempotencyKey))).limit(1)
    if (replay[0]) return
    if (room.phase !== 'active') throw new ApiError(409, 'FRIENDS_ROOM_NOT_ACCEPTING_ANSWERS', 'Раунд сейчас не принимает ответы')
    const round = (await tx.select().from(friendsRoomRounds).where(and(eq(friendsRoomRounds.roomId, roomId), eq(friendsRoomRounds.position, room.currentRound))).limit(1))[0]
    if (!round) throw new ApiError(500, 'FRIENDS_ROOM_ROUND_INVALID', 'Раунд не найден')
    const content = (await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, round.contentItemVersionId)).limit(1))[0]
    const item = content?.payload as TitleItem | undefined
    if (!item) throw new ApiError(500, 'FRIENDS_ROOM_CONTENT_INVALID', 'Карточка раунда повреждена')
    const candidates = await tx.select({ itemId: contentItemVersions.itemId, payload: contentItemVersions.payload })
      .from(contentItemVersions)
      .where(and(
        eq(contentItemVersions.revisionId, room.revisionId),
        eq(contentItemVersions.mode, item.mode),
        eq(contentItemVersions.allowedInGame, true),
      ))
    const normalizedAnswer = normalizeFriendsRoomAnswer(answerText)
    const guessedRow = itemId
      ? candidates.find((entry) => entry.itemId === itemId)
      : candidates.find((entry) => {
          const candidate = entry.payload as TitleItem
          return [candidate.titleRu, candidate.titleOriginal, ...(candidate.alternativeTitles ?? []), ...(candidate.aliases ?? [])]
            .map(normalizeFriendsRoomAnswer)
            .includes(normalizedAnswer)
        })
    const elapsedSeconds = Math.max(0, (Date.now() - (room.phaseStartedAt?.getTime() ?? Date.now())) / 1_000)
    const scoring = scoreFriendsRoomGuess({
      answer: item,
      guess: guessedRow ? guessedRow.payload as TitleItem : null,
      elapsedSeconds,
      answerTimeSeconds: room.answerTimeSeconds,
    })
    const inserted = await tx.insert(friendsRoomAnswers).values({
      roomId,
      roundId: round.id,
      userId,
      text: answerText,
      isCorrect: scoring.correct,
      points: scoring.points,
      scoreBreakdown: scoring.breakdown,
      idempotencyKey,
    }).onConflictDoNothing().returning()
    if (inserted[0]) {
      await tx.update(friendsRoomMembers).set({ score: sql`${friendsRoomMembers.score} + ${scoring.points}` }).where(and(eq(friendsRoomMembers.roomId, roomId), eq(friendsRoomMembers.userId, userId)))
      await tx.update(friendsRooms).set({ version: sql`${friendsRooms.version} + 1`, updatedAt: new Date() }).where(eq(friendsRooms.id, roomId))
    }
  })
  await advanceRoomClock(db, roomId)
  return buildSnapshot(db, roomId, userId)
}

export const revealFriendsRoomResults = async (db: Database, userId: string, roomId: string) => {
  await advanceRoomClock(db, roomId)
  await db.transaction(async (tx) => {
    const room = await hostRoom(tx, roomId, userId)
    if (room.phase !== 'active') throw new ApiError(409, 'FRIENDS_ROOM_ROUND_NOT_ACTIVE', 'Раунд уже завершён')
    const now = new Date()
    await tx.update(friendsRooms).set({ phase: 'results', phaseEndsAt: null, version: sql`${friendsRooms.version} + 1`, updatedAt: now }).where(eq(friendsRooms.id, roomId))
    await tx.update(friendsRoomRounds).set({ revealedAt: now }).where(and(eq(friendsRoomRounds.roomId, roomId), eq(friendsRoomRounds.position, room.currentRound)))
  })
  return buildSnapshot(db, roomId, userId)
}

export const nextFriendsRoomRound = async (db: Database, userId: string, roomId: string) => {
  await db.transaction(async (tx) => {
    const room = await hostRoom(tx, roomId, userId)
    if (room.phase !== 'results') throw new ApiError(409, 'FRIENDS_ROOM_RESULTS_REQUIRED', 'Сначала завершите текущий раунд')
    const now = new Date()
    if (room.currentRound >= room.roundsTotal) {
      await tx.update(friendsRooms).set({ phase: 'finished', phaseStartedAt: now, phaseEndsAt: null, version: sql`${friendsRooms.version} + 1`, updatedAt: now }).where(eq(friendsRooms.id, roomId))
      return
    }
    const position = room.currentRound + 1
    await createRound(tx, room, position)
    await tx.update(friendsRooms).set({ phase: 'countdown', currentRound: position, phaseStartedAt: now, phaseEndsAt: new Date(now.getTime() + COUNTDOWN_MS), version: sql`${friendsRooms.version} + 1`, updatedAt: now }).where(eq(friendsRooms.id, roomId))
  })
  return buildSnapshot(db, roomId, userId)
}

export const restartFriendsRoom = async (db: Database, userId: string, roomId: string) => {
  await db.transaction(async (tx) => {
    const room = await hostRoom(tx, roomId, userId)
    if (room.phase !== 'finished') throw new ApiError(409, 'FRIENDS_ROOM_NOT_FINISHED', 'Текущая игра ещё не завершена')
    await tx.delete(friendsRoomAnswers).where(eq(friendsRoomAnswers.roomId, roomId))
    await tx.delete(friendsRoomRounds).where(eq(friendsRoomRounds.roomId, roomId))
    await tx.update(friendsRoomMembers).set({ score: 0 }).where(eq(friendsRoomMembers.roomId, roomId))
    await tx.update(friendsRooms).set({
      phase: 'lobby', currentRound: 0, phaseStartedAt: null, phaseEndsAt: null, version: sql`${friendsRooms.version} + 1`, updatedAt: new Date(),
    }).where(eq(friendsRooms.id, roomId))
  })
  return buildSnapshot(db, roomId, userId)
}

export const sendFriendsRoomMessage = async (db: Database, userId: string, roomId: string, text: string, idempotencyKey: string) => {
  const messageText = clean(text)
  if (!messageText) throw new ApiError(400, 'FRIENDS_ROOM_MESSAGE_REQUIRED', 'Введите сообщение')
  await db.transaction(async (tx) => {
    const room = (await tx.select().from(friendsRooms).where(eq(friendsRooms.id, roomId)).for('update').limit(1))[0]
    if (!room || room.closedAt) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
    await activeMember(tx, roomId, userId)
    const replay = await tx.select().from(friendsRoomMessages).where(and(eq(friendsRoomMessages.roomId, roomId), eq(friendsRoomMessages.userId, userId), eq(friendsRoomMessages.idempotencyKey, idempotencyKey))).limit(1)
    if (replay[0]) return
    const inserted = await tx.insert(friendsRoomMessages).values({ roomId, seq: room.nextMessageSeq, userId, text: messageText, idempotencyKey }).onConflictDoNothing().returning()
    if (inserted[0]) await tx.update(friendsRooms).set({ nextMessageSeq: room.nextMessageSeq + 1, version: sql`${friendsRooms.version} + 1`, updatedAt: new Date() }).where(eq(friendsRooms.id, roomId))
  })
  return buildSnapshot(db, roomId, userId)
}

export const leaveFriendsRoom = async (db: Database, userId: string, roomId: string) => {
  await db.transaction(async (tx) => {
    const room = (await tx.select().from(friendsRooms).where(eq(friendsRooms.id, roomId)).for('update').limit(1))[0]
    if (!room) return
    const member = await activeMember(tx, roomId, userId)
    const now = new Date()
    await tx.update(friendsRoomMembers).set({ leftAt: now, lastSeenAt: now }).where(and(eq(friendsRoomMembers.roomId, roomId), eq(friendsRoomMembers.userId, userId)))
    await tx.update(friendsRooms).set(member.role === 'owner'
      ? { phase: 'finished', closedAt: now, phaseEndsAt: null, version: sql`${friendsRooms.version} + 1`, updatedAt: now }
      : { version: sql`${friendsRooms.version} + 1`, updatedAt: now }).where(eq(friendsRooms.id, roomId))
  })
  return { left: true }
}
