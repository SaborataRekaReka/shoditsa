import { describe, expect, it } from 'vitest'
import { buildMix, themeGroups } from '../src/svoyak/mix.js'
import type { BankQuestion } from '../src/svoyak/bank.js'

const question = (i: number, themeId = 'film'): BankQuestion => ({
  id: `q${i}`, hash: `h${i}`, themeId, theme: 'Фильмы', topic: 'cinema', packId: 1, packTitle: 'Пак',
  prompt: 'Что за фильм?', answer: `Фильм ${i}`, aliases: [], note: '', source: '', difficulty: 1, age: 18,
  duplicateIds: [], media: [{ kind: 'image', url: `/media/${i}.webp`, phase: 'question', caption: '' }],
})
const player = { id: 'p', name: 'Игрок', avatar: 'cat' as const, role: 'player' as const, ready: true, score: 0, preferences: { topics: [] } }
const settings = { rounds: 1, themesPerRound: 1, secondsPerQuestion: 30, age: 18 }
const mix = (questions: BankQuestion[]) => buildMix({ questions, catalog: { revision: 'r', total: questions.length, playable: questions.length, localOnly: false, packs: [], topics: [{ id: 'cinema', label: 'Кино', playable: questions.length }] } }, [player], settings, 'seed')

describe('ready question selection', () => {
  it('accepts repeated instructions with distinct question images', () => {
    expect(mix(Array.from({ length: 5 }, (_, i) => question(i))).themes[0].questions).toHaveLength(5)
  })
  it('still rejects the same prompt and same image', () => {
    const questions = Array.from({ length: 5 }, (_, i) => question(i))
    questions.forEach(q => { q.media = questions[0].media })
    expect(() => mix(questions)).toThrow('полных тем')
  })
  it('pools short themes within a category and exposes every ready question', () => {
    const questions = Array.from({ length: 11 }, (_, i) => question(i, i < 5 ? 'full' : `short${i}`))
    const groups = themeGroups(questions)
    expect(groups.map(g => g.questions.length).sort()).toEqual([5, 6])
    expect(new Set(groups.flatMap(g => g.questions.map(q => q.id))).size).toBe(11)
    expect(mix(questions.slice(5)).themes[0].name).toBe('Кино: сборная тема')
  })
  it('keeps a remainder smaller than five reachable without crossing categories', () => {
    const questions = Array.from({ length: 7 }, (_, i) => question(i, i < 5 ? 'full' : 'short'))
    expect(themeGroups(questions)[0].questions).toHaveLength(7)
    expect(themeGroups([question(1)] )).toHaveLength(0)
  })
  it('does not permanently exclude harder questions in a theme larger than five', () => {
    const questions = Array.from({ length: 8 }, (_, i) => ({ ...question(i), difficulty: i + 1 }))
    const seen = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const result = buildMix({ questions, catalog: { revision: 'r', total: 8, playable: 8, localOnly: false, packs: [], topics: [] } }, [player], settings, String(i))
      result.themes[0].questions.forEach(q => seen.add(q.id))
      const levels = result.themes[0].questions.map(q => q.difficulty)
      expect(levels).toEqual([...levels].sort((a, b) => a - b))
    }
    expect(seen.size).toBe(8)
  })
})
