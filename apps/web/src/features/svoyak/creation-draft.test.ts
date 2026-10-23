import { describe, expect, it } from 'vitest'
import { defaultSvoyakSettings, parseSvoyakDraft } from './creation-draft'

describe('Svoyak creation draft', () => {
  it('restores the full profile and rules when changing modes or returning to the page', () => {
    const draft = { name: 'Игрок', avatar: 'frog', settings: { rounds: 3, themesPerRound: 6, secondsPerQuestion: 60, age: 16 } }
    expect(parseSvoyakDraft(JSON.stringify(draft), 'Имя аккаунта')).toEqual(draft)
  })
  it('repairs invalid rules instead of submitting unplayable settings', () => {
    expect(parseSvoyakDraft(JSON.stringify({ name: 'Имя', avatar: 'removed', settings: { rounds: 200, themesPerRound: 0, secondsPerQuestion: -1 } }))).toEqual({ name: 'Имя', avatar: 'cat', settings: defaultSvoyakSettings })
    expect(parseSvoyakDraft('{', 'Имя аккаунта').name).toBe('Имя аккаунта')
  })
})
