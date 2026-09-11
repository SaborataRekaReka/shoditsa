import { describe, expect, it } from 'vitest'
import { canShareExactChallenge, isMatchingChallengeSession, readServerChallenge, rememberServerChallenge, serverChallengeComparison, serverChallengeResult, type ChallengeSession } from './server-challenge'
import type { ChallengePayload } from './challenge'

const challenge: ChallengePayload = { mode: 'diagnosis', date: '2026-09-11', period: 'all', opponentAttempts: 4, from: 'legacy-sender' }
const session = (overrides: Partial<ChallengeSession> = {}): ChallengeSession => ({
  id: crypto.randomUUID(), kind: 'daily', mode: 'diagnosis', packId: null, period: 'all', difficulty: null,
  variantKey: '-', puzzleDate: '2026-09-11', status: 'playing', completionType: null, attemptsCount: 0, maxAttempts: 10, ...overrides,
})
const storage = () => {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('server challenge comparison', () => {
  it('supports only reproducible public daily/archive puzzles, not random or packs', () => {
    expect(canShareExactChallenge(session())).toBe(true)
    expect(canShareExactChallenge(session({ kind: 'archive' }))).toBe(true)
    expect(canShareExactChallenge(session({ kind: 'free_play' }))).toBe(false)
    expect(canShareExactChallenge(session({ kind: 'pack', packId: 'private' }))).toBe(false)
    expect(canShareExactChallenge(session({ variantKey: 'private-pack' }))).toBe(false)
    expect(canShareExactChallenge(session({ mode: 'danetki' }))).toBe(false)
    expect(canShareExactChallenge(session({ maxAttempts: 5 }))).toBe(false)
  })

  it('matches date, mode and normalized puzzle settings', () => {
    expect(isMatchingChallengeSession(challenge, session())).toBe(true)
    expect(isMatchingChallengeSession(challenge, session({ puzzleDate: '2026-09-10' }))).toBe(false)
    expect(isMatchingChallengeSession(challenge, session({ mode: 'character' }))).toBe(false)
    const music: ChallengePayload = { ...challenge, mode: 'music' }
    expect(isMatchingChallengeSession(music, session({ mode: 'music', difficulty: 'medium' }))).toBe(true)
    expect(canShareExactChallenge(session({ mode: 'music', difficulty: 'medium', variantKey: 'medium' }))).toBe(true)
    expect(isMatchingChallengeSession(music, session({ mode: 'music', difficulty: 'medium', variantKey: 'medium' }))).toBe(true)
    expect(isMatchingChallengeSession({ ...music, difficulty: 'hard' }, session({ mode: 'music', difficulty: 'hard', variantKey: 'hard' }))).toBe(true)
    expect(canShareExactChallenge(session({ mode: 'music', difficulty: 'hard', variantKey: 'medium' }))).toBe(false)
    expect(isMatchingChallengeSession(music, session({ mode: 'music', difficulty: 'hard' }))).toBe(false)
    const city: ChallengePayload = { ...challenge, mode: 'city' }
    expect(isMatchingChallengeSession(city, session({ mode: 'city', variantKey: 'capitals' }))).toBe(true)
    expect(isMatchingChallengeSession(city, session({ mode: 'city', variantKey: '-' }))).toBe(false)
    expect(isMatchingChallengeSession({ ...challenge, mode: 'movie', period: 'from_2000' }, session({ mode: 'movie', period: 'all' }))).toBe(false)
  })

  it('never compares a guessed client outcome or an unfinished final choice', () => {
    expect(serverChallengeResult(session({ attemptsCount: 3 }))).toBeNull()
    expect(serverChallengeResult(session({ status: 'final_choice', attemptsCount: 10 }))).toBeNull()
    expect(serverChallengeResult(session({ status: 'won', attemptsCount: 3 }))).toBe(3)
    expect(serverChallengeResult(session({ status: 'won', completionType: 'final_choice_win', attemptsCount: 10 }))).toBe('f')
    expect(serverChallengeResult(session({ status: 'lost', attemptsCount: 10 }))).toBe('x')
    expect(serverChallengeResult(session({ status: 'expired' }))).toBe('x')
    expect(serverChallengeResult(session({ status: 'won', attemptsCount: 0 }))).toBeNull()
  })

  it('retains only functional comparison state and isolates the recipient session', () => {
    const ownSession = session()
    const tabStorage = storage()
    const context = rememberServerChallenge(challenge, ownSession, tabStorage)
    expect(context?.joinedWhilePlaying).toBe(true)
    const serialized = [...tabStorage.values.values()].join('')
    expect(serialized).not.toContain('legacy-sender')
    expect(serialized).not.toContain('invitation_visit_id')
    expect(readServerChallenge(ownSession, tabStorage)).toEqual(context)
    expect(readServerChallenge(session(), tabStorage)).toBeNull()
    expect(serverChallengeComparison({ ...ownSession, status: 'won', attemptsCount: 3 }, context)).toEqual({
      challengeOutcome: 'won', opponentAttempts: 4, playerAttempts: 3, previouslyCompleted: false,
    })
    expect(serverChallengeComparison(session({ status: 'won', attemptsCount: 3 }), context)).toBeNull()
  })

  it('marks an already completed game as comparison only and survives denied storage', () => {
    const completed = session({ status: 'won', attemptsCount: 5 })
    const brokenStorage = { getItem: () => { throw Error('denied') }, setItem: () => { throw Error('denied') } }
    const context = rememberServerChallenge(challenge, completed, brokenStorage)
    expect(context?.joinedWhilePlaying).toBe(false)
    expect(serverChallengeComparison(completed, context)?.previouslyCompleted).toBe(true)
    expect(readServerChallenge(completed, brokenStorage)).toEqual(context)
    expect(rememberServerChallenge(challenge, session({ kind: 'free_play' }), brokenStorage)).toBeNull()
  })

  it('restores sanitized tab state after reload and rejects corrupt or mismatched records', () => {
    const ownSession = session({ status: 'won', attemptsCount: 4 })
    const tabStorage = storage()
    tabStorage.setItem('shoditsa:challenge-game:v1', JSON.stringify([
      { sessionId: ownSession.id, challenge, joinedWhilePlaying: true },
      { sessionId: 'broken', challenge: {}, joinedWhilePlaying: true },
    ]))
    const context = readServerChallenge(ownSession, tabStorage)
    expect(context?.challenge).not.toHaveProperty('from')
    expect(serverChallengeComparison(ownSession, context)?.challengeOutcome).toBe('tie')
    expect(readServerChallenge({ ...ownSession, puzzleDate: '2026-09-10' }, tabStorage)).toBeNull()
  })
})
