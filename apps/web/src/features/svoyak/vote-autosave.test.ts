import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoteAutosave } from './vote-autosave'
import type { Preferences } from './contracts'

afterEach(() => vi.useRealTimers())
describe('Автосохранение голосов', () => {
  it('сохраняет последний быстрый выбор и не посылает параллельные запросы', async () => {
    vi.useFakeTimers()
    const requests: { value: Preferences; done: () => void }[] = []
    const save = vi.fn((value: Preferences) => new Promise<void>(resolve => requests.push({ value, done: resolve })))
    const queue = new VoteAutosave({ topics: [] }, { topics: [] }, save, () => {})
    queue.set({ topics: ['cinema'] }); queue.set({ topics: ['cinema', 'games'] })
    await vi.advanceTimersByTimeAsync(200)
    queue.set({ topics: ['games'] }); queue.set({ topics: ['geography'] })
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(requests[0].value.topics).toEqual(['cinema', 'games'])
    requests[0].done(); await vi.advanceTimersByTimeAsync(1)
    expect(requests[1].value.topics).toEqual(['geography'])
    requests[1].done(); await vi.advanceTimersByTimeAsync(1)
    expect(queue.state.pending).toBe(false); queue.dispose()
  })
  it('восстанавливает выбор после потерянного ответа, даже если пользователь снял все голоса', async () => {
    vi.useFakeTimers()
    let reject!: (error: Error) => void
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_, no) => { reject = no })).mockResolvedValue(undefined)
    const queue = new VoteAutosave({ topics: [] }, { topics: ['cinema'] }, save, () => {})
    queue.start(); await vi.advanceTimersByTimeAsync(200)
    queue.set({ topics: [] }); reject(new Error('Response lost'))
    await vi.advanceTimersByTimeAsync(1)
    expect(queue.state).toMatchObject({ pending: true, failed: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenLastCalledWith({ topics: [] })
    expect(queue.state).toMatchObject({ pending: false, failed: false }); queue.dispose()
  })
  it('возобновляет сохранение черновика и отменяет очередь при уходе', async () => {
    vi.useFakeTimers(); const save = vi.fn().mockResolvedValue(undefined)
    const queue = new VoteAutosave({ topics: [] }, { topics: ['games'] }, save, () => {})
    queue.start(); await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledWith({ topics: ['games'] })
    queue.set({ topics: ['cinema'] }); queue.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
