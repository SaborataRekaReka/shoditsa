import { describe, expect, it } from 'vitest'

const forbidden = new Set(['answer', 'answerId', 'answerItemVersionId', 'seed'])
const findLeak = (value: unknown, answerId: string, path = '$'): string | null => {
  if (typeof value === 'string' && value === answerId) return path
  if (!value || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) return `${path}.${key}`
    const leak = findLeak(child, answerId, `${path}.${key}`)
    if (leak) return leak
  }
  return null
}

describe('unfinished game contract', () => {
  it('contains no answer keys or known answer ID', () => {
    const payload = { session: { id: crypto.randomUUID(), status: 'playing', attempts: [{ item: { id: 'guess-1' }, hints: [] }], progressiveHints: [] } }
    expect(findLeak(payload, 'known-answer-id')).toBeNull()
  })
  it('detects nested leaks', () => expect(findLeak({ session: { answerId: 'known-answer-id' } }, 'known-answer-id')).toBe('$.session.answerId'))
})
