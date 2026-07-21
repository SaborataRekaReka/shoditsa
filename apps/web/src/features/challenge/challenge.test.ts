import { describe, expect, it } from 'vitest'
import { buildChallengeUrl, challengeOutcome, getInstallationId, parseChallengeUrl } from './challenge'

describe('challenge deep links', () => {
  it('round-trips mode, archive date, period, variant and opponent result', () => {
    const link = buildChallengeUrl('https://shoditsa.ru/', {
      mode: 'city', date: '2026-07-10', period: 'all', variantKey: 'capitals', opponentAttempts: 4, from: '7f31ad',
    })
    expect(parseChallengeUrl(link)).toEqual({
      mode: 'city', date: '2026-07-10', period: 'all', variantKey: 'capitals', opponentAttempts: 4, from: '7f31ad',
    })
  })

  it('rejects malformed or incomplete challenges', () => {
    expect(parseChallengeUrl('https://shoditsa.ru/?play=movie&date=bad&challenge=4&from=x')).toBeNull()
    expect(parseChallengeUrl('https://shoditsa.ru/?play=movie&date=2026-07-12&challenge=99&from=x')).toBeNull()
    expect(parseChallengeUrl('https://shoditsa.ru/?play=movie&date=2026-07-12&period=all&difficulty=nightmare&challenge=4&from=x')).toBeNull()
  })

  it('keeps only challenge params and trims sender id to 64 chars', () => {
    const longFrom = 'x'.repeat(96)
    const link = buildChallengeUrl('https://shoditsa.ru/path?legacy=1#old', {
      mode: 'movie',
      date: '2026-07-12',
      period: 'all',
      opponentAttempts: 4,
      from: longFrom,
    })
    const url = new URL(link)
    expect(url.hash).toBe('')
    expect(url.searchParams.get('legacy')).toBeNull()
    const parsed = parseChallengeUrl(link)
    expect(parsed?.from).toBe(longFrom.slice(0, 64))
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
