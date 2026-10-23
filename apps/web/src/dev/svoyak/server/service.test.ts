import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RoomService, defaultSettings, type RoomRepository, type StoredRoom } from './service'
import { SqliteRoomRepository } from './repository'
import { buildMix } from './mix'
import type { Bank, BankQuestion, QuestionBank } from './bank'
import type { Command, Credentials } from '../../../features/svoyak/contracts'

class MemoryRooms implements RoomRepository {
  rows = new Map<string, StoredRoom>()
  get(code: string) { return structuredClone(this.rows.get(code) ?? null) }
  save(room: StoredRoom, expected: number | null) {
    if ((this.rows.get(room.code)?.revision ?? null) !== expected) throw new Error('Revision conflict')
    this.rows.set(room.code, structuredClone(room))
  }
}
function bankFixture(): Bank {
  const questions: BankQuestion[] = []
  for (const [packId, topic] of [[1, 'cinema'], [2, 'geography']] as const) for (let group = 0; group < 3; group++) for (let n = 0; n < 5; n++) {
    questions.push({ id: `${packId}:${group}:${n}`, hash: `hash-${packId}-${group}-${n}`, themeId: `theme-${packId}-${group}`,
      theme: `${topic} ${group}`, topic, packId, packTitle: `Пак ${packId}`, prompt: `Условие ${packId}-${group}-${n}`,
      answer: `Секрет ${packId}-${group}-${n}`, aliases: [], note: '', source: 'https://example.test/pack', difficulty: n + 1, age: 16, duplicateIds: [] })
  }
  return { questions, catalog: { revision: 'revision-1', localOnly: true, total: questions.length, playable: questions.length,
    packs: [1, 2].map(id => ({ id, title: `Пак ${id}`, total: 15, playable: 15, topics: [id === 1 ? 'cinema' : 'geography'] })),
    topics: ['cinema', 'geography'].map(id => ({ id, label: id, playable: 15 })) } }
}
const services: RoomService[] = []
afterEach(() => { services.splice(0).forEach(service => service.dispose()); vi.useRealTimers() })
async function setup() {
  let time = 1_000_000
  const bank = bankFixture(), repo = new MemoryRooms()
  const provider: QuestionBank = { load: async () => bank, validate: async () => {} }
  const service = new RoomService(repo, provider, () => time)
  services.push(service)
  const host = (await service.create({ name: 'Ведущий', avatar: 'cat', settings: { ...defaultSettings, themesPerRound: 2 } })).credentials
  const first = (await service.join(host.code, { name: 'Кино', avatar: 'fox' })).credentials
  const second = (await service.join(host.code, { name: 'Географ', avatar: 'panda' })).credentials
  const command = (who: Credentials, command: Command, id = randomUUID()) => service.command(who.code, who.token, command, id)
  const start = async () => {
    await command(first, { type: 'profile', name: 'Кино', avatar: 'fox', preferences: { topics: ['cinema'] } })
    await command(second, { type: 'profile', name: 'Географ', avatar: 'panda', preferences: { topics: ['geography'] } })
    await command(first, { type: 'ready', ready: true }); await command(second, { type: 'ready', ready: true })
    await command(host, { type: 'prepare' }); return command(host, { type: 'start' })
  }
  return { service, repo, bank, provider, host, first, second, command, start, advance: (ms: number) => { time += ms } }
}

