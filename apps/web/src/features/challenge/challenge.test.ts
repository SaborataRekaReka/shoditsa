import { describe, expect, it } from 'vitest'
import { buildChallengeUrl, challengeLandingPath, challengeOutcome, getInstallationId, parseChallengeUrl } from './challenge'

describe('challenge deep links', () => {
  it('round-trips mode, archive date, period, variant and opponent result', () => {
    const link = buildChallengeUrl('https://shoditsa.ru/', {
      mode: 'city', date: '2026-07-10', period: 'all', variantKey: 'capitals', opponentAttempts: 4,
    })
    expect(parseChallengeUrl(link)).toEqual({
      mode: 'city', date: '2026-07-10', period: 'all', variantKey: 'capitals', opponentAttempts: 4,
    })
  })

  it('omits an irrelevant all-time period for modes without period selection', () => {
    const url = buildChallengeUrl('https://shoditsa.ru/games/diagnosis', {
      mode: 'diagnosis',
      date: '2026-07-28',
      period: 'all',
      opponentAttempts: 3,
      from: 'player',
    })

    expect(new URL(url).searchParams.has('period')).toBe(false)
    expect(parseChallengeUrl(url)?.period).toBe('all')
  })

  it('rejects malformed or incomplete challenges', () => {
    expect(parseChallengeUrl('https://shoditsa.ru/?play=movie&date=bad&challenge=4&from=x')).toBeNull()
    expect(parseChallengeUrl('https://shoditsa.ru/?play=movie&date=2026-07-12&challenge=99&from=x')).toBeNull()
    expect(parseChallengeUrl('https://shoditsa.ru/?play=movie&date=2026-07-12&period=all&difficulty=nightmare&challenge=4&from=x')).toBeNull()
  })

  it('shares a public landing URL without private session or sender IDs', () => {
    const longFrom = 'x'.repeat(96)
    const link = buildChallengeUrl('https://shoditsa.ru/sessions/private-owner-id?legacy=1#old', {
      mode: 'movie',
      date: '2026-07-12',
      period: 'all',
      opponentAttempts: 4,
      from: longFrom,
    })
    const url = new URL(link)
    expect(url.hash).toBe('')
    expect(url.pathname).toBe('/games/movie')
    expect(url.searchParams.get('legacy')).toBeNull()
    expect(url.searchParams.has('from')).toBe(false)
    expect(link).not.toContain('private-owner-id')
    const parsed = parseChallengeUrl(link)
    expect(parsed?.from).toBeUndefined()
    expect(challengeLandingPath(parsed!)).toBe('/games/movie')
  })

  it('accepts old private links but drops their sender id and default variant sentinel', () => {
    const payload = parseChallengeUrl('https://shoditsa.ru/sessions/owner?play=diagnosis&date=2026-09-11&variant=-&challenge=2&from=sender')
    expect(payload).toEqual({ mode: 'diagnosis', date: '2026-09-11', period: 'all', opponentAttempts: 2 })
  })

  it('rejects impossible dates and unsupported non-catalog or special variants', () => {
    expect(parseChallengeUrl('/?play=movie&date=2026-02-30&challenge=2')).toBeNull()
    expect(parseChallengeUrl('/?play=danetki&date=2026-09-11&challenge=2')).toBeNull()
    expect(parseChallengeUrl('/?play=diagnosis&date=2026-09-11&challenge=2&pack=private')).toBeNull()
    expect(parseChallengeUrl('/?play=city&date=2026-09-11&challenge=2&variant=unknown')).toBeNull()
  })

  it('round-trips music difficulty without treating its duplicated server variant as a pack', () => {
    const link = buildChallengeUrl('https://shoditsa.ru/sessions/private-id', {
      mode: 'music', date: '2026-09-11', period: 'all', difficulty: 'hard', variantKey: 'hard', opponentAttempts: 3,
    })
    expect(new URL(link).pathname).toBe('/games/music')
    expect(new URL(link).searchParams.has('variant')).toBe(false)
    expect(parseChallengeUrl(link)).toEqual({ mode: 'music', date: '2026-09-11', period: 'all', difficulty: 'hard', opponentAttempts: 3 })
    expect(parseChallengeUrl('/?play=music&date=2026-09-11&difficulty=medium&variant=medium&challenge=4&from=old')).toEqual({ mode: 'music', date: '2026-09-11', period: 'all', difficulty: 'medium', opponentAttempts: 4 })
    expect(parseChallengeUrl('/?play=music&date=2026-09-11&variant=medium&challenge=4')?.difficulty).toBe('medium')
    expect(parseChallengeUrl('/?play=music&date=2026-09-11&difficulty=hard&variant=medium&challenge=4')).toBeNull()
    expect(parseChallengeUrl('/?play=music&date=2026-09-11&variant=private-pack&challenge=4')).toBeNull()
  })

  it('compares results and keeps one anonymous installation id', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const first = getInstallationId(storage)
    expect(getInstallationId(storage)).toBe(first)
    expect(challengeOutcome(3, 4)).toBe('won')
    expect(challengeOutcome(5, 4)).toBe('lost')
    expect(challengeOutcome(4, 4)).toBe('tie')
  })
})
