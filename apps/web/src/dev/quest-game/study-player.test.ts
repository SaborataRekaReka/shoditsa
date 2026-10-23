import { describe, expect, it } from 'vitest'
import { readStudyPlayer } from './study-player'

describe('shared local player header', () => {
  it('uses the same real wallet and attendance keys as the local game, without changing them', () => {
    const values: Record<string, string> = { 'seans:v1:wallet': JSON.stringify({ tickets: 37, lifetimeTickets: 80 }), 'seans:v1:attendance:stats': JSON.stringify({ currentDailyStreak: 4 }) }
    expect(readStudyPlayer({ getItem: key => values[key] ?? null })).toEqual({ balance: 37, streak: 4 })
  })
  it('never invents a sample balance when storage is missing, malformed or inaccessible', () => {
    expect(readStudyPlayer(null)).toEqual({ balance: 0, streak: 0 })
    expect(readStudyPlayer({ getItem: () => '{' })).toEqual({ balance: 0, streak: 0 })
    expect(readStudyPlayer({ getItem: () => { throw new Error('restricted') } })).toEqual({ balance: 0, streak: 0 })
    expect(readStudyPlayer({ getItem: key => key.includes('wallet') ? '{"tickets":-12}' : '{"currentDailyStreak":"bad"}' })).toEqual({ balance: 0, streak: 0 })
  })
})