describe('Серверная комната свояка', async () => {
  it('автоматически собирает пак после голосов, сохраняет готовность и начинает игру без prepare', async () => {
    vi.useFakeTimers()
    const s = await setup(), load = vi.spyOn(s.provider, 'load')
    await s.command(s.first, { type: 'preferences', preferences: { topics: ['cinema'] } })
    await s.command(s.second, { type: 'preferences', preferences: { topics: ['geography'] } })
    await s.command(s.first, { type: 'ready', ready: true })
    await s.command(s.second, { type: 'ready', ready: true })
    expect((await s.service.get(s.host.code)).preparation.status).toBe('building')
    await vi.advanceTimersByTimeAsync(350)
    const room = (await s.service.get(s.host.code, s.host.token))
    expect(load).toHaveBeenCalledTimes(1)
    expect(room.preparation.status).toBe('ready')
    expect(room.plan?.coverage.every(p => p.themes > 0)).toBe(true)
    expect(room.members.filter(m => m.role === 'player').every(m => m.ready)).toBe(true)
    expect((await s.command(s.host, { type: 'start' })).stage).toBe('playing')
  })
  it('не публикует старую сборку поверх новых голосов и сохраняет профиль во время подбора', async () => {
    vi.useFakeTimers()
    const s = await setup(), pending: ((bank: Bank) => void)[] = []
    s.provider.load = () => new Promise(resolve => pending.push(resolve))
    await s.command(s.first, { type: 'preferences', preferences: { topics: ['cinema'] } })
    await vi.advanceTimersByTimeAsync(350)
    await s.command(s.first, { type: 'preferences', preferences: { topics: ['geography'] } })
    await s.command(s.second, { type: 'preferences', preferences: { topics: ['geography'] } })
    await vi.advanceTimersByTimeAsync(350)
    await s.command(s.first, { type: 'profile', name: 'Новое имя', avatar: 'frog' })
    await s.command(s.first, { type: 'ready', ready: true })
    pending[1](s.bank); await vi.advanceTimersByTimeAsync(0)
    const newest = (await s.service.get(s.host.code, s.first.token))
    expect(newest.plan?.themes.every(t => t.topic === 'geography')).toBe(true)
    expect(newest.me).toMatchObject({ name: 'Новое имя', avatar: 'frog', ready: true })
    expect(newest.plan?.coverage.find(p => p.playerId === s.first.memberId)?.name).toBe('Новое имя')
    pending[0](s.bank); await vi.advanceTimersByTimeAsync(0)
    expect((await s.service.get(s.host.code)).plan?.id).toBe(newest.plan?.id)
  })
  it('повтор сохранения и смена аватара не сбрасывают готовность или пак', async () => {
    vi.useFakeTimers(); const s = await setup()
    await s.command(s.first, { type: 'preferences', preferences: { topics: ['cinema'] } })
    await vi.advanceTimersByTimeAsync(350)
    const id = (await s.service.get(s.host.code)).plan?.id
    await s.command(s.first, { type: 'ready', ready: true })
    await s.command(s.first, { type: 'preferences', preferences: { topics: ['cinema'] } })
    const room = await s.command(s.first, { type: 'profile', name: 'Кино', avatar: 'lion' })
    expect(room.me?.ready).toBe(true); expect(room.plan?.id).toBe(id)
  })
  it('повторяет подбор после восстановления базы, без команды ведущего', async () => {
    vi.useFakeTimers(); const s = await setup()
    s.provider.load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(s.bank)
    await vi.advanceTimersByTimeAsync(350)
    expect((await s.service.get(s.host.code)).preparation.status).toBe('error')
    s.advance(10_000); (await s.service.get(s.host.code))
    await vi.advanceTimersByTimeAsync(350)
    expect((await s.service.get(s.host.code)).plan?.questions).toBe(10)
  })
  it('показывает нехватку тем и пересобирает после нового выбора', async () => {
    vi.useFakeTimers(); const s = await setup()
    s.bank.questions = s.bank.questions.filter(q => q.topic !== 'cinema')
    await s.command(s.first, { type: 'preferences', preferences: { topics: ['cinema'] } })
    await vi.advanceTimersByTimeAsync(350)
    expect((await s.service.get(s.host.code)).preparation.status).toBe('error')
    await s.command(s.first, { type: 'preferences', preferences: { topics: ['geography'] } })
    await vi.advanceTimersByTimeAsync(350)
    expect((await s.service.get(s.host.code)).preparation.status).toBe('ready')
  })
  it('учитывает интересы обоих игроков и отдаёт в лобби только метаданные', async () => {
    const s = await setup(); const room = await s.start()
    expect(new Set(room.plan!.themes.map(t => t.topic))).toEqual(new Set(['cinema', 'geography']))
    expect(room.plan!.coverage.every(p => p.themes > 0)).toBe(true)
    const serialized = JSON.stringify(room)
    expect(serialized).not.toContain('Секрет'); expect(serialized).not.toContain('tokenHash'); expect(room.total).toBe(10)
    expect(room.board.every(t => t.questions.length === 5)).toBe(true)
  })
  it('распределяет объём 3:1 и использует весь пул, игнорируя старый фильтр паков', async () => {
    const s = await setup()
    const base = (await s.service.get(s.host.code, s.host.token)).members.filter(m => m.role === 'player')
    const participants = [0, 1, 2, 3].map((n) => ({ ...base[n % 2], id: String(n), preferences: { topics: [n < 3 ? 'cinema' : 'geography'], packIds: [999] } }))
    for (let seed = 0; seed < 10; seed++) {
      const mix = buildMix(s.bank, participants, { ...defaultSettings, themesPerRound: 4 }, String(seed))
      expect(mix.plan.distribution).toEqual([
        { topic: 'cinema', weight: .75, questions: 15 },
        { topic: 'geography', weight: .25, questions: 5 },
      ])
      expect(mix.plan.coverage.every(p => p.themes > 0)).toBe(true)
    }
  })
  it('делит один голос между интересами и не усиливает повторяющиеся темы', async () => {
    const s = await setup(), players = (await s.service.get(s.host.code, s.host.token)).members.filter(m => m.role === 'player')
    players[0].preferences = { topics: ['cinema', 'geography', 'cinema'] }
    players[1].preferences = { topics: ['geography'] }
    const plan = buildMix(s.bank, players, { ...defaultSettings, themesPerRound: 4 }, 'weights').plan
    expect(plan.distribution?.find(t => t.topic === 'cinema')).toEqual({ topic: 'cinema', weight: .25, questions: 5 })
    expect(plan.distribution?.find(t => t.topic === 'geography')).toEqual({ topic: 'geography', weight: .75, questions: 15 })
  })
  it('учитывает выбор ведущего и снимает устаревший план с фильтром паков', async () => {
    const s = await setup()
    const saved = s.repo.get(s.host.code)!
    saved.plan = { id: 'old', libraryRevision: 'old', questions: 10, estimatedMinutes: 15, themes: [], coverage: [] }
    s.repo.rows.set(saved.code, saved)
    expect((await s.service.get(s.host.code)).plan).toBeNull()
    await s.command(s.host, { type: 'profile', name: 'Ведущий', avatar: 'cat', preferences: { topics: ['cinema'] } })
    const room = await s.command(s.host, { type: 'prepare' })
    expect(room.plan?.coverage.some(p => p.playerId === s.host.memberId)).toBe(true)
    expect(room.plan?.algorithm).toBe('topics-v2')
  })
  it('сохраняет первый buzz, прячет ключ от игроков и не удваивает зачёт', async () => {
    const s = await setup(), room = await s.start(), qid = room.board[0].questions[0].id
    await s.command(s.first, { type: 'choose', questionId: qid })
    await s.command(s.first, { type: 'buzz' })
    await expect(s.command(s.second, { type: 'buzz' })).rejects.toMatchObject({ code: 'BUZZ_CLOSED' })
    await s.command(s.host, { type: 'reveal' })
    expect((await s.service.get(s.host.code, s.first.token)).current?.answer).toBeUndefined()
    expect((await s.service.get(s.host.code, s.host.token)).current?.answer?.text).toContain('Секрет')
    const id = randomUUID(); await s.command(s.host, { type: 'judge', correct: true }, id)
    const result = await s.command(s.host, { type: 'judge', correct: true }, id)
    expect(result.members.find(m => m.id === s.first.memberId)?.score).toBe(100)
    expect((await s.service.get(s.host.code, s.second.token)).current?.answer?.text).toContain('Секрет')
  })
  it('останавливает время на ответе, запускает 15 секунд после ошибки и закрывает поздний buzz', async () => {
    const s = await setup(), room = await s.start()
    await s.command(s.first, { type: 'choose', questionId: room.board[0].questions[0].id }); s.advance(5_000)
    await s.command(s.first, { type: 'buzz' }); s.advance(90_000)
    expect((await s.service.get(s.host.code, s.first.token)).current?.remainingMs).toBe(25_000)
    await s.command(s.host, { type: 'reveal' }); await s.command(s.host, { type: 'judge', correct: false })
    expect((await s.service.get(s.host.code, s.second.token)).current?.durationMs).toBe(15_000)
    await expect(s.command(s.first, { type: 'buzz' })).rejects.toMatchObject({ code: 'BUZZ_CLOSED' })
    s.advance(15_000)
    await expect(s.command(s.second, { type: 'buzz' })).rejects.toMatchObject({ code: 'BUZZ_CLOSED' })
    expect((await s.service.get(s.host.code, s.second.token)).current?.phase).toBe('timeout')
  })
  it('требует ведущего, готовность всех и повторную сборку после смены предпочтений', async () => {
    const s = await setup()
    await expect(s.command(s.first, { type: 'prepare' })).rejects.toMatchObject({ code: 'HOST_ONLY' })
    await s.command(s.host, { type: 'prepare' })
    await expect(s.command(s.host, { type: 'start' })).rejects.toMatchObject({ code: 'NOT_READY' })
    await s.command(s.first, { type: 'profile', name: 'Кино', avatar: 'fox', preferences: { topics: ['cinema'] } })
    expect((await s.service.get(s.host.code, s.host.token)).plan).toBeNull()
    await expect(s.service.command(s.host.code, 'wrong-token', { type: 'finish' }, randomUUID())).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
  it('не стартует с изменившимся вопросом и не записывает такую игру', async () => {
    const s = await setup(); await s.start(); await s.command(s.host, { type: 'finish' }); await s.command(s.host, { type: 'rematch' })
    await s.command(s.first, { type: 'ready', ready: true }); await s.command(s.second, { type: 'ready', ready: true }); await s.command(s.host, { type: 'prepare' })
    s.provider.validate = async () => { throw new Error('Источник изменён') }
    await expect(s.command(s.host, { type: 'start' })).rejects.toThrow('Источник изменён')
    expect((await s.service.get(s.host.code, s.host.token)).stage).toBe('lobby')
    expect((await s.service.get(s.host.code, s.host.token)).plan).toBeNull()
  })
  it('фиксирует результат, сохраняет состав и исключает показанный вопрос в следующей игре', async () => {
    const s = await setup(), room = await s.start(), qid = room.board[0].questions[0].id
    await s.command(s.first, { type: 'choose', questionId: qid }); await s.command(s.host, { type: 'judge', correct: null })
    await s.command(s.host, { type: 'finish' }); const lobby = await s.command(s.host, { type: 'rematch' })
    expect(lobby.stage).toBe('lobby'); expect(lobby.members).toHaveLength(3); expect(lobby.members.filter(m => m.role === 'player').every(m => !m.ready)).toBe(true)
    await s.command(s.host, { type: 'prepare' })
    expect(s.repo.get(s.host.code)!.themes.flatMap(t => t.questions).some(q => q.id === qid)).toBe(false)
  })
  it('не добивает неполную тему случайными вопросами из других интересов', async () => {
    const s = await setup(), players = (await s.service.get(s.host.code, s.first.token)).members.filter(m => m.role === 'player')
    players.forEach(p => { p.preferences = { topics: ['cinema'] } })
    const bank = bankFixture(); bank.questions = bank.questions.filter(q => q.packId !== 1 || q.difficulty < 5)
    expect(() => buildMix(bank, players, defaultSettings, 'seed')).toThrow(/полных тем/)
  })
  it('сохраняет комнату в отдельной SQLite и отклоняет устаревшую запись', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shoditsa-svoyak-test-')), path = join(directory, 'rooms.sqlite3')
    const repo = new SqliteRoomRepository(path), s = await setup(), room = s.repo.get(s.host.code)!
    try {
      repo.save(room, null); const restored = repo.get(room.code)!
      expect(restored.members).toHaveLength(3)
      restored.revision++; repo.save(restored, room.revision)
      expect(() => repo.save(restored, room.revision)).toThrow(/обновилась/)
    } finally { repo.close(); unlinkSync(path); rmdirSync(directory) }
  })
})
  it('does not commit a cancelled preparation after an asynchronous repository read', async () => {
    vi.useFakeTimers()
    const storage = new MemoryRooms()
    let pause = false, release: (() => void) | undefined
    const repository: RoomRepository = {
      get: async code => { const value = storage.get(code); if (pause) { pause = false; await new Promise<void>(resolve => { release = resolve }) } return value },
      save: vi.fn((room,revision) => storage.save(room,revision)),
    }
    const service = new RoomService(repository, { load: async () => bankFixture(), validate: async () => {} })
    services.push(service)
    const host = (await service.create({ name:'Ведущий', avatar:'cat', settings:{...defaultSettings,themesPerRound:1} })).credentials
    await service.join(host.code,{name:'Первый',avatar:'fox'});await service.join(host.code,{name:'Второй',avatar:'panda'})
    pause = true
    await vi.advanceTimersByTimeAsync(350)
    expect(release).toBeTypeOf('function')
    const prepared = await service.command(host.code,host.token,{type:'prepare'},randomUUID())
    const writes = vi.mocked(repository.save).mock.calls.length
    release!()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(repository.save).mock.calls.length).toBe(writes)
    expect((await service.get(host.code,host.token)).plan?.id).toBe(prepared.plan?.id)
  })
