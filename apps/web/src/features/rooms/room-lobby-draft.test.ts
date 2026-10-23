import { describe, expect, it } from 'vitest'
import { parseRoomDraft } from './room-lobby-draft'
import { defaultRoomSetup } from './room-setup-model'

describe('returning to lobby setup', () => {
  it('restores categories and rules after visiting another page', () => {
    const setup = { ...defaultRoomSetup(), packs: [{ mode: 'anime', variant: 'from_2010' }], roundsTotal: 12, answerTimeSeconds: 20, shufflePacks: true }
    expect(parseRoomDraft(JSON.stringify({ mode: 'quiz', setup }), null, true)).toEqual({ mode: 'quiz', setup })
  })
  it('respects an explicit mode link without discarding quiz preferences', () => {
    const saved = JSON.stringify({ mode: 'quiz', setup: { ...defaultRoomSetup(), roundsTotal: 12 } })
    expect(parseRoomDraft(saved, 'danetki', true)).toMatchObject({ mode: 'danetki', setup: { gameType: 'danetki', roundsTotal: 12 } })
    expect(parseRoomDraft(saved, 'svoyak', false).mode).toBe('quiz')
  })
  it.each([null, '{', '{}', '{"mode":"invalid"}', '{"mode":"quiz","setup":{"packs":[null,42,{"mode":"removed"}],"roundsTotal":"bad"}}'])('repairs incomplete or broken storage: %s', raw => {
    expect(parseRoomDraft(raw, null, true)).toEqual({ mode: 'quiz', setup: defaultRoomSetup() })
  })
})
