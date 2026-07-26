import { describe, expect, it } from 'vitest'
import { KPOP_ARTISTS_PACK_ID, type ActiveSessionSummary, type GameSessionSnapshot } from '@shoditsa/contracts'
import {
  catalogActiveSessions,
  catalogGameExperience,
  gameExperienceForSession,
} from './game-experience'

describe('game experience separation', () => {
  it('derives a pack context only from a pack session', () => {
    expect(gameExperienceForSession({
      kind: 'pack',
      packId: 'dtf-game-comments-25-v1',
    } as GameSessionSnapshot, 'title')).toEqual({
      source: 'pack',
      packId: 'dtf-game-comments-25-v1',
    })

    expect(gameExperienceForSession({
      kind: 'daily',
      packId: null,
    } as GameSessionSnapshot, 'title')).toEqual(catalogGameExperience('title'))

    expect(gameExperienceForSession({
      kind: 'daily',
      packId: null,
      variantKey: KPOP_ARTISTS_PACK_ID,
    } as GameSessionSnapshot, 'hub')).toEqual({
      source: 'pack',
      packId: KPOP_ARTISTS_PACK_ID,
    })
  })

  it('keeps pack sessions out of the ordinary game hub', () => {
    const base = {
      mode: 'game',
      status: 'playing',
      variantKey: null,
      period: 'all',
      difficulty: null,
      puzzleDate: '2026-07-24',
      attemptsCount: 1,
      updatedAt: '2026-07-24T08:00:00.000Z',
    } satisfies Omit<ActiveSessionSummary, 'id' | 'kind'>
    const sessions = [
      { ...base, id: 'daily', kind: 'daily' },
      { ...base, id: 'dtf', kind: 'pack', variantKey: 'dtf-game-comments-25-v1' },
    ] satisfies ActiveSessionSummary[]

    expect(catalogActiveSessions(sessions).map((session) => session.id)).toEqual(['daily'])
  })
})
