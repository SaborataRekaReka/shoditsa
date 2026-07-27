import { createHash, randomBytes } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import type {
  FriendsRoomConfigBody,
  FriendsRoomCreateBody,
  FriendsRoomGameType,
  FriendsRoomPackSelection,
  FriendsRoomSnapshot,
  FriendsRoomSummary,
  DifficultyKey,
  PlayableMode,
  TitleItem,
} from '@shoditsa/contracts'
import {
  FRIENDS_ROOM_CAPACITY,
  FRIENDS_ROOM_DANETKI_CAPACITY,
  economyFriendsRoomCost,
  friendsRoomMinimumRounds,
} from '@shoditsa/contracts'
import { isExactTitleSearchMatch, musicDifficultyPool, normalize } from '@shoditsa/game-core'
import {
  contentItemVersions,
  contentRevisions,
  friendsRoomAnswers,
  friendsRoomDailyUsage,
  friendsRoomExtensions,
  friendsRoomMembers,
  friendsRoomMessages,
  friendsRoomRounds,
  friendsRooms,
  walletAccounts,
  walletLedger,
  type Database,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import { hasEntitlement } from '../commerce/entitlements.js'
import { loadAssignedEconomyRules, loadEconomyRulesByVersion } from '../economy/rules.js'
import { publicCard } from '../games/service.js'
import {
  getNextDanetkiRoomCost,
  leaveDanetkiSession,
  startDanetkiRoom,
  startDanetkiSession,
  syncDanetkiRoomMembers,
} from '../danetki/service.js'
import { buildFriendsRoomPackSchedule, defaultFriendsRoomPack, friendsRoomItemMatchesPack, normalizeFriendsRoomPacks } from './packs.js'
import { scoreFriendsRoomGuess } from './scoring.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type RoomRow = typeof friendsRooms.$inferSelect
type RequestUser = {
  id: string
  name: string
  role: 'player' | 'admin'
  authSessionId: string | null
  isAnonymous?: boolean
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COUNTDOWN_MS = 3_000
const roomCapacity = (gameType: FriendsRoomGameType) => gameType === 'danetki' ? FRIENDS_ROOM_DANETKI_CAPACITY : FRIENDS_ROOM_CAPACITY

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

export const normalizeFriendsRoomAnswer = normalize

export const isFriendsRoomAnswerCorrect = (value: string, item: TitleItem) =>
  isExactTitleSearchMatch(value, item)

const stableIndex = (value: string, length: number) => createHash('sha256').update(value).digest().readUInt32BE(0) % length
const colorFor = (userId: string) => `player-${stableIndex(userId, 12) + 1}`
const safeName = (value: string) => clean(value).slice(0, 40) || 'Игрок'
const roomCode = () => [...randomBytes(5)].map((byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join('')
const iso = (value: Date | null) => value?.toISOString() ?? null

export const assertFriendsRoomAccess = (config: AppConfig, isAnonymous: boolean) => {
  void config
  void isAnonymous
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

export const assertFriendsRoomCreator = (isAnonymous: boolean) => {
  if (isAnonymous) {
    throw new ApiError(403, 'FRIENDS_ROOM_ACCOUNT_REQUIRED', 'Создавать комнаты можно только с постоянного аккаунта')
  }
}

export const assertFriendsRoomClubAccess = (clubActive: boolean) => {
  if (!clubActive) {
    throw new ApiError(403, 'FRIENDS_ROOM_CLUB_REQUIRED', 'Создание комнат доступно с активным клубным билетом')
  }
}

const lockUserRoomMembership = async (tx: Transaction, userId: string) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)
}

const releaseClosedRoomMemberships = async (tx: Transaction, userId: string) => {
  const stale = await tx.select({ roomId: friendsRoomMembers.roomId })
    .from(friendsRoomMembers)
    .innerJoin(friendsRooms, eq(friendsRooms.id, friendsRoomMembers.roomId))
    .where(and(
      eq(friendsRoomMembers.userId, userId),
      isNull(friendsRoomMembers.leftAt),
      isNotNull(friendsRooms.closedAt),
    ))
  if (!stale.length) return

  const now = new Date()
  await tx.update(friendsRoomMembers).set({ leftAt: now, lastSeenAt: now }).where(and(
    eq(friendsRoomMembers.userId, userId),
    isNull(friendsRoomMembers.leftAt),
    inArray(friendsRoomMembers.roomId, stale.map((entry) => entry.roomId)),
  ))
}

const openRoomMembership = async (db: Pick<Database, 'select'>, userId: string) => {
  const rows = await db.select({
    roomId: friendsRoomMembers.roomId,
    code: friendsRooms.code,
  }).from(friendsRoomMembers)
    .innerJoin(friendsRooms, eq(friendsRooms.id, friendsRoomMembers.roomId))
    .where(and(
      eq(friendsRoomMembers.userId, userId),
      isNull(friendsRoomMembers.leftAt),
      isNull(friendsRooms.closedAt),
    ))
    .orderBy(desc(friendsRooms.updatedAt))
    .limit(1)
  return rows[0] ?? null
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

const lockedWallet = async (tx: Transaction, userId: string) => {
  await tx.insert(walletAccounts).values({ userId }).onConflictDoNothing()
  return (await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for('update').limit(1))[0]
}

const friendsRoomContinuationQuote = async (
  db: Database,
  room: RoomRow,
  isHost: boolean,
) => {
  const rules = await loadEconomyRulesByVersion(db, room.rulesVersion)
  const clubActive = await hasEntitlement(db, room.ownerUserId, 'club', undefined, new Date())
  const date = getMoscowDate()
  const usage = (await db.select().from(friendsRoomDailyUsage).where(and(
    eq(friendsRoomDailyUsage.userId, room.ownerUserId),
    eq(friendsRoomDailyUsage.activityDate, date),
  )).limit(1))[0]
  const wallet = (await db.select({ balance: walletAccounts.balance }).from(walletAccounts)
    .where(eq(walletAccounts.userId, room.ownerUserId)).limit(1))[0]
  const cost = clubActive ? 0 : (usage?.freeBlocks ?? 0) < rules.friendsRoom.freeBlocksPerDay
    ? 0
    : economyFriendsRoomCost(usage?.paidBlocks ?? 0, rules)
  const accessSource = clubActive ? 'club' as const : cost === 0 ? 'free' as const : 'tickets' as const
  const balance = wallet?.balance ?? 0
  const available = room.currentRound < rules.friendsRoom.maxRoundsPerRoom
  const nextRoundsTotal = room.currentRound < room.roundsTotal
    ? room.roundsTotal
    : Math.min(rules.friendsRoom.maxRoundsPerRoom, room.roundsTotal + rules.friendsRoom.roundsPerBlock)
  return {
    canContinue: isHost && room.phase === 'intermission' && room.currentRound < rules.friendsRoom.maxRoundsPerRoom,
    roundsAdded: rules.friendsRoom.roundsPerBlock as 6,
    nextRoundsTotal: room.currentRound < rules.friendsRoom.maxRoundsPerRoom ? nextRoundsTotal : null,
    accessSource: room.currentRound < rules.friendsRoom.maxRoundsPerRoom ? accessSource : 'unavailable' as const,
    cost,
    balance,
    shortage: Math.max(0, cost - balance),
    quote: available ? {
      sink: 'friends-room-block' as const,
      allowed: isHost && room.phase === 'intermission' && (cost === 0 || balance >= cost),
      accessSource,
      cost,
      balance,
      shortage: Math.max(0, cost - balance),
      paidUsesToday: usage?.paidBlocks ?? 0,
      rulesVersion: rules.version,
    } : null,
  }
}

const chargeFriendsRoomBlock = async (
  tx: Transaction,
  room: RoomRow,
  idempotencyKey: string,
  blockNumber: number,
  roundsAdded: number,
) => {
  const existing = (await tx.select().from(friendsRoomExtensions).where(and(
    eq(friendsRoomExtensions.roomId, room.id),
    eq(friendsRoomExtensions.blockNumber, blockNumber),
  )).limit(1))[0]
  if (existing) return existing

  const rules = await loadEconomyRulesByVersion(tx, room.rulesVersion)
  const date = getMoscowDate()
  await tx.insert(friendsRoomDailyUsage).values({
    userId: room.ownerUserId,
    activityDate: date,
  }).onConflictDoNothing()
  const usage = (await tx.select().from(friendsRoomDailyUsage).where(and(
    eq(friendsRoomDailyUsage.userId, room.ownerUserId),
    eq(friendsRoomDailyUsage.activityDate, date),
  )).for('update').limit(1))[0]
  const clubActive = await hasEntitlement(tx, room.ownerUserId, 'club', undefined, new Date())
  const free = !clubActive && usage.freeBlocks < rules.friendsRoom.freeBlocksPerDay
  const cost = clubActive ? 0 : free ? 0 : economyFriendsRoomCost(usage.paidBlocks, rules)
  const wallet = await lockedWallet(tx, room.ownerUserId)
  if (wallet.balance < cost) {
    throw new ApiError(409, 'INSUFFICIENT_TICKETS', 'Недостаточно билетов', {
      required: cost,
      balance: wallet.balance,
      shortage: cost - wallet.balance,
      sink: 'friends-room',
      blockNumber,
      rulesVersion: rules.version,
    })
  }
  const balanceAfter = wallet.balance - cost
  const ledger = cost > 0
    ? await tx.insert(walletLedger).values({
        userId: room.ownerUserId,
        operationKey: `friends-room:${room.id}:block:${blockNumber}`,
        type: 'spend',
        reason: 'friends-room',
        amount: -cost,
        balanceAfter,
        rulesVersion: rules.version,
        metadata: { roomId: room.id, blockNumber, roundsAdded, sink: 'friends-room', rulesVersion: rules.version },
      }).returning({ id: walletLedger.id })
    : []
  if (cost > 0) {
    await tx.update(walletAccounts).set({
      balance: balanceAfter,
      version: sql`${walletAccounts.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(walletAccounts.userId, room.ownerUserId))
  }
  await tx.update(friendsRoomDailyUsage).set(clubActive
    ? { clubBlocks: usage.clubBlocks + 1 }
    : free
      ? { freeBlocks: usage.freeBlocks + 1 }
      : { paidBlocks: usage.paidBlocks + 1 })
    .where(and(
      eq(friendsRoomDailyUsage.userId, room.ownerUserId),
      eq(friendsRoomDailyUsage.activityDate, date),
    ))
  return (await tx.insert(friendsRoomExtensions).values({
    roomId: room.id,
    ownerUserId: room.ownerUserId,
    blockNumber,
    roundsAdded,
    accessSource: clubActive ? 'club' : free ? 'free' : 'tickets',
    cost,
    ledgerId: ledger[0]?.id ?? null,
    idempotencyKey,
    rulesVersion: rules.version,
  }).returning())[0]
}

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

const buildSnapshot = async (db: Database, roomId: string, currentUserId: string): Promise<FriendsRoomSnapshot> => {
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
  const [members, answerRows, messageRows, content, danetkiLaunchCost] = await Promise.all([
    db.select().from(friendsRoomMembers).where(eq(friendsRoomMembers.roomId, roomId)).orderBy(asc(friendsRoomMembers.joinedAt)),
    round ? db.select().from(friendsRoomAnswers).where(eq(friendsRoomAnswers.roundId, round.id)).orderBy(asc(friendsRoomAnswers.submittedAt)) : Promise.resolve([]),
    db.select().from(friendsRoomMessages).where(eq(friendsRoomMessages.roomId, roomId)).orderBy(desc(friendsRoomMessages.seq)).limit(100),
    round ? db.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, round.contentItemVersionId)).limit(1) : Promise.resolve([]),
    room.gameType === 'danetki' && room.danetkiLaunch.kind !== 'daily'
      ? getNextDanetkiRoomCost(db, room.ownerUserId, 'group')
      : Promise.resolve(0),
  ])
  const memberById = new Map(members.map((entry) => [entry.userId, entry]))
  const answered = new Set(answerRows.map((entry) => entry.userId))
  const reveal = room.phase === 'results' || room.phase === 'intermission' || room.phase === 'finished'
  const item = content[0]?.payload as TitleItem | undefined
  const packs = roomPacks(room)
  const continuation = await friendsRoomContinuationQuote(db, room, membership.role === 'owner')
  return {
    id: room.id,
    code: room.code,
    gameType: room.gameType as FriendsRoomGameType,
    danetkiSessionId: room.danetkiSessionId,
    danetkiLaunchCost,
    danetkiLaunch: room.danetkiLaunch,
    mode: room.mode as PlayableMode,
    packs,
    capacity: roomCapacity(room.gameType as FriendsRoomGameType),
    roundsTotal: room.roundsTotal,
    shufflePacks: room.shufflePacks,
    answerTimeSeconds: room.answerTimeSeconds as 15 | 20 | 30 | 45,
    phase: room.phase,
    rulesVersion: room.rulesVersion,
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
    continuation,
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
  if (room.phase !== 'results' && room.phase !== 'intermission' && room.phase !== 'finished') {
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
    gameType: room.gameType as FriendsRoomGameType,
    danetkiLaunchCost: room.gameType === 'danetki' && room.danetkiLaunch.kind !== 'daily'
      ? await getNextDanetkiRoomCost(db, room.ownerUserId, 'group')
      : 0,
    mode: room.mode as PlayableMode,
    packs: roomPacks(room),
    players: members.length,
    capacity: roomCapacity(room.gameType as FriendsRoomGameType),
    phase: room.phase,
  }
}

export const listFriendsRooms = async (db: Database, userId: string): Promise<FriendsRoomSummary[]> => {
  const entries = await db.select({
    room: friendsRooms,
    role: friendsRoomMembers.role,
    joinedAt: friendsRoomMembers.joinedAt,
  }).from(friendsRoomMembers)
    .innerJoin(friendsRooms, eq(friendsRooms.id, friendsRoomMembers.roomId))
    .where(and(
      eq(friendsRoomMembers.userId, userId),
      isNull(friendsRoomMembers.leftAt),
      isNull(friendsRooms.closedAt),
    ))
    .orderBy(desc(friendsRooms.updatedAt))
    .limit(1)

  if (!entries.length) return []
  const counts = await db.select({ roomId: friendsRoomMembers.roomId })
    .from(friendsRoomMembers)
    .where(and(
      inArray(friendsRoomMembers.roomId, entries.map((entry) => entry.room.id)),
      isNull(friendsRoomMembers.leftAt),
    ))
  const playerCounts = new Map<string, number>()
  for (const entry of counts) playerCounts.set(entry.roomId, (playerCounts.get(entry.roomId) ?? 0) + 1)

  return entries.map(({ room, role, joinedAt }) => ({
    id: room.id,
    code: room.code,
    gameType: room.gameType as FriendsRoomGameType,
    mode: room.mode as PlayableMode,
    packs: roomPacks(room),
    players: playerCounts.get(room.id) ?? 0,
    capacity: roomCapacity(room.gameType as FriendsRoomGameType),
    phase: room.phase,
    currentRound: room.currentRound,
    roundsTotal: room.roundsTotal,
    isHost: role === 'owner',
    joinedAt: joinedAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  }))
}

export const createFriendsRoom = async (
  db: Database,
  user: RequestUser,
  input: FriendsRoomCreateBody = {},
  config: AppConfig,
) => {
  assertFriendsRoomCreator(Boolean(user.isAnonymous))
  const revisionId = await activeRevisionId(db)
  const rules = await loadAssignedEconomyRules(db, user.id, user.role, config.economy.v4RolloutPercent)
  const clubActive = await hasEntitlement(db, user.id, 'club', undefined, new Date())
  assertFriendsRoomClubAccess(clubActive)
  const gameType = input.gameType ?? 'quiz'
  const packs = normalizeFriendsRoomPacks(input.packs, input.mode ?? 'series')
  const mode = packs[0].mode
  const roundsTotal = clubActive
    ? input.roundsTotal ?? Math.max(6, friendsRoomMinimumRounds(packs.length))
    : rules.friendsRoom.roundsPerBlock
  if (roundsTotal < packs.length) throw new ApiError(422, 'FRIENDS_ROOM_ROUNDS_TOO_FEW', 'На каждый выбранный пак нужен хотя бы один раунд')
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = roomCode()
    const roomId = await db.transaction(async (tx) => {
      await lockUserRoomMembership(tx, user.id)
      await releaseClosedRoomMemberships(tx, user.id)
      const existing = await openRoomMembership(tx, user.id)
      if (existing) return existing.roomId
      const inserted = await tx.insert(friendsRooms).values({
        code,
        ownerUserId: user.id,
        revisionId,
        mode,
        gameType,
        danetkiLaunch: input.danetkiLaunch ?? { kind: 'daily' },
        packs,
        roundsTotal,
        shufflePacks: input.shufflePacks ?? false,
        answerTimeSeconds: input.answerTimeSeconds ?? 30,
        rulesVersion: rules.version,
      }).onConflictDoNothing().returning()
      if (!inserted[0]) return null
      await tx.insert(friendsRoomMembers).values({ roomId: inserted[0].id, userId: user.id, role: 'owner', displayNameSnapshot: safeName(user.name), colorKey: colorFor(user.id) })
      return inserted[0].id
    })
    if (roomId) return buildSnapshot(db, roomId, user.id)
  }
  throw new ApiError(503, 'FRIENDS_ROOM_CODE_UNAVAILABLE', 'Не удалось подобрать код комнаты')
}

export const joinFriendsRoom = async (db: Database, user: RequestUser, code: string, displayName?: string) => {
  const roomId = await db.transaction(async (tx) => {
    await lockUserRoomMembership(tx, user.id)
    await releaseClosedRoomMemberships(tx, user.id)
    const room = (await tx.select().from(friendsRooms).where(eq(friendsRooms.code, code.trim().toUpperCase())).for('update').limit(1))[0]
    if (!room || room.closedAt) throw new ApiError(404, 'FRIENDS_ROOM_NOT_FOUND', 'Комната не найдена')
    const currentRoom = await openRoomMembership(tx, user.id)
    if (currentRoom && currentRoom.roomId !== room.id) {
      throw new ApiError(409, 'FRIENDS_ROOM_ALREADY_OPEN', 'Сначала покиньте текущую комнату', {
        roomId: currentRoom.roomId,
        roomCode: currentRoom.code,
      })
    }
    const existing = await tx.select().from(friendsRoomMembers).where(and(eq(friendsRoomMembers.roomId, room.id), eq(friendsRoomMembers.userId, user.id))).limit(1)
    if (room.phase !== 'lobby') {
      if (existing[0] && !existing[0].leftAt) {
        await tx.update(friendsRoomMembers).set({ lastSeenAt: new Date() }).where(and(eq(friendsRoomMembers.roomId, room.id), eq(friendsRoomMembers.userId, user.id)))
        return room.id
      }
      throw new ApiError(409, 'FRIENDS_ROOM_ALREADY_STARTED', 'Игра в этой комнате уже началась')
    }
    const members = await tx.select().from(friendsRoomMembers).where(and(eq(friendsRoomMembers.roomId, room.id), isNull(friendsRoomMembers.leftAt)))
    if (!existing[0] && members.length >= roomCapacity(room.gameType as FriendsRoomGameType)) throw new ApiError(409, 'FRIENDS_ROOM_FULL', room.gameType === 'danetki' ? 'В комнате уже четыре игрока' : 'В комнате уже восемь игроков')
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
    const { gameType: requestedGameType, packs: requestedPacks, mode: requestedMode, ...rules } = input
    const gameType = requestedGameType ?? room.gameType as FriendsRoomGameType
    if (gameType === 'danetki') {
      const members = await tx.select({ userId: friendsRoomMembers.userId }).from(friendsRoomMembers).where(and(
        eq(friendsRoomMembers.roomId, roomId),
        isNull(friendsRoomMembers.leftAt),
      ))
      if (members.length > FRIENDS_ROOM_DANETKI_CAPACITY) {
        throw new ApiError(409, 'FRIENDS_ROOM_DANETKI_TOO_MANY_PLAYERS', 'Для Данетки в комнате должно быть не больше четырёх игроков')
      }
    }
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
      ...(requestedGameType ? { gameType: requestedGameType, danetkiSessionId: null } : {}),
      ...(packs ? { packs, mode: packs[0].mode } : {}),
      version: sql`${friendsRooms.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(friendsRooms.id, roomId))
  })
  return buildSnapshot(db, roomId, userId)
}

export const startFriendsRoom = async (
  db: Database,
  user: RequestUser,
  roomId: string,
  idempotencyKey: string,
  config: AppConfig,
) => {
  const roomBeforeStart = await db.transaction((tx) => hostRoom(tx, roomId, user.id))
  const clubActiveAtStart = await hasEntitlement(db, roomBeforeStart.ownerUserId, 'club', undefined, new Date())
  assertFriendsRoomClubAccess(clubActiveAtStart)
  if (roomBeforeStart.phase !== 'lobby') {
    const replay = await db.select({ id: friendsRoomExtensions.id }).from(friendsRoomExtensions).where(and(
      eq(friendsRoomExtensions.roomId, roomId),
      eq(friendsRoomExtensions.ownerUserId, user.id),
      eq(friendsRoomExtensions.idempotencyKey, idempotencyKey),
    )).limit(1)
    if (replay[0]) return buildSnapshot(db, roomId, user.id)
    if (roomBeforeStart.gameType === 'danetki' && roomBeforeStart.danetkiSessionId) {
      return buildSnapshot(db, roomId, user.id)
    }
    throw new ApiError(409, 'FRIENDS_ROOM_ALREADY_STARTED', 'Игра уже запущена')
  }

  if (roomBeforeStart.gameType === 'danetki') {
    const members = await db.select().from(friendsRoomMembers).where(and(
      eq(friendsRoomMembers.roomId, roomId),
      isNull(friendsRoomMembers.leftAt),
    )).orderBy(asc(friendsRoomMembers.joinedAt), asc(friendsRoomMembers.userId))
    if (!members.length) throw new ApiError(409, 'FRIENDS_ROOM_EMPTY', 'В комнате нет игроков')
    if (members.length > FRIENDS_ROOM_DANETKI_CAPACITY) {
      throw new ApiError(409, 'FRIENDS_ROOM_DANETKI_TOO_MANY_PLAYERS', 'Для Данетки в комнате должно быть не больше четырёх игроков')
    }

    const session = await startDanetkiSession(db, user, {
      kind: roomBeforeStart.danetkiLaunch.kind,
      roomMode: 'group',
      ...(roomBeforeStart.danetkiLaunch.puzzleDate ? { archiveDate: roomBeforeStart.danetkiLaunch.puzzleDate } : {}),
      idempotencyKey,
    }, config)
    await syncDanetkiRoomMembers(db, session.id, members.map((member) => ({
      userId: member.userId,
      role: member.userId === roomBeforeStart.ownerUserId ? 'owner' as const : 'player' as const,
      displayName: member.displayNameSnapshot,
      colorKey: member.colorKey,
    })))
    await startDanetkiRoom(db, user.id, session.id)

    await db.transaction(async (tx) => {
      const room = await hostRoom(tx, roomId, user.id)
      if (room.phase !== 'lobby' && room.danetkiSessionId !== session.id) {
        throw new ApiError(409, 'FRIENDS_ROOM_ALREADY_STARTED', 'Игра уже запущена')
      }
      if (room.gameType !== 'danetki') {
        throw new ApiError(409, 'FRIENDS_ROOM_MODE_CHANGED', 'Режим комнаты изменился во время запуска')
      }
      const now = new Date()
      await tx.update(friendsRooms).set({
        danetkiSessionId: session.id,
        phase: 'active',
        phaseStartedAt: now,
        phaseEndsAt: null,
        version: sql`${friendsRooms.version} + 1`,
        updatedAt: now,
      }).where(eq(friendsRooms.id, roomId))
    })
    return buildSnapshot(db, roomId, user.id)
  }

  await db.transaction(async (tx) => {
    const room = await hostRoom(tx, roomId, user.id)
    if (room.phase !== 'lobby') {
      const replay = await tx.select({ id: friendsRoomExtensions.id }).from(friendsRoomExtensions).where(and(
        eq(friendsRoomExtensions.roomId, roomId),
        eq(friendsRoomExtensions.ownerUserId, user.id),
        eq(friendsRoomExtensions.idempotencyKey, idempotencyKey),
      )).limit(1)
      if (replay[0]) return
      throw new ApiError(409, 'FRIENDS_ROOM_ALREADY_STARTED', 'Игра уже запущена')
    }
    const rules = await loadEconomyRulesByVersion(tx, room.rulesVersion)
    const clubActive = await hasEntitlement(tx, room.ownerUserId, 'club', undefined, new Date())
    const roundsTotal = clubActive ? room.roundsTotal : rules.friendsRoom.roundsPerBlock
    const roomForStart = roundsTotal === room.roundsTotal ? room : { ...room, roundsTotal }
    await createRound(tx, roomForStart, 1)
    await chargeFriendsRoomBlock(tx, roomForStart, idempotencyKey, 1, Math.min(roundsTotal, rules.friendsRoom.roundsPerBlock))
    const now = new Date()
    await tx.update(friendsRoomMembers).set({ score: 0 }).where(eq(friendsRoomMembers.roomId, roomId))
    await tx.update(friendsRooms).set({ roundsTotal, phase: 'countdown', currentRound: 1, phaseStartedAt: now, phaseEndsAt: new Date(now.getTime() + COUNTDOWN_MS), version: sql`${friendsRooms.version} + 1`, updatedAt: now }).where(eq(friendsRooms.id, roomId))
  })
  return buildSnapshot(db, roomId, user.id)
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
    const guessedRow = itemId
      ? candidates.find((entry) => entry.itemId === itemId)
      : candidates.find((entry) => {
          const candidate = entry.payload as TitleItem
          return isExactTitleSearchMatch(answerText, candidate)
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
    const rules = await loadEconomyRulesByVersion(tx, room.rulesVersion)
    if (
      room.currentRound > 0
      && room.currentRound % rules.friendsRoom.roundsPerBlock === 0
      && room.currentRound < rules.friendsRoom.maxRoundsPerRoom
    ) {
      await tx.update(friendsRooms).set({ phase: 'intermission', phaseStartedAt: now, phaseEndsAt: null, version: sql`${friendsRooms.version} + 1`, updatedAt: now }).where(eq(friendsRooms.id, roomId))
      return
    }
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

export const continueFriendsRoom = async (
  db: Database,
  userId: string,
  roomId: string,
  idempotencyKey: string,
) => {
  const replay = await db.select({ id: friendsRoomExtensions.id }).from(friendsRoomExtensions).where(and(
    eq(friendsRoomExtensions.roomId, roomId),
    eq(friendsRoomExtensions.ownerUserId, userId),
    eq(friendsRoomExtensions.idempotencyKey, idempotencyKey),
  )).limit(1)
  if (replay[0]) return buildSnapshot(db, roomId, userId)

  await db.transaction(async (tx) => {
    const room = await hostRoom(tx, roomId, userId)
    if (room.phase !== 'intermission') {
      const replay = await tx.select({ id: friendsRoomExtensions.id }).from(friendsRoomExtensions).where(and(
        eq(friendsRoomExtensions.roomId, roomId),
        eq(friendsRoomExtensions.ownerUserId, userId),
        eq(friendsRoomExtensions.idempotencyKey, idempotencyKey),
      )).limit(1)
      if (replay[0]) return
      throw new ApiError(409, 'FRIENDS_ROOM_INTERMISSION_REQUIRED', 'Продолжить игру можно только в перерыве')
    }
    const rules = await loadEconomyRulesByVersion(tx, room.rulesVersion)
    if (room.currentRound >= rules.friendsRoom.maxRoundsPerRoom) {
      throw new ApiError(409, 'FRIENDS_ROOM_ROUND_LIMIT', 'В одной комнате доступно не больше 30 раундов')
    }
    const nextRoundsTotal = room.currentRound < room.roundsTotal
      ? room.roundsTotal
      : Math.min(rules.friendsRoom.maxRoundsPerRoom, room.roundsTotal + rules.friendsRoom.roundsPerBlock)
    const roundsAdded = Math.min(rules.friendsRoom.roundsPerBlock, nextRoundsTotal - room.currentRound)
    const position = room.currentRound + 1
    const roomForNext = { ...room, roundsTotal: nextRoundsTotal }
    await createRound(tx, roomForNext, position)
    await chargeFriendsRoomBlock(
      tx,
      roomForNext,
      idempotencyKey,
      Math.floor(room.currentRound / rules.friendsRoom.roundsPerBlock) + 1,
      roundsAdded,
    )
    const now = new Date()
    await tx.update(friendsRooms).set({
      roundsTotal: nextRoundsTotal,
      phase: 'countdown',
      currentRound: position,
      phaseStartedAt: now,
      phaseEndsAt: new Date(now.getTime() + COUNTDOWN_MS),
      version: sql`${friendsRooms.version} + 1`,
      updatedAt: now,
    }).where(eq(friendsRooms.id, roomId))
  })
  return buildSnapshot(db, roomId, userId)
}

export const restartFriendsRoom = async (
  db: Database,
  user: RequestUser,
  roomId: string,
  config: AppConfig,
) => {
  const previous = await db.transaction(async (tx) => {
    const room = await hostRoom(tx, roomId, user.id)
    if (room.phase !== 'finished') throw new ApiError(409, 'FRIENDS_ROOM_NOT_FINISHED', 'Текущая игра ещё не завершена')
    const now = new Date()
    await tx.update(friendsRoomMembers).set({ leftAt: now, lastSeenAt: now }).where(and(
      eq(friendsRoomMembers.roomId, roomId),
      isNull(friendsRoomMembers.leftAt),
    ))
    await tx.update(friendsRooms).set({
      closedAt: now,
      version: sql`${friendsRooms.version} + 1`,
      updatedAt: now,
    }).where(eq(friendsRooms.id, roomId))
    return room
  })
  return createFriendsRoom(db, user, {
    gameType: previous.gameType as FriendsRoomGameType,
    packs: roomPacks(previous),
    roundsTotal: previous.roundsTotal,
    shufflePacks: previous.shufflePacks,
    answerTimeSeconds: previous.answerTimeSeconds as 15 | 20 | 30 | 45,
    danetkiLaunch: previous.danetkiLaunch,
  }, config)
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
  const roomBeforeLeave = (await db.select({
    gameType: friendsRooms.gameType,
    danetkiSessionId: friendsRooms.danetkiSessionId,
    ownerUserId: friendsRooms.ownerUserId,
  }).from(friendsRooms).where(eq(friendsRooms.id, roomId)).limit(1))[0]
  if (roomBeforeLeave?.gameType === 'danetki' && roomBeforeLeave.danetkiSessionId && roomBeforeLeave.ownerUserId !== userId) {
    await leaveDanetkiSession(db, userId, roomBeforeLeave.danetkiSessionId)
  }

  await db.transaction(async (tx) => {
    const room = (await tx.select().from(friendsRooms).where(eq(friendsRooms.id, roomId)).for('update').limit(1))[0]
    if (!room) return
    const member = (await tx.select().from(friendsRoomMembers).where(and(
      eq(friendsRoomMembers.roomId, roomId),
      eq(friendsRoomMembers.userId, userId),
    )).for('update').limit(1))[0]
    if (!member || member.leftAt) return
    const now = new Date()
    await tx.update(friendsRoomMembers).set({ leftAt: now, lastSeenAt: now }).where(and(eq(friendsRoomMembers.roomId, roomId), eq(friendsRoomMembers.userId, userId)))
    const remaining = await tx.select({ userId: friendsRoomMembers.userId }).from(friendsRoomMembers).where(and(
      eq(friendsRoomMembers.roomId, roomId),
      isNull(friendsRoomMembers.leftAt),
    )).orderBy(asc(friendsRoomMembers.joinedAt), asc(friendsRoomMembers.userId))
    const roomIsFinished = room.phase === 'finished'
    const shouldClose = remaining.length === 0 || (member.role === 'owner' && !roomIsFinished)
    if (shouldClose && remaining.length > 0) {
      await tx.update(friendsRoomMembers).set({ leftAt: now, lastSeenAt: now }).where(and(
        eq(friendsRoomMembers.roomId, roomId),
        isNull(friendsRoomMembers.leftAt),
      ))
    }
    await tx.update(friendsRooms).set(shouldClose
      ? { phase: 'finished', closedAt: now, phaseEndsAt: null, version: sql`${friendsRooms.version} + 1`, updatedAt: now }
      : { version: sql`${friendsRooms.version} + 1`, updatedAt: now }).where(eq(friendsRooms.id, roomId))
  })
  return { left: true }
}
