import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SVOYAK_AVATARS, type ActiveQuestion, type AvatarId, type Command, type Member, type MixPlan, type Preferences, type RoomSettings, type RoomView } from '@shoditsa/contracts/svoyak'
import type { QuestionBank } from './bank.js'
import { buildMix, normalized, questionIdentity, type SelectedTheme } from './mix.js'

type PrivateMember = Member & { tokenHash: string; userId?: string }
type AnswerEvent = { id: string; questionId: string; contentHash: string; memberId: string | null; correct: boolean | null; elapsedMs: number; at: number }
export type StoredRoom = {
  testRun?: boolean; code: string; revision: number; createdAt: number; stage: RoomView['stage']; hostId: string; settings: RoomSettings
  members: PrivateMember[]; plan: MixPlan | null; themes: SelectedTheme[]; playedIds: string[]; seenIds: string[]; seenAnswers: string[]; current: ActiveQuestion | null
  chooserId: string | null; completed: boolean; handled: string[]; hostRevealed: boolean
  mixError?: { message: string; retryAt?: number }
  answers: AnswerEvent[]; pastResults: { id: string; endedAt: number; completed: boolean; scores: { memberId: string; name: string; score: number }[]; answers: AnswerEvent[]; libraryRevision: string }[]
}
export interface RoomRepository {
  get(code: string): StoredRoom | null | Promise<StoredRoom | null>
  save(room: StoredRoom, expectedRevision: number | null): void | Promise<void>
}
export class RoomError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}
const fail = (code: string, message: string, status = 400): never => { throw new RoomError(code, message, status) }
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const cleanMember = ({ tokenHash: _, userId: _userId, ...member }: PrivateMember): Member => ({ ...member, preferences: { topics: member.preferences.topics } })
export const defaultSettings: RoomSettings = { rounds: 1, themesPerRound: 3, secondsPerQuestion: 30, age: 18 }
function name(value: unknown) {
  if (typeof value !== 'string') return fail('INVALID_NAME', 'Напишите своё имя.')
  const result = value.trim().replace(/\s+/g, ' ')
  if (!result || result.length > 24 || /[\p{Cc}\p{Cf}]/u.test(result)) return fail('INVALID_NAME', 'Имя должно содержать от 1 до 24 символов.')
  return result
}
function avatar(value: unknown): AvatarId {
  if (!SVOYAK_AVATARS.some(x => x.id === value)) return fail('INVALID_AVATAR', 'Выберите аватар.')
  return value as AvatarId
}
function settings(value: RoomSettings): RoomSettings {
  if (!value || !Number.isInteger(value.rounds) || value.rounds < 1 || value.rounds > 3
    || !Number.isInteger(value.themesPerRound) || value.themesPerRound < 1 || value.themesPerRound > 6
    || ![15, 30, 45, 60].includes(value.secondsPerQuestion) || ![16, 18].includes(value.age)) {
    return fail('INVALID_SETTINGS', 'Проверьте число раундов, тем и время ответа.')
  }
  return { rounds: value.rounds, themesPerRound: value.themesPerRound, secondsPerQuestion: value.secondsPerQuestion, age: value.age }
}
function preferences(value: Preferences): Preferences {
  if (!value || !Array.isArray(value.topics) || value.topics.length > 20 || !value.topics.every(t => typeof t === 'string' && /^[a-z-]{1,40}$/.test(t))) {
    return fail('INVALID_PREFERENCES', 'Не удалось сохранить интересы. Выберите их из списка.')
  }
  return { topics: [...new Set(value.topics)] }
}

