import { SVOYAK_AVATARS, type AvatarId, type RoomSettings } from './contracts'

export const SVOYAK_DRAFT_KEY = 'svoyak:creation-draft:v1'
export const defaultSvoyakSettings: RoomSettings = { rounds: 1, themesPerRound: 3, secondsPerQuestion: 30, age: 18 }
export type SvoyakCreationDraft = { name: string; avatar: AvatarId; settings: RoomSettings }
export function parseSvoyakDraft(raw: string | null, name = ''): SvoyakCreationDraft {
  const draft: SvoyakCreationDraft = { name, avatar: 'cat', settings: { ...defaultSvoyakSettings } }
  try {
    const saved = JSON.parse(raw ?? 'null')
    if (!saved) return draft
    if (typeof saved.name === 'string') draft.name = saved.name.slice(0, 24)
    if (SVOYAK_AVATARS.some(avatar => avatar.id === saved.avatar)) draft.avatar = saved.avatar
    const settings = saved.settings
    if (settings) draft.settings = {
      rounds: [1, 2, 3].includes(settings.rounds) ? settings.rounds : draft.settings.rounds,
      themesPerRound: [1, 2, 3, 4, 5, 6].includes(settings.themesPerRound) ? settings.themesPerRound : draft.settings.themesPerRound,
      secondsPerQuestion: [15, 30, 45, 60].includes(settings.secondsPerQuestion) ? settings.secondsPerQuestion : draft.settings.secondsPerQuestion,
      age: settings.age === 16 ? 16 : 18,
    }
  } catch { /* Old or broken drafts fall back to playable defaults. */ }
  return draft
}
