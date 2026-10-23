import { describe, expect, it } from 'vitest'
import type { ActiveSessionSummary } from '@shoditsa/contracts'
import { readGameAvailability } from '../quest-home/game-availability'
import { studyInProgressGames } from './study-in-progress'
import { resolveStudyPanels } from './study-panels'

const local = { ...readGameAvailability(null, '2026-10-21'), city: 'in-progress' as const, book: 'completed' as const }
const session = (id: string, status: ActiveSessionSummary['status'] = 'playing', updatedAt = '2026-10-21T10:00:00Z'): ActiveSessionSummary => ({ id, mode: 'movie', kind: 'daily', status, variantKey: null, period: 'all', difficulty: null, puzzleDate: '2026-10-21', attemptsCount: 2, updatedAt })

describe('sidebar continuation', () => {
  it('exposes only genuinely unfinished local daily games with a resume destination', () => {
    expect(studyInProgressGames(local, null, false)).toEqual([{ id: 'city', mode: 'city', title: 'Города', detail: 'Загадка дня', href: '/games/city' }])
  })
  it('never substitutes browser saves for an account whose sessions are loading or empty', () => {
    expect(studyInProgressGames(local, null, true)).toEqual([])
    expect(studyInProgressGames(local, [], true)).toEqual([])
  })
  it('counts distinct unfinished sessions and resumes the newest exact session first', () => {
    const sessions = [session('older'), session('done', 'won'), session('older'), session('new/id', 'final_choice', '2026-10-21T11:00:00Z'), session('lost', 'lost')]
    const games = studyInProgressGames(local, sessions, true)
    expect(games.map(game => game.id)).toEqual(['new/id', 'older'])
    expect(games[0].href).toBe('/sessions/new%2Fid')
  })
})

describe('sidebar preference recovery', () => {
  it('uses responsive defaults for absent or corrupted settings', () => {
    for (const value of [null, '{broken', 'null', 'false', '{"left":"huge","right":"hidden"}']) expect(resolveStudyPanels(value)).toEqual({ left: 'auto', right: 'expanded' })
  })
  it('restores each panel independently without requiring both preferences', () => {
    expect(resolveStudyPanels('{"left":"expanded","right":"collapsed"}')).toEqual({ left: 'expanded', right: 'collapsed' })
    expect(resolveStudyPanels('{"left":"collapsed"}')).toEqual({ left: 'collapsed', right: 'expanded' })
  })
})