export class RoomService {
  private jobs = new Map<string, { key: string; timer?: ReturnType<typeof setTimeout> }>()
  private disposed = false
  constructor(private repo: RoomRepository, private bank: QuestionBank, private now = Date.now) {}
  dispose() { this.disposed = true; for (const job of this.jobs.values()) clearTimeout(job.timer); this.jobs.clear() }
  private mixKey(room: StoredRoom) {
    return JSON.stringify([room.settings, room.members.map(m => [m.id, m.role, [...m.preferences.topics].sort()]), room.seenIds, room.seenAnswers])
  }
  private cancelMix(code: string) { clearTimeout(this.jobs.get(code)?.timer); this.jobs.delete(code) }
  private async makeMix(room: StoredRoom) {
    const bank = await this.bank.load()
    const participants = room.members.filter(m => m.role === 'player' || m.preferences.topics.length > 0)
    const allTopics = new Set(bank.catalog.topics.map(t => t.id))
    if (participants.some(m => m.preferences.topics.some(t => !allTopics.has(t)))) return fail('CATALOG_CHANGED', 'Обновите список тем.')
    try {
      return buildMix({ ...bank, questions: bank.questions.filter(q => !(room.seenIds ?? []).includes(questionIdentity(q.id)) && ![q.answer, ...q.aliases].some(a => (room.seenAnswers ?? []).includes(normalized(a)))) }, participants, room.settings, randomUUID())
    } catch (error) { return fail('INSUFFICIENT_QUESTIONS', error instanceof Error ? error.message : 'Недостаточно вопросов.', 409) }
  }
  /** Coalesce votes on the server; only the latest selection may publish a plan. */
  private scheduleMix(room: StoredRoom) {
    if (this.disposed) return
    if (room.stage !== 'lobby' || room.plan || room.members.filter(m => m.role === 'player').length < 2) { this.cancelMix(room.code); return }
    if (room.mixError && (!room.mixError.retryAt || room.mixError.retryAt > this.now())) return
    const key = this.mixKey(room)
    if (this.jobs.get(room.code)?.key === key) return
    this.cancelMix(room.code)
    const job: { key: string; timer?: ReturnType<typeof setTimeout> } = { key }
    this.jobs.set(room.code, job)
    job.timer = setTimeout(() => { void (async () => {
      try {
        const mix = await this.makeMix(room)
        if (this.disposed || this.jobs.get(room.code) !== job) return
        const latest = await this.repo.get(room.code)
        if (this.disposed || this.jobs.get(room.code) !== job) return
        if (!latest || latest.stage !== 'lobby' || latest.plan || this.mixKey(latest) !== key) return
        // Ready/profile updates do not invalidate the input, and must survive the async build.
        mix.plan.coverage.forEach(p => { p.name = latest.members.find(m => m.id === p.playerId)?.name ?? p.name })
        latest.plan = mix.plan; latest.themes = mix.themes; delete latest.mixError
        await this.commit(latest)
      } catch (error) {
        if (this.disposed || this.jobs.get(room.code) !== job) return
        const latest = await this.repo.get(room.code)
        if (this.disposed || this.jobs.get(room.code) !== job) return
        if (!latest || latest.stage !== 'lobby' || this.mixKey(latest) !== key) return
        if (error instanceof RoomError && error.code === 'ROOM_CHANGED') return
        latest.mixError = error instanceof RoomError
          ? { message: error.message }
          : { message: 'База временно недоступна. Повторяем подбор…', retryAt: this.now() + 10_000 }
        await this.commit(latest)
      } finally { if (this.jobs.get(room.code) === job) this.jobs.delete(room.code) }
    })().catch(() => { /* Failed persistence leaves the room unchanged; its next poll retries. */ }) }, 350)
    job.timer.unref?.()
  }
  async catalog() { return (await this.bank.load()).catalog }
  async create(input: { name: string; avatar: AvatarId; settings: RoomSettings }, userId?: string, testRun = false) {
    const token = randomBytes(32).toString('base64url'), id = randomUUID()
    let code = ''
    do { code = randomBytes(5).toString('hex').slice(0, 6).toUpperCase() } while (await this.repo.get(code))
    const room: StoredRoom = { testRun, code, revision: 1, createdAt: this.now(), stage: 'lobby', hostId: id, settings: settings(input.settings),
      members: [{ id, name: name(input.name), avatar: avatar(input.avatar), role: 'host', tokenHash: hash(token), userId, ready: true, preferences: { topics: [] }, score: 0 }],
      plan: null, themes: [], playedIds: [], seenIds: [], seenAnswers: [], current: null, chooserId: null, completed: false, handled: [], hostRevealed: false, answers: [], pastResults: [],
    }
    await this.repo.save(room, null)
    return { credentials: { code, token, memberId: id }, room: this.view(room, token, userId) }
  }
  async join(code: string, input: { name: string; avatar: AvatarId }, userId?: string) {
    const room = await this.load(code)
    if (room.stage !== 'lobby') return fail('ROOM_STARTED', room.stage === 'closed' ? 'Комната закрыта.' : 'Игра уже началась. Вернуться могут участники с сохранённым входом.', 409)
    if (room.members.length >= 13) return fail('ROOM_FULL', 'В комнате уже 12 игроков.', 409)
    const displayName = name(input.name)
    if (room.members.some(m => normalized(m.name) === normalized(displayName))) return fail('NAME_TAKEN', 'Такое имя уже занято. Добавьте пару букв.')
    const token = randomBytes(32).toString('base64url'), id = randomUUID()
    room.members.push({ id, tokenHash: hash(token), userId, name: displayName, avatar: avatar(input.avatar), role: 'player', ready: false, preferences: { topics: [] }, score: 0 })
    room.plan = null; room.themes = []; delete room.mixError
    await this.commit(room); this.scheduleMix(room)
    return { credentials: { code: room.code, token, memberId: id }, room: this.view(room, token, userId) }
  }
  async get(code: string, token?: string, userId?: string) { const room = await this.load(code); if (token) this.actor(room, token, userId); this.scheduleMix(room); return this.view(room, token, userId) }
  private async load(code: string) {
    if (!/^[A-F0-9]{6}$/.test(code)) return fail('ROOM_NOT_FOUND', 'Комната не найдена. Проверьте код приглашения.', 404)
    const room = await this.repo.get(code)
    if (!room) return fail('ROOM_NOT_FOUND', 'Комната не найдена. Проверьте код приглашения.', 404)
    // Old pack-filtered plans cannot start under the new topic-only selection rules.
    if (room.stage === 'lobby' && room.plan && room.plan.algorithm !== 'topics-v2') {
      room.plan = null; room.themes = []; await this.commit(room)
    }
    if (room.current?.phase === 'reading' && room.current.deadline !== null && room.current.deadline <= this.now()) {
      room.current.phase = 'timeout'; room.current.remainingMs = 0; room.current.deadline = null
      await this.commit(room)
    }
    return room
  }
  private async commit(room: StoredRoom) { const revision = room.revision; room.revision++; await this.repo.save(room, revision) }
  private finish(room: StoredRoom) {
    room.stage = 'result'; room.completed = room.playedIds.length === room.themes.length * 5
    room.pastResults ??= []
    room.pastResults.push({ id: randomUUID(), endedAt: this.now(), completed: room.completed,
      scores: room.members.filter(m => m.role === 'player').map(m => ({ memberId: m.id, name: m.name, score: m.score })),
      answers: structuredClone(room.answers ?? []), libraryRevision: room.plan!.libraryRevision })
  }
  private actor(room: StoredRoom, token: string, userId?: string) {
    const member = room.members.find(m => m.tokenHash === hash(token) && (!m.userId || m.userId === userId))
    return member ?? fail('UNAUTHORIZED', 'Войдите в комнату по приглашению.', 401)
  }
  async command(code: string, token: string, command: Command, commandId: string, userId?: string): Promise<RoomView> {
    if (typeof commandId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(commandId)) return fail('COMMAND_ID_REQUIRED', 'Повторите действие.')
    if (!command || typeof command !== 'object' || typeof command.type !== 'string') return fail('INVALID_COMMAND', 'Некорректное действие.')
    let room = await this.load(code), actor = this.actor(room, token, userId)
    if (room.handled.includes(commandId)) return this.view(room, token, userId)
    if (room.stage === 'closed') return fail('ROOM_CLOSED', 'Ведущий закрыл комнату.', 409)
    const host = () => actor.id === room.hostId || fail('HOST_ONLY', 'Это действие доступно ведущему.', 403)
    const lobby = () => room.stage === 'lobby' || fail('LOBBY_ONLY', 'Настройки зафиксированы после начала игры.', 409)
    const playing = () => room.stage === 'playing' || fail('GAME_NOT_RUNNING', 'Игра сейчас не идёт.', 409)
    const invalidate = () => { room.plan = null; room.themes = []; delete room.mixError; this.cancelMix(code) }
    const updatePreferences = (value: Preferences) => {
      const next = preferences(value)
      if (JSON.stringify([...next.topics].sort()) === JSON.stringify([...actor.preferences.topics].sort())) return
      actor.preferences = next
      if (actor.role === 'player') actor.ready = false
      invalidate()
    }
    switch (command.type) {
      case 'profile': {
        lobby(); const displayName = name(command.name)
        if (room.members.some(m => m.id !== actor.id && normalized(m.name) === normalized(displayName))) return fail('NAME_TAKEN', 'Такое имя уже занято.')
        actor.name = displayName; actor.avatar = avatar(command.avatar)
        if (command.preferences) updatePreferences(command.preferences)
        room.plan?.coverage.forEach(p => { if (p.playerId === actor.id) p.name = displayName })
        break
      }
      case 'preferences': lobby(); updatePreferences(command.preferences); break
      case 'settings': host(); lobby(); room.settings = settings(command.settings); room.members.filter(m => m.role === 'player').forEach(m => { m.ready = false }); invalidate(); break
      case 'ready': lobby(); if (typeof command.ready !== 'boolean') return fail('INVALID_COMMAND', 'Некорректная готовность.'); if (actor.role === 'host') return fail('PLAYER_ONLY', 'Ведущий запускает игру, когда игроки готовы.'); actor.ready = command.ready; break
      case 'prepare': {
        host(); lobby()
        if (room.plan) break
        const inputKey = this.mixKey(room)
        const players = room.members.filter(m => m.role === 'player')
        if (players.length < 2) return fail('NEED_PLAYERS', 'Нужны хотя бы два игрока и ведущий.')
        this.cancelMix(code)
        const job = { key: this.mixKey(room) }; this.jobs.set(code, job)
        let mix: ReturnType<typeof buildMix>
        try { mix = await this.makeMix(room) }
        finally { if (this.jobs.get(code) === job) this.jobs.delete(code) }
        room = await this.load(code); actor = this.actor(room, token, userId)
        if (room.stage !== 'lobby' || this.mixKey(room) !== inputKey) return fail('PLAN_STALE', 'Состав комнаты или интересы изменились. Соберите пак ещё раз.', 409)
        if (room.plan) break
        mix.plan.coverage.forEach(item => { item.name = room.members.find(member => member.id === item.playerId)?.name ?? item.name })
        room.plan = mix.plan; room.themes = mix.themes; delete room.mixError; break
      }
      case 'start': {
        host(); lobby()
        const players = room.members.filter(m => m.role === 'player')
        if (players.length < 2 || players.some(m => !m.ready)) return fail('NOT_READY', 'Дождитесь готовности всех игроков.', 409)
        if (!room.plan) return fail('NEED_PLAN', 'Дождитесь подбора вопросов.', 409)
        const revision = room.revision
        try { await this.bank.validate(room.themes.flatMap(t => t.questions)) }
        catch (error) { room = await this.load(code); invalidate(); await this.commit(room); this.scheduleMix(room); throw error }
        room = await this.load(code); actor = this.actor(room, token, userId)
        if (room.revision !== revision) return fail('PLAN_STALE', 'Комната изменилась. Проверьте пак и готовность игроков.', 409)
        room.stage = 'playing'; room.chooserId = players[0].id; break
      }
      case 'choose': {
        playing()
        if (room.current) return fail('QUESTION_OPEN', 'Сначала закройте текущий вопрос.', 409)
        if (actor.id !== room.hostId && actor.id !== room.chooserId) return fail('NOT_YOUR_TURN', 'Сейчас вопрос выбирает другой игрок.', 403)
        const theme = room.themes.find(t => t.questions.some(q => q.id === command.questionId))
        const question = theme?.questions.find(q => q.id === command.questionId)
        if (!theme || !question || room.playedIds.includes(question.id)) return fail('QUESTION_UNAVAILABLE', 'Этот вопрос уже разыгран или недоступен.', 409)
        const round = room.themes.find(t => t.questions.some(q => !room.playedIds.includes(q.id)))?.round
        if (theme.round !== round) return fail('ROUND_NOT_OPEN', 'Сначала завершите текущий раунд.', 409)
        const durationMs = room.settings.secondsPerQuestion * 1000
        room.current = { id: question.id, theme: theme.name, points: question.points, prompt: question.prompt, phase: 'reading',
          durationMs, remainingMs: durationMs, deadline: this.now() + durationMs, answeringId: null, rejectedIds: [], result: null }
        room.seenIds = [...new Set([...(room.seenIds ?? []), questionIdentity(question.id)])]
        room.seenAnswers = [...new Set([...(room.seenAnswers ?? []), ...[question.answer, ...question.aliases].map(normalized).filter(Boolean)])]
        room.hostRevealed = false; break
      }
      case 'buzz': {
        playing(); const current = room.current
        if (actor.role !== 'player' || current?.phase !== 'reading' || current.rejectedIds.includes(actor.id)) return fail('BUZZ_CLOSED', 'Ответ уже принят от другого игрока или время закончилось.', 409)
        current.remainingMs = Math.max(0, current.deadline! - this.now()); current.deadline = null
        current.phase = 'buzzed'; current.answeringId = actor.id; break
      }
      case 'reveal': host(); playing(); if (room.current) room.hostRevealed = true; break
      case 'judge': {
        host(); playing(); const current = room.current
        if (command.correct !== null && typeof command.correct !== 'boolean') return fail('INVALID_COMMAND', 'Зачёт должен быть верным, неверным или пропуском.')
        if (!current || current.phase === 'resolved') return fail('NO_ANSWER', 'Этот вопрос уже закрыт.', 409)
        if (command.correct !== null && (current.phase !== 'buzzed' || !room.hostRevealed)) return fail('NO_ANSWER', 'Дождитесь ответа игрока и откройте ключ ведущего.', 409)
        const source = room.themes.flatMap(t => t.questions).find(q => q.id === current.id)!
        room.answers ??= []
        room.answers.push({ id: commandId, questionId: source.id, contentHash: source.hash, memberId: command.correct === null ? null : current.answeringId,
          correct: command.correct, elapsedMs: Math.max(0, current.durationMs - current.remainingMs), at: this.now() })
        if (command.correct !== null) {
          const answerer = room.members.find(m => m.id === current.answeringId)!
          answerer.score += command.correct ? current.points : -current.points
          if (!command.correct) {
            current.rejectedIds.push(answerer.id); current.answeringId = null; room.hostRevealed = false
            const canContinue = room.members.some(m => m.role === 'player' && !current.rejectedIds.includes(m.id))
            current.phase = canContinue ? 'reading' : 'timeout'; current.durationMs = 15_000; current.remainingMs = canContinue ? 15_000 : 0
            current.deadline = canContinue ? this.now() + 15_000 : null; break
          }
          room.chooserId = answerer.id
        }
        room.playedIds.push(current.id); current.phase = 'resolved'; current.deadline = null
        current.result = command.correct ? 'correct' : 'skipped'; break
      }
      case 'next': host(); playing(); if (room.current?.phase !== 'resolved') return fail('QUESTION_OPEN', 'Сначала закройте вопрос.', 409); room.current = null; if (room.playedIds.length === room.themes.length * 5) this.finish(room); break
      case 'finish': host(); playing(); this.finish(room); break
      case 'rematch': host(); if (room.stage !== 'result') return fail('GAME_NOT_FINISHED', 'Сначала завершите игру.', 409); room.stage = 'lobby'; room.playedIds = []; room.answers = []; room.current = null; room.chooserId = null; room.completed = false; room.members.forEach(m => { m.score = 0; m.ready = m.role === 'host' }); invalidate(); break
      case 'kick': host(); lobby(); if (command.memberId === room.hostId) return fail('HOST_REQUIRED', 'В комнате должен оставаться ведущий.'); room.members = room.members.filter(m => m.id !== command.memberId); invalidate(); break
      case 'leave': if (actor.id === room.hostId) room.stage = 'closed'; else if (room.stage === 'lobby') { room.members = room.members.filter(m => m.id !== actor.id); invalidate() } break
      default: return fail('UNKNOWN_COMMAND', 'Неизвестное действие.')
    }
    room.handled.push(commandId); room.handled = room.handled.slice(-128)
    await this.commit(room); this.scheduleMix(room)
    return this.view(room, token, userId)
  }
  private view(room: StoredRoom, token?: string, userId?: string): RoomView {
    const member = token ? room.members.find(m => m.tokenHash === hash(token) && (!m.userId || m.userId === userId)) : null
    const current = member && room.current ? structuredClone(room.current) : null
    if (current) {
      delete current.answer
      if (current.phase === 'reading') current.remainingMs = Math.max(0, current.deadline! - this.now())
      if (current.phase === 'resolved' || member?.id === room.hostId && room.hostRevealed) {
        const question = room.themes.flatMap(t => t.questions).find(q => q.id === current.id)!
        current.answer = { text: question.answer, aliases: question.aliases, note: question.note, source: question.source, packTitle: question.packTitle }
      }
    }
    return { apiVersion: 1, code: room.code, revision: room.revision, stage: room.stage, hostId: room.hostId, settings: room.settings,
      members: room.members.map(cleanMember), me: member ? cleanMember(member) : null, plan: room.plan,
      preparation: { status: room.plan ? 'ready' : room.mixError ? 'error' : room.members.filter(m => m.role === 'player').length < 2 ? 'waiting' : 'building', ...(room.mixError ? { message: room.mixError.message } : {}) },
      board: member && room.stage !== 'lobby' ? room.themes.map(({ questions, ...theme }) => ({ ...theme, questions: questions.map(q => ({ id: q.id, points: q.points, played: room.playedIds.includes(q.id) })) })) : [],
      current, chooserId: room.chooserId, played: room.playedIds.length, total: room.themes.length * 5, completed: room.completed, serverNow: this.now() }
  }
}
